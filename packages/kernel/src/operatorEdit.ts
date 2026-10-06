import type { BlockMarkSet, EditedBlock } from '@monstera/contract/host';
import { type Result, err, ok } from '@monstera/shared';

import type { PageFont } from './pageFonts.js';
import { type FlowLine, type Measure, NO_MARK, planBlock } from './paragraphFlow.js';
import { type Alignment, blockShape, paragraphSpacing } from './paragraphShape.js';
import { type Matrix, type ShowOperator, multiply, showOperators, textObjectCount } from './textOperators.js';
import { codesFor } from './toUnicode.js';

/**
 * A block edit written into a page's own content stream, changing only the instructions it edits
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decisions 4 to 6). Pure: bytes and the page's fonts in, bytes out, so every rule here is tested without an engine and
 * the MuPDF writer only reads the page and writes the answer.
 *
 * ## What changes, and what does not
 *
 * The block is planned as paragraphs by `planBlock`, the PDFium writer's own plan (ADR-0179): the words typed are
 * attributed to the runs that wrote them, and only the lines from the first changed word to where the layout meets an
 * old line again are set afresh, each word in its own run's state and aligned as the block's paragraphs were. The runs
 * of such a line before the first one the edit names keep their operators. A line the edit moved down, because a line
 * above it wrapped, is set again whole at its new baseline. A line the edit did not reach is not touched.
 *
 * An operator that is set again keeps its place and loses its glyphs: it becomes a `TJ` of spacing alone with the same
 * advance, so an operator after it that is positioned by advance rather than by a move stays where it was. The new
 * words of a block are one text object, `q BT … ET Q`, inserted immediately before the `BT` of the block's first edited
 * operator, so inside the same marked content and under the same CTM.
 *
 * ## Geometry is the operators' own, in user space
 *
 * An operator's origin is its text matrix, moved by the advances of the operators shown since that matrix was set,
 * through the CTM it draws under. A width this needs and the font does not state refuses the edit rather than guess
 * one, which would move every glyph after it. The block's right edge is the further of PDFium's ink box and the
 * operators' own advance, so a line that measures a hair wider by advance than by ink is not wrapped for nothing.
 *
 * ## What it refuses, and why each is a refusal rather than a guess
 *
 * - `numbering`: the content shows a different number of text objects than PDFium read, or a run names an object the
 *   content does not show. Decision 2's check: the edit would otherwise write a run other than the one shown.
 * - `transformed`: the block's operators draw under different CTMs, or set text other than upright and left to right.
 *   One inserted object has one CTM, and the wrap measures along x.
 * - `unknown-width`: an advance the layout needs is one the font does not state.
 * - `needs-a-face`: a word neither the run's font nor a sibling carries, and the caller's {@link OperatorFaces} set
 *   nothing for, or the caller gave none. Nothing is written.
 */

/** One of PDFium's joined runs on the page, as the `pageRuns` pre-read answers it (ADR-0176's correction). */
export interface PageRun {
  /** Its first object, by PDFium's page object index. */
  readonly index: number;
  /** Exactly the objects the run is, `textRunJoin.ts`' `members`, by page object index. */
  readonly members: readonly number[];
  /** What the person was shown it saying. */
  readonly text: string;
  /** Its ink, in PDF user space. */
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

/**
 * PDFium's reading of the page: its joined runs, and the page object index of each of its text objects in order.
 *
 * ## By OBJECT index, because that is what a run names
 *
 * PDFium numbers a page's objects across every kind, text, paths, images and forms, and a run names its objects by that
 * number (`textObjectIndices`). The content's operators are numbered among TEXT objects alone (`textOperators.ts`), so
 * the k-th text object is `textObjects[k]`: on a page that draws a rule between two lines, object 1 is the rule and
 * the second line is object 2 and text object 1. The writer translates through this list and nothing else, so the
 * two numberings meet in one place.
 */
export interface PageRuns {
  readonly textObjects: readonly number[];
  readonly runs: readonly PageRun[];
}

/** Why an operator edit was not made. */
export type OperatorRefusal =
  | { readonly reason: 'numbering'; readonly detail: string }
  | { readonly reason: 'transformed' }
  | { readonly reason: 'unknown-width'; readonly font: string }
  | { readonly reason: 'needs-a-face'; readonly characters: readonly string[] }
  | { readonly reason: 'unchanged' };

/** A byte range. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** An edit made: the new content, and what the read-back needs to check it. */
export interface OperatorEdit {
  readonly content: Uint8Array;
  /** The operators set again, as indices into `showOperators` of the content before. */
  readonly emptied: readonly number[];
  /** Each change: the bytes it replaced in the content before, and the bytes now there. An insertion replaces none. */
  readonly changes: readonly { readonly before: Span; readonly after: Span; readonly inserted: boolean }[];
  /** What each block says after the edit, its lines joined by line breaks: MuPDF's read-back of the page reads it. */
  readonly written: readonly string[];
  /** What the inserted objects draw, block by block, in drawing order: the structural read-back reads it. */
  readonly drawn: readonly string[];
  /** Each block's first and last baseline after the edit, and its last before it, in user space. */
  readonly baselines: readonly { readonly first: number; readonly last: number; readonly lastBefore: number }[];
}

/** Below this, two numbers in user space or a matrix's off-diagonal are the same: float noise, not a different layout. */
const SAME = 1e-6;

/**
 * A word space where neither the run's font nor a sibling draws one, in em: Liberation Sans' and Helvetica's own space
 * advance (278/1000). The gap is moved, never drawn, so a font with no space glyph is still spaced as its face would be.
 */
const SPACE_EM = 0.278;

/** The number as a content stream writes it: at most six decimals, no trailing zeros, never an exponent. */
function num(value: number): string {
  const fixed = value.toFixed(6).replace(/\.?0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

/** A name as a content stream writes it: §7.3.5's `#xx` for every byte outside the regular characters. */
function pdfName(name: string): string {
  let out = '/';
  for (const byte of new TextEncoder().encode(name)) {
    const regular = byte > 0x20 && byte < 0x7f && !'()<>[]{}/%#'.includes(String.fromCharCode(byte));
    out += regular ? String.fromCharCode(byte) : `#${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** The inverse of an affine matrix, `null` when it has none. */
function inverse(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A point through a matrix. */
function apply(m: Matrix, x: number, y: number): readonly [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

/** A font's codes read off a string's bytes. */
function codesOf(font: PageFont, bytes: Uint8Array): number[] {
  const codes: number[] = [];
  for (let at = 0; at + font.codeBytes <= bytes.length; at += font.codeBytes) {
    codes.push(font.codeBytes === 2 ? ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0) : (bytes[at] ?? 0));
  }
  return codes;
}

/** How far `codes` advance in text space, in `font` at `state`'s size and spacing, or `null` for a width it lacks. */
function advanceOf(font: PageFont, codes: readonly number[], state: ShowOperator['state']): number | null {
  let tx = 0;
  for (const code of codes) {
    const width = font.width(code);
    if (width === null) return null;
    const word = font.codeBytes === 1 && code === 32 ? state.wordSpacing : 0;
    tx += (width * state.size + state.charSpacing + word) * state.scale;
  }
  return tx;
}

/** The hexadecimal string that shows `codes` in `font`. */
function hexOf(font: PageFont, codes: readonly number[]): string {
  return `<${codes.map((code) => code.toString(16).toUpperCase().padStart(2 * font.codeBytes, '0')).join('')}>`;
}

/** A piece of a laid-out line: codes in one font, at a point, set in one operator's state. */
/** A stretch of a word set in one font: the font it is shown in and the codes that show it. */
export interface FacePiece {
  readonly font: PageFont;
  readonly codes: readonly number[];
  /** The character this piece draws as the box, where it is one. */
  readonly boxed?: string;
}

/**
 * What a word goes to when neither its run's font nor a sibling carries it
 * ([ADR-0177](../../../docs/DECISIONS/0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md)):
 * the resolver's face and the box, as fonts the caller adds to the page. Pure here: this module asks for the pieces and
 * lays them out, and the caller, which holds the document, decides and embeds them.
 */
export interface OperatorFaces {
  /**
   * `word`, set in `source`'s state, as the pieces that draw it in order, or `null` where nothing can. `own` sets a
   * stretch in the run's own font or a sibling as this module would, so a word partly carried keeps that part there.
   */
  set(
    word: string,
    source: ShowOperator,
    own: (stretch: string) => FacePiece | null,
    /** A weight, slant or family the person asked (ADR-0180): the word is then set in a face that is that. */
    restyle?: { readonly bold?: boolean; readonly italic?: boolean; readonly family?: string },
  ): readonly FacePiece[] | null;
  /**
   * `pieces` were drawn, once, where the edit puts them. Separate from {@link set} because the plan MEASURES a word as
   * often as it likes and draws it once, and the boxes a person is told about are the drawn ones.
   */
  drawn(pieces: readonly FacePiece[]): void;
}

/** What a mark asks of the face a word is set in (ADR-0180 Decision 4). */
interface Restyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly family?: string;
}

/** How a mark restyles a segment (ADR-0180 Decision 4): what is written beside the words' own state. */
interface SegmentStyle {
  readonly colour: readonly [number, number, number] | undefined;
  /** The factor the run's size is multiplied by, size and rise together. */
  readonly factor: number;
  /** How far above the line's baseline, in user space. */
  readonly rise: number;
  readonly underline: boolean;
}

interface Segment {
  readonly source: ShowOperator;
  readonly font: PageFont;
  readonly codes: number[];
  readonly text: string;
  /** Where it starts, in user space. */
  readonly x: number;
  readonly style: SegmentStyle | undefined;
}

/** How a superscript or subscript is set, and the rule under underlined words: the PDFium writer's figures. */
const RISE_SCALE = 0.65;
const SUPERSCRIPT_RISE = 0.33;
const SUBSCRIPT_DROP = 0.12;
const UNDERLINE_THICKNESS = 0.06;
const UNDERLINE_DROP = 0.12;

interface VisualLine {
  readonly baseline: number;
  readonly segments: Segment[];
}

/**
 * The characters each piece of `word` shows, through its font's own `ToUnicode`. A piece whose font names none, which
 * no font the caller adds is, is given the rest of the word, so the pieces still spell it.
 */
function pieceTexts(pieces: readonly FacePiece[], word: string): string[] {
  const texts = pieces.map((piece) => {
    const map = piece.font.toUnicode;
    return map === null ? null : piece.codes.map((code) => map.text.get(code) ?? '').join('');
  });
  const known = texts.reduce<number>((total, text) => total + (text?.length ?? 0), 0);
  return texts.map((text) => text ?? word.slice(known));
}

/** Each typed line split into words and the spaces between them, one space a token. */
function tokens(text: string): string[] {
  return text.match(/ |[^ ]+/gu) ?? [];
}

class Refused extends Error {
  constructor(readonly refusal: OperatorRefusal) {
    super(refusal.reason);
  }
}

/**
 * Writes `blocks` into `content`, the page's joined content streams.
 *
 * @param fonts the page's fonts by resource name (`pageFonts`)
 * @param page PDFium's reading of the same page at the same version
 */
export function editOperators(
  content: Uint8Array,
  fonts: ReadonlyMap<string, PageFont>,
  page: PageRuns,
  blocks: readonly EditedBlock[],
  faces: OperatorFaces | null = null,
): Result<OperatorEdit, OperatorRefusal> {
  try {
    return ok(write(content, fonts, page, blocks, faces));
  } catch (error) {
    if (error instanceof Refused) return err(error.refusal);
    throw error;
  }
}

function write(
  content: Uint8Array,
  fonts: ReadonlyMap<string, PageFont>,
  page: PageRuns,
  blocks: readonly EditedBlock[],
  faces: OperatorFaces | null,
): OperatorEdit {
  const ops = showOperators(content);
  const indexOf = new Map(ops.map((op, at) => [op, at]));
  const counted = textObjectCount(ops);
  if (counted !== page.textObjects.length) {
    throw new Refused({
      reason: 'numbering',
      detail: `the content shows ${String(counted)} text objects and PDFium read ${String(page.textObjects.length)}`,
    });
  }
  /** Each PDFium page object's operator, by its index in `ops`: the k-th text object is `textObjects[k]`. */
  const opAt = new Map<number, number>();
  for (const [at, op] of ops.entries()) {
    const object = op.object === null ? undefined : page.textObjects[op.object];
    if (object !== undefined) opAt.set(object, at);
  }
  const runs = new Map(page.runs.map((run) => [run.index, run]));
  const memberOps = new Set(page.runs.flatMap((run) => run.members.map((member) => opAt.get(member) ?? -1)));

  const fontOf = (op: ShowOperator): PageFont => {
    const font = op.state.font === null ? undefined : fonts.get(op.state.font);
    if (font === undefined) throw new Refused({ reason: 'unknown-width', font: op.state.font ?? '' });
    return font;
  };
  const advanceCache = new Map<number, number | null>();
  /** How far operator `at` advances in its text space, or `null` where its font states no width it needs. */
  const advance = (at: number): number | null => {
    if (advanceCache.has(at)) return advanceCache.get(at) ?? null;
    const op = ops[at];
    const name = op?.state.font ?? null;
    const font = name === null ? undefined : fonts.get(name);
    let tx: number | null = null;
    if (op !== undefined && font !== undefined) {
      tx = 0;
      for (const element of op.elements) {
        if (typeof element === 'number') {
          tx -= (element / 1000) * op.state.size * op.state.scale;
          continue;
        }
        const part = advanceOf(font, codesOf(font, element), op.state);
        if (part === null) {
          tx = null;
          break;
        }
        tx += part;
      }
    }
    advanceCache.set(at, tx);
    return tx;
  };
  const needAdvance = (at: number): number => {
    const tx = advance(at);
    if (tx === null) throw new Refused({ reason: 'unknown-width', font: ops[at]?.state.font ?? '' });
    return tx;
  };
  /** Operator `at`'s text matrix where it begins to show, every advance since the matrix was set added. */
  const textMatrix = (at: number): Matrix => {
    const op = ops[at];
    if (op === undefined) throw new Refused({ reason: 'numbering', detail: `no operator ${String(at)}` });
    let tx = 0;
    for (let before = op.positionedAt; before < at; before += 1) tx += needAdvance(before);
    return multiply([1, 0, 0, 1, tx, 0], op.state.matrix);
  };
  /** Its origin in user space, and how one unit of its text space measures along x — upright text only. */
  const placed = (at: number): { readonly x: number; readonly y: number; readonly unit: number; readonly up: number } => {
    const op = ops[at];
    if (op === undefined) throw new Refused({ reason: 'numbering', detail: `no operator ${String(at)}` });
    const m = multiply(textMatrix(at), op.state.ctm);
    if (Math.abs(m[1]) > SAME * Math.abs(m[0]) || Math.abs(m[2]) > SAME * Math.abs(m[3]) || m[0] <= 0 || m[3] <= 0) {
      throw new Refused({ reason: 'transformed' });
    }
    return { x: m[4], y: m[5], unit: m[0], up: m[3] };
  };

  /**
   * A word in the first of the page's fonts that carries all of it: the source's own, then a sibling (Decision 5). A
   * sibling is the same face by name less its subset tag, and a weight disagrees only where BOTH fonts state one: the
   * committed Chromium print's Type0 body font states none beside its Type 3 heading's 400, of the same face.
   */
  const carrier = (own: PageFont, word: string): { readonly font: PageFont; readonly codes: number[] } | null => {
    const siblings = [...fonts.values()]
      .filter(
        (font) =>
          font !== own &&
          own.face !== null &&
          font.face === own.face &&
          (font.weight === null || own.weight === null || font.weight === own.weight),
      )
      .sort((a, b) => (a.resource < b.resource ? -1 : 1));
    for (const font of [own, ...siblings]) {
      const codes = font.toUnicode === null ? null : codesFor(font.toUnicode, word);
      if (codes?.every((code) => font.draws(code) && font.width(code) !== null) === true) return { font, codes };
    }
    return null;
  };

  const emptied = new Set<number>();
  /** The operators a block's rewrite is placed before: their `BT`, one inserted object per block. */
  const insertions: { readonly at: number; readonly text: string }[] = [];
  const written: string[] = [];
  const drawn: string[] = [];
  const baselinesOut: { first: number; last: number; lastBefore: number }[] = [];
  const uncarried = new Set<string>();

  for (const block of blocks) {
    /** This block's emptied operators: where its inserted object goes is the first of their `BT`s. */
    const own = new Set<number>();
    const lines = block.lines.map((line) =>
      line.map((index) => {
        const run = runs.get(index);
        if (run === undefined) throw new Refused({ reason: 'numbering', detail: `no run ${String(index)} on the page` });
        const members = run.members.map((member) => {
          const at = opAt.get(member);
          if (at === undefined) throw new Refused({ reason: 'numbering', detail: `no operator shows object ${String(member)}` });
          return at;
        });
        const first = members[0];
        const last = members.at(-1);
        if (first === undefined || last === undefined) throw new Refused({ reason: 'numbering', detail: `run ${String(index)} has no objects` });
        const origin = placed(first);
        const end = placed(last);
        const tx = advance(last);
        // THE FURTHER OF INK AND ADVANCE: the right edge a wrap measures against.
        const right = Math.max(run.right, tx === null ? run.right : end.x + tx * end.unit);
        return { run, members, first, last, origin, right };
      }),
    );
    const firstLine = lines[0];
    const firstRun = firstLine?.[0];
    if (firstLine === undefined || firstRun === undefined) continue;
    const ctm = ops[firstRun.first]?.state.ctm;
    const sameCtm = (op: ShowOperator | undefined): boolean =>
      op !== undefined && ctm !== undefined && op.state.ctm.every((value, at) => Math.abs(value - (ctm[at] ?? 0)) <= SAME);
    if (!lines.every((line) => line.every((run) => run.members.every((member) => sameCtm(ops[member]))))) {
      throw new Refused({ reason: 'transformed' });
    }
    const blockRight = Math.max(...lines.flat().map((run) => run.right));
    const baselines = lines.map((line) => line[0]?.origin.y ?? 0);
    const sourceOf = (run: (typeof firstLine)[number]): ShowOperator => {
      const op = ops[run.first];
      if (op === undefined) throw new Refused({ reason: 'numbering', detail: `no operator ${String(run.first)}` });
      return op;
    };
    const lead = sourceOf(firstRun);
    // THE BLOCK'S PITCH: its first two baselines' gap, or with one line its leading, or 1.2 of its size.
    const pitch =
      (baselines[0] ?? 0) - (baselines[1] ?? Number.NaN) > SAME
        ? (baselines[0] ?? 0) - (baselines[1] ?? 0)
        : (lead.state.leading > 0 ? lead.state.leading : 1.2 * lead.state.size) * firstRun.origin.up;

    const visual: VisualLine[] = [];
    const laid: string[] = [];
    // THE BLOCK AS PARAGRAPHS (ADR-0179): the soft-ended lines are one paragraph, and `planBlock` says which lines stay,
    // which are set again and in which run's state each word is, the PDFium writer's own plan (B3a).
    const soft = lines.map((_, at) => at < lines.length - 1 && block.soft[at] === true);
    const flow: FlowLine[] = lines.map((line, at) => ({
      runs: line.map((run) => ({ id: run.run.index, text: run.run.text })),
      soft: soft[at] === true,
    }));
    const shape = blockShape(
      lines.map((line) => ({
        x0: Math.min(...line.map((run) => run.run.left)),
        x1: Math.max(...line.map((run) => run.run.right)),
        characters: line.reduce((sum, run) => sum + run.run.text.length, 0),
      })),
      soft,
    );
    const spacing = paragraphSpacing(baselines, soft);
    const byId = new Map(lines.flat().map((run) => [run.run.index, run]));
    // WHERE A LINE SET AFRESH STARTS: the origin of the line that keeps the paragraph's left edge, since the shape's edge
    // is where ink begins and an operator is placed by its origin.
    const blockLeft = Math.min(...lines.map((line) => line[0]?.origin.x ?? 0));
    const restOrigin = Math.min(...(lines.length > 1 ? lines.slice(1) : lines).map((line) => line[0]?.origin.x ?? 0));

    /** Empties a run's operators, and the inkless spaces PDFium joined into it that no run holds. */
    const empty = (members: readonly number[]): void => {
      for (const member of members) own.add(member);
    };
    const emptyBetween = (from: number, to: number): void => {
      for (let at = from; at <= to; at += 1) {
        const op = ops[at];
        if (op === undefined || memberOps.has(at) || op.codes.length === 0) continue;
        const font = op.state.font === null ? undefined : fonts.get(op.state.font);
        const text = font?.toUnicode === null || font === undefined ? null : codesOf(font, op.codes).map((code) => font.toUnicode?.text.get(code) ?? '\u0000');
        // ONLY A SPACE: anything else no run holds is not this edit's to remove.
        if (text?.every((character) => /^\s$/u.test(character)) === true) own.add(at);
      }
    };

    /**
     * The pieces that draw `token` set in `source`'s state, or `null` where nothing can. A WORD THE PAGE CANNOT CARRY goes
     * to the resolver's face or the box, where the caller gave faces (ADR-0177); without them, or where they set nothing,
     * its letters are named and the edit is refused. Asked once per word and state, since a face set is a decision the
     * caller records: the plan measures a word and the layout writes it, and both must hear the same answer.
     */
    const answers = new Map<string, readonly FacePiece[] | null>();
    const piecesOf = (source: ShowOperator, token: string, restyle?: Restyle): readonly FacePiece[] | null => {
      const key = `${String(indexOf.get(source))}|${JSON.stringify(restyle ?? null)}|${token}`;
      if (answers.has(key)) return answers.get(key) ?? null;
      const font = fontOf(source);
      // A RESTYLED WORD is not looked for in the run's own font: only white space is, which has no style to be wrong in.
      const found = restyle !== undefined && token !== ' ' ? null : carrier(font, token);
      const pieces: readonly FacePiece[] | null =
        found !== null
          ? [found]
          : token === ' '
            ? []
            : (faces?.set(token, source, restyle === undefined ? (stretch) => carrier(font, stretch) : () => null, restyle) ?? null);
      if (pieces === null) {
        for (const character of token) if (restyle !== undefined || carrier(font, character) === null) uncarried.add(character);
      }
      answers.set(key, pieces);
      return pieces;
    };
    /** What a mark makes of the words of run `run`: the face it asks, the size it ends at, and where it sits. */
    const markStyle = (run: (typeof firstLine)[number], mark: number) => {
      const set: BlockMarkSet = block.marks?.[mark]?.set ?? {};
      const source = sourceOf(run);
      const font = fontOf(source);
      const unit = placed(run.first).unit;
      const sizePt = source.state.size * unit;
      const restyle: Restyle | undefined =
        set.bold === undefined && set.italic === undefined && set.family === undefined
          ? undefined
          : {
              ...(set.bold === undefined ? {} : { bold: set.bold }),
              ...(set.italic === undefined ? {} : { italic: set.italic }),
              ...(set.family === undefined ? {} : { family: set.family }),
            };
      const size = set.size ?? sizePt;
      const factor = (size / Math.max(sizePt, 0.01)) * (set.rise === undefined ? 1 : RISE_SCALE);
      const rise =
        set.rise === 'superscript' ? SUPERSCRIPT_RISE * size : set.rise === 'subscript' ? -SUBSCRIPT_DROP * size : 0;
      return { set, source, font, sizePt, restyle, size, factor, rise };
    };
    const changes = (runId: number, mark: number): boolean => {
      const { set, font, sizePt } = markStyle(byId.get(runId) ?? firstRun, mark);
      // WHAT A PAGE'S OPERATORS DO NOT SAY — its slant, its colour, whether a line is under it — a mark that names is a change.
      return (
        (set.bold !== undefined && set.bold !== (font.weight !== null && font.weight >= 600)) ||
        set.italic === true ||
        (set.size !== undefined && Math.abs(set.size - sizePt) > 0.05) ||
        set.colour !== undefined ||
        (set.family !== undefined && !(font.face ?? '').toLowerCase().includes(set.family.toLowerCase())) ||
        set.underline === true ||
        set.rise !== undefined
      );
    };
    /** How far the pen moves for `pieces` in `source`'s state: a space no font carries moves it by a nominal space. */
    const pieceWidths = (source: ShowOperator, pieces: readonly FacePiece[], unit: number): number[] =>
      pieces.map((piece) => (advanceOf(piece.font, piece.codes, source.state) ?? 0) * unit);
    const widthOfPieces = (source: ShowOperator, pieces: readonly FacePiece[], unit: number): number =>
      pieces.length === 0
        ? (SPACE_EM * source.state.size + source.state.charSpacing + source.state.wordSpacing) * source.state.scale * unit
        : pieceWidths(source, pieces, unit).reduce((total, each) => total + each, 0);
    /** How wide `text` is when it is set in the state of run `id`: the plan's one question. */
    const measure: Measure = (id, mark, text) => {
      const run = byId.get(id) ?? firstRun;
      const source = sourceOf(run);
      const marked = mark === NO_MARK ? undefined : markStyle(run, mark);
      const unit = placed(run.first).unit * (marked?.factor ?? 1);
      return tokens(text).reduce((sum, token) => {
        const pieces = piecesOf(source, token, marked?.restyle);
        return pieces === null ? sum : sum + widthOfPieces(source, pieces, unit);
      }, 0);
    };

    /**
     * Lays out `words` set in `source`'s state from `x` on `line`, answering where it ended. `marked` is the mark that
     * styles them, where one does: its face, its size and rise, its colour and its rule.
     */
    const layOut = (
      source: ShowOperator,
      words: string,
      x: number,
      line: VisualLine,
      marked?: ReturnType<typeof markStyle>,
    ): number => {
      const unit = placed(indexOf.get(source) ?? -1).unit * (marked?.factor ?? 1);
      const style: SegmentStyle | undefined =
        marked === undefined
          ? undefined
          : {
              colour: marked.set.colour === undefined ? undefined : [marked.set.colour.r, marked.set.colour.g, marked.set.colour.b],
              factor: marked.factor,
              rise: marked.rise,
              underline: marked.set.underline === true,
            };
      let cursor = x;
      for (const token of tokens(words)) {
        const pieces = piecesOf(source, token, marked?.restyle);
        if (pieces === null) continue;
        faces?.drawn(pieces);
        const widths = pieceWidths(source, pieces, unit);
        const width = widthOfPieces(source, pieces, unit);
        // EACH PIECE'S TEXT, the word's characters its codes show, so the segments still spell the word.
        const texts = pieces.length === 1 ? [token] : pieceTexts(pieces, token);
        let at = cursor;
        for (const [k, piece] of pieces.entries()) {
          const text = texts[k] ?? '';
          const last = line.segments.at(-1);
          // ONE SEGMENT for words that follow on in one font and state: a glyph's advance places the next exactly there.
          if (
            last?.source === source &&
            last.font === piece.font &&
            last.style === style &&
            Math.abs(last.x + segmentWidth(last) - at) <= SAME
          ) {
            last.codes.push(...piece.codes);
            line.segments[line.segments.length - 1] = { ...last, text: last.text + text };
          } else {
            line.segments.push({ source, font: piece.font, codes: [...piece.codes], text, x: at, style });
          }
          at += widths[k] ?? 0;
        }
        cursor += width;
      }
      return cursor;
    };
    const segmentWidth = (segment: Segment): number =>
      (advanceOf(segment.font, segment.codes, segment.source.state) ?? 0) *
      placed(indexOf.get(segment.source) ?? -1).unit *
      (segment.style?.factor ?? 1);

    // HOW EACH PARAGRAPH IS SET: the block's shape with what the person set over it (ADR-0180 Decision 2), as the PDFium
    // writer reads it. Edges are origins here, since an operator is placed by where its glyph is drawn from.
    const settings = new Map((block.paragraphs ?? []).map((setting) => [setting.paragraph, setting]));
    const setFor = (place: number): { align: Alignment; leftEdge: number; first: number; centre: number } => {
      const given = settings.get(place);
      const align = given?.align ?? shape.align;
      const leftEdge = given?.leftIndent === undefined ? restOrigin : blockLeft + given.leftIndent;
      const first = given?.firstIndent ?? (given?.leftIndent === undefined ? shape.firstIndent : 0);
      const centre = given?.align === undefined && shape.align === 'center' ? shape.centre : (leftEdge + blockRight) / 2;
      return { align, leftEdge, first, centre };
    };
    const limits = (place: number): { first: number; rest: number } => {
      const set = setFor(place);
      if (set.align === 'center') {
        const across = Math.max(1, 2 * Math.min(blockRight - set.centre, set.centre - set.leftEdge));
        return { first: across, rest: across };
      }
      if (set.align === 'right') {
        const across = Math.max(1, blockRight - set.leftEdge);
        return { first: across, rest: across };
      }
      return { first: Math.max(1, blockRight - (set.leftEdge + set.first)), rest: Math.max(1, blockRight - set.leftEdge) };
    };
    const forced = new Set(
      (block.paragraphs ?? [])
        .filter(
          (setting) =>
            (setting.align !== undefined && setting.align !== shape.align) ||
            (setting.leftIndent !== undefined && Math.abs(blockLeft + setting.leftIndent - restOrigin) > 0.5) ||
            (setting.firstIndent !== undefined && Math.abs(setting.firstIndent - shape.firstIndent) > 0.5) ||
            (setting.lineSpacing !== undefined && Math.abs(setting.lineSpacing - 1) > 0.01) ||
            (setting.spaceBefore !== undefined && setting.spaceBefore > 0.5),
        )
        .map((setting) => setting.paragraph),
    );
    const plan = planBlock(flow, block.text.replace(/\r\n?/gu, '\n'), measure, limits, {
      marks: (block.marks ?? []).map(({ from, to }) => ({ from, to })),
      changes,
      forced,
    });

    /** The old lines the plan keeps exactly as they are: their operators are not touched. */
    const kept = new Set<number>();
    /** How many leading runs of an old line a line set afresh leaves untouched. */
    const keptRuns = new Map<number, number>();
    let previous = baselines[0] ?? 0;
    for (const [at, row] of plan.rows.entries()) {
      const oldGap = (line: number): number => (baselines[line - 1] ?? 0) - (baselines[line] ?? 0);
      // THE GAP ABOVE A LINE: the person's own where they set the paragraph's spacing, else the gap the line it stands in
      // had, else the block's pitch (and its paragraph spacing where it opens a paragraph).
      const given = row.kind === 'new' ? settings.get(row.paragraph) : undefined;
      const spaced = given?.lineSpacing !== undefined || given?.spaceBefore !== undefined;
      const gap =
        row.kind === 'old'
          ? oldGap(row.line)
          : row.kind === 'blank'
            ? pitch + (row.opens ? spacing : 0)
            : spaced
              ? pitch * (given.lineSpacing ?? 1) + (row.first && at > 0 ? (given.spaceBefore ?? spacing) : 0)
              : row.replaces > 0
                ? oldGap(row.replaces)
                : pitch + (row.opens ? spacing : 0);
      const target = at === 0 ? (baselines[0] ?? 0) : previous - gap;
      previous = target;
      if (row.kind === 'blank') {
        laid.push('');
        continue;
      }
      if (row.kind === 'old') {
        const line = lines[row.line];
        if (line === undefined) continue;
        const text = line.map((run) => run.run.text).join('');
        // A LINE AN EARLIER WRAP MOVED DOWN is set again whole at its new baseline, keeping the gap each run had to the
        // one before it; one that did not move is not touched.
        if (Math.abs(target - (baselines[row.line] ?? 0)) <= SAME) {
          kept.add(row.line);
          laid.push(text);
          continue;
        }
        const placedLine: VisualLine = { baseline: target, segments: [] };
        visual.push(placedLine);
        let cursor = line[0]?.origin.x ?? 0;
        let previousEnd: number | null = null;
        for (const [index, run] of line.entries()) {
          if (previousEnd !== null) cursor += run.origin.x - previousEnd;
          // A TRAILING SPACE OF A RUN WITH A RUN AFTER IT is the gap that run keeps.
          const words = index === line.length - 1 ? run.run.text : run.run.text.replace(/ +$/u, '');
          cursor = layOut(sourceOf(run), words, cursor, placedLine);
          previousEnd = run.right;
        }
        laid.push(text);
        continue;
      }
      // A LINE SET AFRESH, one run of words after another in each run's own state, aligned as the block's paragraphs are.
      const replaced = row.replaces >= 0 ? lines[row.replaces] : undefined;
      // THE RUNS BEFORE THE FIRST ONE THE EDIT NAMES KEEP THEIR OPERATORS, as they always have: where the line stands
      // where it did and is set from its left, each leading piece that is exactly an old run is that run, untouched.
      // At least one old run is set again, which is where the rest of the line begins.
      let untouched = 0;
      const set = setFor(row.paragraph);
      const keepsItsLine = given?.leftIndent === undefined && given?.firstIndent === undefined;
      if (replaced !== undefined && set.align === 'left' && keepsItsLine && Math.abs(target - (baselines[row.replaces] ?? 0)) <= SAME) {
        while (untouched < replaced.length - 1) {
          const piece = row.pieces[untouched];
          const run = replaced[untouched];
          if (piece?.run !== run?.run.index || piece?.text !== run?.run.text || piece?.mark !== NO_MARK) break;
          untouched += 1;
        }
        keptRuns.set(row.replaces, untouched);
      }
      const x =
        set.align === 'center'
          ? set.centre - row.width / 2
          : set.align === 'right'
            ? blockRight - row.width
            : replaced !== undefined && keepsItsLine
              ? (replaced[untouched]?.origin.x ?? restOrigin)
              : set.leftEdge + (row.first ? set.first : 0);
      const placedLine: VisualLine = { baseline: target, segments: [] };
      visual.push(placedLine);
      let cursor = x;
      for (const piece of row.pieces.slice(untouched)) {
        const run = byId.get(piece.run) ?? firstRun;
        cursor = layOut(
          sourceOf(run),
          piece.text,
          cursor,
          placedLine,
          piece.mark === NO_MARK ? undefined : markStyle(run, piece.mark),
        );
      }
      laid.push(row.pieces.map((piece) => piece.text).join(''));
    }
    // EVERY OLD LINE THE PLAN DID NOT KEEP is emptied from its first run that was set again: a line set afresh stands in
    // for it, or the person removed it.
    for (const [at, line] of lines.entries()) {
      if (kept.has(at)) continue;
      const from = keptRuns.get(at) ?? 0;
      for (const run of line.slice(from)) empty(run.members);
      emptyBetween(line[from]?.first ?? 0, line.at(-1)?.last ?? -1);
    }
    const lastLine = lines.at(-1) ?? firstLine;
    const lastRun = lastLine.at(-1) ?? firstRun;
    if (uncarried.size > 0) continue;
    for (const at of own) emptied.add(at);
    written.push(laid.join('\n'));
    baselinesOut.push({ first: baselines[0] ?? 0, last: previous, lastBefore: baselines.at(-1) ?? 0 });

    const segments = visual.flatMap((line) => line.segments.map((segment) => ({ ...segment, baseline: line.baseline })));
    drawn.push(segments.map((segment) => segment.text).join(''));
    if (segments.length === 0) continue;
    const toBt = ctm === undefined ? null : inverse(ctm);
    if (toBt === null) throw new Refused({ reason: 'transformed' });
    const decoder = new TextDecoder('latin1');
    const parts = ['q BT'];
    let replayed: ShowOperator | null = null;
    let font: string | null = null;
    let fontSize = 0;
    /** Whether the fill colour in force is a mark's, so the next segment starts from the source's own again. */
    let tinted = false;
    /** The rules under underlined words, drawn after the text object, in the same space. */
    const rules: string[] = [];
    for (const segment of segments) {
      const style = segment.style;
      if (segment.source !== replayed || tinted) {
        const settings = segment.source.settings.map((setting) => decoder.decode(content.subarray(setting.start, setting.end)));
        parts.push(...settings);
        // A PAGE THAT NEVER SET A FILL COLOUR draws in the default, which is black; leaving a mark's colour in force would
        // paint every word after it in that colour, so the default is said where the source says nothing.
        if (tinted && !settings.some((setting) => /(^|\s)(g|rg|k|sc|scn)(\s|$)/u.test(setting))) parts.push('0 g');
        replayed = segment.source;
        font = segment.source.state.font;
        fontSize = segment.source.state.size;
        tinted = false;
      }
      if (style?.colour !== undefined) {
        parts.push(`${style.colour.map((channel) => num(channel / 255)).join(' ')} rg`);
        tinted = true;
      }
      const size = segment.source.state.size * (style?.factor ?? 1);
      if (segment.font.resource !== font || Math.abs(size - fontSize) > SAME) {
        parts.push(`${pdfName(segment.font.resource)} ${num(size)} Tf`);
        font = segment.font.resource;
        fontSize = size;
      }
      const [a, b, c, d] = segment.source.state.matrix;
      const raised = segment.baseline + (style?.rise ?? 0);
      const [e, f] = apply(toBt, segment.x, raised);
      parts.push(`${[a, b, c, d, e, f].map(num).join(' ')} Tm ${hexOf(segment.font, segment.codes)} Tj`);
      if (style?.underline === true) {
        // THE RULE: this wide, a little under the baseline, in the words' colour where a mark set one and else black —
        // the page's own fill is not something its operators can be asked.
        const pointSize = segment.source.state.size * placed(indexOf.get(segment.source) ?? -1).unit * (style.factor === 0 ? 1 : style.factor);
        const thickness = Math.max(0.5, UNDERLINE_THICKNESS * pointSize);
        const [x0, y0] = apply(toBt, segment.x, raised - UNDERLINE_DROP * pointSize - thickness);
        const [x1, y1] = apply(toBt, segment.x + segmentWidth(segment), raised - UNDERLINE_DROP * pointSize);
        const colour = style.colour ?? [0, 0, 0];
        rules.push(
          `q ${colour.map((channel) => num(channel / 255)).join(' ')} rg ${[Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)].map(num).join(' ')} re f Q`,
        );
      }
    }
    parts.push(...(rules.length === 0 ? ['ET Q\n'] : ['ET', ...rules, 'Q\n']));
    // BEFORE THE FIRST EDITED OPERATOR'S BT, so inside its marked content; for lines only added below the block, before
    // its last run's, whose marked content they continue.
    const anchors = own.size > 0 ? [...own] : [lastRun.last];
    const anchor = Math.min(...anchors.map((at) => ops[at]?.textObject ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(anchor) || anchor < 0) throw new Refused({ reason: 'numbering', detail: 'an edited operator is outside a text object' });
    insertions.push({ at: anchor, text: parts.join('\n') });
  }
  if (uncarried.size > 0) throw new Refused({ reason: 'needs-a-face', characters: [...uncarried] });
  if (emptied.size === 0 && insertions.length === 0) throw new Refused({ reason: 'unchanged' });

  // THE SPLICES, in the order they sit in the bytes: each emptied operator's span, and each insertion at its BT.
  const splices: { readonly start: number; readonly end: number; readonly text: string; readonly inserted: boolean }[] = [];
  for (const at of emptied) {
    const op = ops[at];
    if (op === undefined) continue;
    // SPACING ALONE, THE SAME ADVANCE: only where a later operator is placed by it; otherwise none is needed.
    const dependent = ops[at + 1]?.positionedAt !== undefined && (ops[at + 1]?.positionedAt ?? at + 1) <= at;
    const tx = dependent ? needAdvance(at) : 0;
    const scale = op.state.size * op.state.scale;
    const spacing = tx === 0 || scale === 0 ? '[] TJ' : `[${num((-tx * 1000) / scale)}] TJ`;
    const text =
      op.operator === "'"
        ? `T* ${spacing}`
        : op.operator === '"'
          ? `${num(op.state.wordSpacing)} Tw ${num(op.state.charSpacing)} Tc T* ${spacing}`
          : spacing;
    splices.push({ start: op.start, end: op.end, text, inserted: false });
  }
  for (const insertion of insertions) splices.push({ start: insertion.at, end: insertion.at, text: insertion.text, inserted: true });
  // AN INSERTION SITS BEFORE AN EMPTIED OPERATOR AT THE SAME OFFSET, and two blocks' insertions keep their order.
  splices.sort((left, right) => left.start - right.start || Number(right.inserted) - Number(left.inserted));

  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [];
  const changes: { before: Span; after: Span; inserted: boolean }[] = [];
  let read = 0;
  let length = 0;
  for (const splice of splices) {
    pieces.push(content.subarray(read, splice.start));
    length += splice.start - read;
    const bytes = encoder.encode(splice.text);
    changes.push({ before: { start: splice.start, end: splice.end }, after: { start: length, end: length + bytes.length }, inserted: splice.inserted });
    pieces.push(bytes);
    length += bytes.length;
    read = splice.end;
  }
  pieces.push(content.subarray(read));
  length += content.length - read;
  const out = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return { content: out, emptied: [...emptied].sort((x, y) => x - y), changes, written, drawn, baselines: baselinesOut };
}

/**
 * Decision 6's structural read-back: every byte outside the edit's own changes is the content's as it was, every
 * operator outside the inserted objects is the one that was there in the same order, an emptied one shows nothing, and
 * the inserted objects show the blocks' words. Answers what failed, so the refusal can say nothing more than the
 * owner's sentence while the log keeps the reason.
 */
export function checkOperatorEdit(
  before: Uint8Array,
  edit: OperatorEdit,
  fonts: ReadonlyMap<string, PageFont>,
): Result<void, string> {
  const after = edit.content;
  // EVERY OTHER BYTE: the content's gaps between the changes, in order, are the new content's.
  let readBefore = 0;
  let readAfter = 0;
  const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, at) => byte === b[at]);
  for (const change of edit.changes) {
    if (!same(before.subarray(readBefore, change.before.start), after.subarray(readAfter, change.after.start))) {
      return err('a byte outside the edit changed');
    }
    readBefore = change.before.end;
    readAfter = change.after.end;
  }
  if (!same(before.subarray(readBefore), after.subarray(readAfter))) return err('a byte outside the edit changed');

  const was = showOperators(before);
  const now = showOperators(after);
  const insertedSpans = edit.changes.filter((change) => change.inserted).map((change) => change.after);
  const inside = (op: ShowOperator): boolean => insertedSpans.some((span) => op.start >= span.start && op.end <= span.end);
  const kept = now.filter((op) => !inside(op));
  if (kept.length !== was.length) return err(`${String(was.length)} operators became ${String(kept.length)}`);
  const emptied = new Set(edit.emptied);
  for (const [at, op] of was.entries()) {
    const now = kept[at];
    if (now === undefined) return err(`operator ${String(at)} is gone`);
    if (emptied.has(at)) {
      if (now.codes.length > 0) return err(`emptied operator ${String(at)} still shows a code`);
    } else if (!same(before.subarray(op.start, op.end), after.subarray(now.start, now.end))) {
      return err(`operator ${String(at)} changed`);
    }
  }
  // THE WORDS, as the inserted objects' own fonts read them: positions are MuPDF's to read back.
  const shown = now
    .filter(inside)
    .map((op) => {
      const font = op.state.font === null ? undefined : fonts.get(op.state.font);
      if (font?.toUnicode === null || font === undefined) return '\u0000';
      return codesOf(font, op.codes).map((code) => font.toUnicode?.text.get(code) ?? '\u0000').join('');
    })
    .join('');
  if (shown !== edit.drawn.join('')) return err('the inserted text does not read as the words drawn');
  return ok(undefined);
}
