import type { EditedBlock } from '@monstera/contract/host';
import { type LineRun, type Result, err, lineText, ok, replacementsForLine } from '@monstera/shared';

import type { PageFont } from './pageFonts.js';
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
 * Each typed line is diffed against the line it replaces by `replacementsForLine`'s rule, the PDFium writer's own
 * (ADR-0096 Decision 5). The runs before the first one the diff names keep their operators; from that run to the end
 * of the line every run is set again, each in its own state, keeping the gap it had to the run before it. A line the
 * edit moved down, because a line above it wrapped, is set again whole at its new baseline. A line the edit did not
 * reach is not touched.
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
  set(word: string, source: ShowOperator, own: (stretch: string) => FacePiece | null): readonly FacePiece[] | null;
}

interface Segment {
  readonly source: ShowOperator;
  readonly font: PageFont;
  readonly codes: number[];
  readonly text: string;
  /** Where it starts, in user space. */
  readonly x: number;
}

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
    const typed = block.text.replace(/\r\n?/gu, '\n').split('\n');
    const laid: string[] = [];

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
     * Lays out `words` set in `source`'s state from `x` on the current visual line, wrapping at the block's right edge
     * when `wraps`. Answers where it ended.
     */
    const layOut = (source: ShowOperator, words: string, x: number, wraps: boolean, left: number): number => {
      const font = fontOf(source);
      const unit = placed(indexOf.get(source) ?? -1).unit;
      let cursor = x;
      // A BREAK FALLS BEFORE A WORD, so the spaces it falls on end the line above and none starts the next.
      for (const token of tokens(words)) {
        let line = visual.at(-1);
        if (line === undefined) throw new Error('an operator edit laid out words before any line');
        const found = carrier(font, token);
        // A WORD THE PAGE CANNOT CARRY goes to the resolver's face or the box, where the caller gave faces (ADR-0177);
        // without them, or where they set nothing, its letters are named and the edit is refused.
        const pieces: readonly FacePiece[] | null =
          found !== null ? [found] : token === ' ' ? [] : (faces?.set(token, source, (stretch) => carrier(font, stretch)) ?? null);
        if (pieces === null) {
          for (const character of token) if (carrier(font, character) === null) uncarried.add(character);
          continue;
        }
        const widths = pieces.map((piece) => (advanceOf(piece.font, piece.codes, source.state) ?? 0) * unit);
        // A SPACE NO FONT CARRIES moves the pen by a nominal space; anything carried moves it by what draws it.
        const width =
          pieces.length === 0
            ? (SPACE_EM * source.state.size + source.state.charSpacing + source.state.wordSpacing) * source.state.scale * unit
            : widths.reduce((total, each) => total + each, 0);
        if (token !== ' ' && wraps && line.segments.length > 0 && cursor + width > blockRight + SAME) {
          visual.push({ baseline: line.baseline - pitch, segments: [] });
          line = visual.at(-1);
          cursor = left;
          if (line === undefined) throw new Error('an operator edit lost the line it wrapped to');
        }
        // EACH PIECE'S TEXT, the word's characters its codes show, so the segments still spell the word.
        const texts = pieces.length === 1 ? [token] : pieceTexts(pieces, token);
        let at = cursor;
        for (const [k, piece] of pieces.entries()) {
          const text = texts[k] ?? '';
          const last = line.segments.at(-1);
          // ONE SEGMENT for words that follow on in one font and state: a glyph's advance places the next exactly there.
          if (last?.source === source && last.font === piece.font && Math.abs(last.x + segmentWidth(last) - at) <= SAME) {
            last.codes.push(...piece.codes);
            line.segments[line.segments.length - 1] = { ...last, text: last.text + text };
          } else {
            line.segments.push({ source, font: piece.font, codes: [...piece.codes], text, x: at });
          }
          at += widths[k] ?? 0;
        }
        cursor += width;
      }
      return cursor;
    };
    const segmentWidth = (segment: Segment): number =>
      (advanceOf(segment.font, segment.codes, segment.source.state) ?? 0) * placed(indexOf.get(segment.source) ?? -1).unit;

    let previous = baselines[0] ?? 0;
    for (const [k, line] of lines.entries()) {
      const next = typed[k];
      const lineRuns: LineRun[] = line.map((run) => ({ index: run.run.index, text: run.run.text }));
      const left = line[0]?.origin.x ?? 0;
      if (next === undefined) {
        for (const run of line) empty(run.members);
        emptyBetween(line[0]?.first ?? 0, line.at(-1)?.last ?? -1);
        continue;
      }
      const target = k === 0 ? (baselines[0] ?? 0) : previous - ((baselines[k - 1] ?? 0) - (baselines[k] ?? 0));
      const moved = Math.abs(target - (baselines[k] ?? 0)) > SAME;
      const replacements = new Map(
        (moved ? lineRuns : replacementsForLine(lineRuns, next)).map((replacement) => [replacement.index, replacement.text]),
      );
      if (moved) for (const replacement of replacementsForLine(lineRuns, next)) replacements.set(replacement.index, replacement.text);
      const firstAt = line.findIndex((run) => replacements.has(run.run.index));
      if (firstAt === -1) {
        laid.push(lineText(lineRuns));
        previous = baselines[k] ?? 0;
        continue;
      }
      const changed = next !== lineText(lineRuns);
      visual.push({ baseline: target, segments: [] });
      const kept = line.slice(0, firstAt);
      let cursor = line[firstAt]?.origin.x ?? left;
      let previousEnd: number | null = null;
      for (const [at, run] of line.slice(firstAt).entries()) {
        const text = replacements.get(run.run.index) ?? run.run.text;
        const lastOfLine = at === line.length - firstAt - 1;
        // THE GAP IT HAD to the run before it, kept; a trailing space of a run with a run after it is that gap.
        if (previousEnd !== null) cursor = Math.max(cursor, cursor + (run.origin.x - previousEnd));
        const words = lastOfLine ? text : text.replace(/ +$/u, '');
        cursor = layOut(sourceOf(run), words, cursor, changed, left);
        previousEnd = run.right;
        empty(run.members);
      }
      emptyBetween(line[firstAt]?.first ?? 0, line.at(-1)?.last ?? -1);
      laid.push(lineText(kept.map((run) => ({ index: run.run.index, text: run.run.text }))) + line.slice(firstAt).map((run) => replacements.get(run.run.index) ?? run.run.text).join(''));
      previous = visual.at(-1)?.baseline ?? target;
    }
    // LINES TYPED BELOW THE BLOCK'S LAST, in its last run's state, from its last line's left.
    const lastLine = lines.at(-1) ?? firstLine;
    const lastRun = lastLine.at(-1) ?? firstRun;
    for (const extra of typed.slice(lines.length)) {
      previous -= pitch;
      laid.push(extra);
      if (extra === '') continue;
      visual.push({ baseline: previous, segments: [] });
      layOut(sourceOf(lastRun), extra, lastLine[0]?.origin.x ?? 0, true, lastLine[0]?.origin.x ?? 0);
      previous = visual.at(-1)?.baseline ?? previous;
    }
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
    for (const segment of segments) {
      if (segment.source !== replayed) {
        for (const setting of segment.source.settings) parts.push(decoder.decode(content.subarray(setting.start, setting.end)));
        replayed = segment.source;
        font = segment.source.state.font;
      }
      if (segment.font.resource !== font) {
        parts.push(`${pdfName(segment.font.resource)} ${num(segment.source.state.size)} Tf`);
        font = segment.font.resource;
      }
      const [a, b, c, d] = segment.source.state.matrix;
      const [e, f] = apply(toBt, segment.x, segment.baseline);
      parts.push(`${[a, b, c, d, e, f].map(num).join(' ')} Tm ${hexOf(segment.font, segment.codes)} Tj`);
    }
    parts.push('ET Q\n');
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
