import type { BlockMarkSet, BlockPlace, EditedBlock, PageInsert } from '@monstera/contract/host';
import { type Result, TAB_STOP, err, nextTabStop, ok } from '@monstera/shared';

import type { MovedBlock } from './engineSeam.js';
import type { PageFont } from './pageFonts.js';
import { type BlockPlan, type FlowLine, type Measure, NO_MARK, type Row, largestFit, planBlock } from './paragraphFlow.js';
import { type DecorationKind, decorationBand } from './markDecorations.js';
import { JUSTIFY_CAP, RISE_SCALE, SUBSCRIPT_DROP, SUPERSCRIPT_RISE, spaceable, spacedBy } from './markFigures.js';
import { type Alignment, blockShape, paragraphSpacing } from './paragraphShape.js';
import { carried, neighbourSpan } from './contentCarry.js';
import {
  type Matrix,
  type ShowOperator,
  type XObjectKind,
  contentEnd,
  contentLayout,
  multiply,
  showOperators,
  textObjectCount,
  textObjectEnds,
} from './textOperators.js';
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
 * operator — or after its `ET`, where that object holds the block's kept words before the edit and none after it, so
 * the page reads in order (ADR-0176's correction of 2026-10-19) — so inside the same marked content and under the same
 * CTM.
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
  // `where` NAMES WHICH TRANSFORM the edit could not reproduce, so a refusal on a page says which of its four shapes it met.
  | { readonly reason: 'transformed'; readonly where: 'content-end' | 'not-upright' | 'lines-under-different-ctms' | 'singular-ctm' }
  | { readonly reason: 'unknown-width'; readonly font: string }
  | { readonly reason: 'needs-a-face'; readonly characters: readonly string[] }
  | { readonly reason: 'unchanged' }
  // AN ARRANGE whose new place clips to an area that does not hold the block (ADR-0264 Decision 4).
  | { readonly reason: 'cropped' };

/**
 * What an arrange needs beyond the page's text (ADR-0264 Decision 5): what each XObject the content names is, so a drawn
 * neighbour is found as PDFium numbers it, and the name the caller will add a plain graphics state under.
 */
export interface ArrangeContext {
  readonly kinds: (name: string) => XObjectKind;
  readonly plainState: string;
}

/** No arrange is possible: no XObject is known, and a plain state is never named. */
const NO_ARRANGE: ArrangeContext = { kinds: () => undefined, plainState: '' };

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
  /** What each block says after the edit, its lines joined by line breaks. */
  readonly written: readonly string[];
  /**
   * The lines whose words this edit set, each on its own, which MuPDF's reading of the page must hold unbroken
   * ([ADR-0266](../../../docs/DECISIONS/0266-edit-text-writes-only-the-edited-blocks-own-instructions.md)). NOT a line the
   * edit left where it was or carried as its own operators: their bytes are the page's, which the structural read-back
   * holds byte for byte, and MuPDF may read them out of order as it read the page before (measured 2026-10-24: a line
   * ending in raised reference markers, which MuPDF reads as a line of their own elsewhere). Nor the words of an untouched
   * run that leads a line set afresh, which keep their operators.
   */
  readonly checked: readonly string[];
  /** What the inserted objects draw, block by block, in drawing order: the structural read-back reads it. */
  readonly drawn: readonly string[];
  /** Each block's first and last baseline after the edit, and its last before it, in user space. */
  readonly baselines: readonly { readonly first: number; readonly last: number; readonly lastBefore: number }[];
  /** The pushed blocks that moved down (ADR-0249): where each stood and how far it went. */
  readonly moved: readonly MovedBlock[];
  /** Whether the content names the plain graphics state an arrange carried a block with, which the page must then hold. */
  readonly plain: boolean;
}

/** Below this, two numbers in user space or a matrix's off-diagonal are the same: float noise, not a different layout. */
const SAME = 1e-6;

/**
 * A word space where neither the run's font nor a sibling draws one, in em: Liberation Sans' and Helvetica's own space
 * advance (278/1000). The gap is moved, never drawn, so a font with no space glyph is still spaced as its face would be.
 */
const SPACE_EM = 0.278;

/** The character a tab's gap is drawn as, under the mark that says it is a tab (ADR-0228 Decision 2): one place, W9. */
const TAB_GAP = ' ';

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

/** A string's bytes as a content stream writes it in hexadecimal, so no byte past ASCII is ever written. */
function hexOfBytes(bytes: Uint8Array): string {
  return `<${Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('')}>`;
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
  /** A line through the words (ADR-0228 Decision 1). */
  readonly strike: boolean;
  /** The colour drawn behind the words, in 0 to 255, or none. */
  readonly highlight: readonly [number, number, number] | undefined;
  /** User-space units `Tc` adds after every code shown. */
  readonly spacing: number;
}

interface Segment {
  readonly source: ShowOperator;
  readonly font: PageFont;
  readonly codes: number[];
  readonly text: string;
  /** Where it starts, in user space. */
  readonly x: number;
  readonly style: SegmentStyle | undefined;
  /**
   * The operator's own bytes, where this segment is an old operator carried to its new place as it was (a block placed,
   * ADR-0188): its glyphs, its kerning and its font are the page's, not a re-setting of its words.
   */
  readonly verbatim?: string;
  /**
   * What a marked gap IS, written as its `/ActualText` and never joined to the words beside it: a tab's one space marked
   * as the tab (ADR-0228 Decision 2), or a run of two or more spaces marked as exactly those spaces, which a text page
   * would read as one (the correction of 2026-10-16).
   */
  readonly actual?: string;
}

/** The `/ActualText` string a marked gap writes: `text` in UTF-16 with its byte-order mark, as a hex string. */
function actualTextString(text: string): string {
  return `<FEFF${Array.from({ length: text.length }, (_, at) => text.charCodeAt(at).toString(16).toUpperCase().padStart(4, '0')).join('')}>`;
}


interface VisualLine {
  readonly baseline: number;
  readonly segments: Segment[];
  /** Where its ink stands, in user space, for a line carried as it was: its glyphs' own advance is not asked of a font. */
  readonly extent?: { readonly left: number; readonly right: number };
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

/** Each typed line split into words and the spaces and tabs between them, one space or tab a token. */
function tokens(text: string): string[] {
  return text.match(/ |\t|[^ \t]+/gu) ?? [];
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
 * @param arrangeWith what a block's arrange needs (ADR-0264): none is possible without it
 */
export function editOperators(
  content: Uint8Array,
  fonts: ReadonlyMap<string, PageFont>,
  page: PageRuns,
  blocks: readonly EditedBlock[],
  faces: OperatorFaces | null = null,
  fit: 'reflow' | 'shrink' = 'reflow',
  inserts: readonly PageInsert[] = [],
  arrangeWith: ArrangeContext = NO_ARRANGE,
): Result<OperatorEdit, OperatorRefusal> {
  try {
    return ok(write(content, fonts, page, blocks, faces, fit, inserts, arrangeWith));
  } catch (error) {
    if (error instanceof Refused) return err(error.refusal);
    throw error;
  }
}

/** The matrix of a placement, `place`'s scale about `anchor`, then its turn about the centre that leaves, then its move. */
export function placementMatrix(
  place: Omit<BlockPlace, 'block'>,
  anchor: { readonly x: number; readonly y: number },
  centre: { readonly x: number; readonly y: number },
): Matrix {
  const scale = place.scale ?? 1;
  const radians = ((place.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const move = place.move ?? { x: 0, y: 0 };
  // THE CENTRE AFTER THE SCALE, which is what the turn is about (the PDFium writer's own rule, `placeObjects`).
  const turned = { x: anchor.x + (centre.x - anchor.x) * scale, y: anchor.y + (centre.y - anchor.y) * scale };
  const scaling: Matrix = [scale, 0, 0, scale, anchor.x * (1 - scale), anchor.y * (1 - scale)];
  const turning: Matrix = [cos, sin, -sin, cos, turned.x - turned.x * cos + turned.y * sin, turned.y - turned.x * sin - turned.y * cos];
  return multiply(multiply(scaling, turning), [1, 0, 0, 1, move.x, move.y]);
}

/**
 * The colour of a block's ONE mark where that mark covers all its words and sets nothing but a colour (ADR-0264 Decision
 * 5): Edit object's recolour, and Edit text's when a person colours a whole block. Otherwise none.
 */
function wholeColour(block: EditedBlock): readonly [number, number, number] | undefined {
  const marks = block.marks ?? [];
  const only = marks[0];
  const colour = only?.set.colour;
  if (marks.length !== 1 || only === undefined || colour === undefined) return undefined;
  if (only.from !== 0 || only.to < block.text.length || Object.keys(only.set).some((key) => key !== 'colour')) return undefined;
  return [colour.r, colour.g, colour.b];
}

/** Whether a placement changes anything about where a block is: a move of nothing is not one. */
function movesBlock(place: Omit<BlockPlace, 'block'> | undefined): boolean {
  return (
    place !== undefined &&
    ((place.scale ?? 1) !== 1 || (place.rotate ?? 0) !== 0 || (place.move?.x ?? 0) !== 0 || (place.move?.y ?? 0) !== 0)
  );
}

/** The seed a box of added text starts from, which its words replace: the PDFium writer's own one character. */
const SEED_TEXT = '.';

/** How far above and below its baseline a line of added text is taken to reach, in em: a face's ascent and descent, near enough for a centre. */
const ASCENT_EM = 0.8;
const DESCENT_EM = 0.2;

function write(
  content: Uint8Array,
  fonts: ReadonlyMap<string, PageFont>,
  page: PageRuns,
  blocks: readonly EditedBlock[],
  faces: OperatorFaces | null,
  fit: 'reflow' | 'shrink',
  inserts: readonly PageInsert[],
  arrangeWith: ArrangeContext,
): OperatorEdit {
  const real = showOperators(content);
  const objectEnds = textObjectEnds(content);
  const counted = textObjectCount(real);
  if (counted !== page.textObjects.length) {
    throw new Refused({
      reason: 'numbering',
      detail: `the content shows ${String(counted)} text objects and PDFium read ${String(page.textObjects.length)}`,
    });
  }
  // AN ADDED BOX IS AN EDIT OF ONE RUN that is not on the page: an operator made here, after the real ones, standing where
  // the box does and in the box's own size and colour, so the layout that writes every block writes it too (ADR-0188).
  // It is set under the CTM the content ends in, after the `Q`s that close what the content left open.
  const closing = inserts.length > 0 ? contentEnd(content) : undefined;
  const endInverse = closing === undefined ? null : inverse(closing.ctm);
  if (closing !== undefined && endInverse === null) throw new Refused({ reason: 'transformed', where: 'content-end' });
  const tail: number[] = [];
  const syntheticFonts = new Map<ShowOperator, PageFont>();
  const syntheticOps: ShowOperator[] = [];
  const seeds: PageRun[] = [];
  const encoder = new TextEncoder();
  for (const [k, insert] of inserts.entries()) {
    if (closing === undefined || endInverse === null) break;
    const colour = insert.base?.colour;
    const settings: { start: number; end: number }[] = [];
    if (colour !== undefined) {
      const bytes = encoder.encode(`${[colour.r, colour.g, colour.b].map((channel) => num(channel / 255)).join(' ')} rg`);
      settings.push({ start: content.length + tail.length, end: content.length + tail.length + bytes.length });
      tail.push(...bytes);
    }
    const [bx, by] = apply(endInverse, insert.left, insert.baseline);
    const matrix: Matrix = [endInverse[0], endInverse[1], endInverse[2], endInverse[3], bx, by];
    const op: ShowOperator = {
      object: null,
      operator: 'Tj',
      start: content.length,
      end: content.length,
      codes: new Uint8Array(0),
      elements: [],
      state: {
        font: null,
        size: insert.size,
        charSpacing: 0,
        wordSpacing: 0,
        scale: 1,
        leading: 0,
        rise: 0,
        render: 0,
        matrix,
        line: matrix,
        ctm: closing.ctm,
      },
      positionedAt: real.length + k,
      textObject: -1,
      settings,
    };
    syntheticOps.push(op);
    syntheticFonts.set(op, {
      resource: '',
      subtype: '',
      toUnicode: null,
      codeBytes: 1,
      width: () => null,
      draws: () => false,
      face: insert.base?.family ?? null,
      weight: null,
    });
    seeds.push({
      index: -1 - k,
      members: [-1 - k],
      text: SEED_TEXT,
      left: insert.left,
      right: insert.left,
      bottom: insert.baseline - DESCENT_EM * insert.size,
      top: insert.baseline + ASCENT_EM * insert.size,
    });
  }
  const tailBytes = Uint8Array.from(tail);
  /** The bytes of one setting: the content's own, or an added box's, which stand after the content's end. */
  const settingBytes = (setting: { readonly start: number; readonly end: number }): Uint8Array =>
    setting.start >= content.length
      ? tailBytes.subarray(setting.start - content.length, setting.end - content.length)
      : content.subarray(setting.start, setting.end);
  const ops = [...real, ...syntheticOps];
  const indexOf = new Map(ops.map((op, at) => [op, at]));
  /** Each PDFium page object's operator, by its index in `ops`: the k-th text object is `textObjects[k]`. */
  const opAt = new Map<number, number>();
  for (const [at, op] of ops.entries()) {
    const object = op.object === null ? undefined : page.textObjects[op.object];
    if (object !== undefined) opAt.set(object, at);
  }
  const runs = new Map(page.runs.map((run) => [run.index, run]));
  const memberOps = new Set(page.runs.flatMap((run) => run.members.map((member) => opAt.get(member) ?? -1)));
  // THE ADDED BOXES' SEEDS are runs of their own: named by a negative index, which no page object has, and shown by the
  // operator made for them.
  for (const [k, seed] of seeds.entries()) {
    runs.set(seed.index, seed);
    opAt.set(seed.index, real.length + k);
  }

  const fontOf = (op: ShowOperator): PageFont => {
    const added = syntheticFonts.get(op);
    if (added !== undefined) return added;
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
      throw new Refused({ reason: 'transformed', where: 'not-upright' });
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

  /**
   * `word` in the page's fonts, the longest stretch first, each stretch in the first of `own` and its siblings that
   * carries all of it; `null` where some character is carried by none of them.
   */
  const acrossPageFonts = (own: PageFont, word: string): FacePiece[] | null => {
    const characters = Array.from(word);
    const pieces: FacePiece[] = [];
    let at = 0;
    while (at < characters.length) {
      let end = characters.length;
      let hit = carrier(own, characters.slice(at, end).join(''));
      while (hit === null && end > at + 1) {
        end -= 1;
        hit = carrier(own, characters.slice(at, end).join(''));
      }
      if (hit === null) return null;
      pieces.push(hit);
      at = end;
    }
    return pieces;
  };

  const emptied = new Set<number>();
  /** The operators a block's rewrite is placed before: their `BT`, one inserted object per block. */
  const insertions: { readonly at: number; readonly text: string }[] = [];
  const written: string[] = [];
  const checked: string[] = [];
  const drawn: string[] = [];
  const baselinesOut: { first: number; last: number; lastBefore: number }[] = [];
  const uncarried = new Set<string>();
  /** What each block grew, by its place in the edit: its old last baseline less its new one (ADR-0249 Decision 1). */
  const grew = new Map<number, number>();
  /** The pushed blocks that moved, where they stood and how far down they went: the PDFium writer's own answer. */
  const moved: MovedBlock[] = [];
  /** Whether an arrange carried a block with the plain graphics state, which the page must then hold (ADR-0264). */
  let plain = false;

  /** What an added box is among the blocks: the seed's run, and the box's own base style. */
  const boxes = inserts.map((insert, k) => ({
    insert,
    block: {
      lines: [[-1 - k]],
      soft: [false],
      text: insert.text,
      ...(insert.marks === undefined ? {} : { marks: insert.marks }),
      ...(insert.paragraphs === undefined ? {} : { paragraphs: insert.paragraphs }),
      place: { width: insert.measure },
    } satisfies EditedBlock,
  }));
  /** An added box's `Q`s that close what the content left open: said once, before the first box. */
  let closed = false;
  const jobs: { readonly block: EditedBlock; readonly insert: PageInsert | undefined }[] = [
    ...blocks.map((block) => ({ block, insert: undefined })),
    ...boxes,
  ];

  for (const [jobAt, { block, insert }] of jobs.entries()) {
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
    // ONE INSERTED OBJECT DRAWS EVERY LINE under the first line's CTM, each line's origin taken from page space back
    // through it (`toBt` below). So a block whose lines differ only by a TRANSLATION — each line set in its own
    // `q 1 0 0 1 x y cm … Q`, as some producers write every line — is reproduced exactly: the origins already carry the
    // translation, and the same scale and turn set every glyph alike. What one object cannot reproduce is a different
    // scale or turn, or a line drawn through a clip the first line is not drawn through, since the object stands where the
    // first line did. Measured 2026-10-23: 25 blocks of one corpus document refused every edit on this rule.
    /** Whether `op`'s CTM matches the first line's in its first `count` entries: 6 is the whole, 4 its scale and turn. */
    const matches = (op: ShowOperator | undefined, count: 4 | 6): boolean =>
      op !== undefined && ctm !== undefined && op.state.ctm.slice(0, count).every((value, at) => Math.abs(value - (ctm[at] ?? 0)) <= SAME);
    const members = lines.flatMap((line) => line.flatMap((run) => run.members));
    if (!members.every((member) => matches(ops[member], 6))) {
      const starts = members.map((member) => ops[member]?.start ?? 0);
      const windows = contentLayout(content, arrangeWith.kinds, starts).states.map((state) => JSON.stringify(state.windows.map((window) => window.points)));
      if (!members.every((member) => matches(ops[member], 4)) || windows.some((each) => each !== windows[0])) {
        throw new Refused({ reason: 'transformed', where: 'lines-under-different-ctms' });
      }
    }
    const inkRight = Math.max(...lines.flat().map((run) => run.right));
    const baselines = lines.map((line) => line[0]?.origin.y ?? 0);
    // A PUSHED BLOCK IS MOVED BY WHAT ITS PUSHER GREW, or not at all where that passes its room (ADR-0249 Decision 3), by
    // the placement below: the PDFium writer's rule, so the two writers move the text below a growing block alike.
    const { push } = block;
    const growth = push === undefined ? 0 : (grew.get(push.by) ?? 0);
    const pushMove = push !== undefined && growth > 0 && growth <= push.room ? growth : 0;
    // A PUSHED BLOCK THAT DOES NOT MOVE IS LEFT ALONE, the PDFium writer's rule and its reason: nothing of it is written
    // either way, and setting it to prove so is the whole cost of the text below a heading.
    if (push !== undefined && pushMove === 0) continue;
    if (pushMove > 0) {
      moved.push({
        block: jobAt,
        box: {
          x0: Math.min(...lines.flat().map((run) => run.run.left)),
          y0: Math.min(...lines.flat().map((run) => run.run.bottom)),
          x1: Math.max(...lines.flat().map((run) => run.run.right)),
          y1: Math.max(...lines.flat().map((run) => run.run.top)),
        },
        down: pushMove,
      });
    }
    // WHAT THE PERSON DID TO THE BLOCK AS A WHOLE (ADR-0188): placed, so every line of it is set again under one `cm`, or
    // given a measure, so every paragraph of it is. Either way no line of it is left where it was.
    const blockPlace = push === undefined ? block.place : pushMove > 0 ? { move: { x: 0, y: -pushMove } } : undefined;
    const measured = blockPlace?.width !== undefined;
    // AND A BLOCK RECOLOURED WHOLE (ADR-0264 Decision 5) is set again in place, every line carried as it was with its
    // colour set: decided once the plan has said its words are the read's, below.
    // AN ARRANGE carries every line as it was too, to its new place in the drawing order (ADR-0264 Decision 5).
    let replaceAll = movesBlock(blockPlace) || measured || blockPlace?.arrange !== undefined;
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
    /** The lines whose words this edit sets, each on its own: what MuPDF's reading must hold ({@link OperatorEdit.checked}). */
    const setLines: string[] = [];
    /**
     * The scale the block is set at: 1 for `reflow`, and for `shrink` the largest that ends the block no lower than its
     * old last line did (ADR-0181 Decision 10). Every size, every width and every gap between lines is multiplied by it,
     * so the block is the page's block made smaller as one picture is, and the plan wraps at the width the words then
     * measure.
     */
    let shrink = 1;
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
    // A MEASURE THE PERSON GAVE is the measure, from the block's own left edge (the PDFium writer's rule).
    const blockRight = blockPlace?.width !== undefined ? blockLeft + blockPlace.width : inkRight;
    const restOrigin = Math.min(...(lines.length > 1 ? lines.slice(1) : lines).map((line) => line[0]?.origin.x ?? 0));

    /** Empties a run's operators, and the inkless spaces PDFium joined into it that no run holds. */
    const empty = (members: readonly number[]): void => {
      // AN ADDED BOX'S SEED IS NO OPERATOR OF THE PAGE, so it has nothing to empty.
      for (const member of members) if (member < real.length) own.add(member);
    };
    /** The operators from `from` to `to` that are a space no run holds: the one rule for what a line's edit removes or carries. */
    const spacesBetween = (from: number, to: number): number[] => {
      const found: number[] = [];
      for (let at = from; at <= to; at += 1) {
        const op = ops[at];
        if (op === undefined || memberOps.has(at) || op.codes.length === 0) continue;
        const font = op.state.font === null ? undefined : fonts.get(op.state.font);
        const text = font?.toUnicode === null || font === undefined ? null : codesOf(font, op.codes).map((code) => font.toUnicode?.text.get(code) ?? '\u0000');
        // ONLY A SPACE: anything else no run holds is not this edit's to remove.
        if (text?.every((character) => /^\s$/u.test(character)) === true) found.push(at);
      }
      return found;
    };
    const emptyBetween = (from: number, to: number): void => {
      for (const at of spacesBetween(from, to)) own.add(at);
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
      // A WORD NO ONE PAGE FONT CARRIES, set across them in the longest stretches each carries (ADR-0176's correction of
      // 2026-10-19, later): a letter typed before a full stop Chromium drew in a subset holding only `.`.
      const across = found !== null || restyle !== undefined || token === ' ' ? null : acrossPageFonts(font, token);
      const pieces: readonly FacePiece[] | null =
        found !== null
          ? [found]
          : token === ' '
            ? []
            : (across ??
              faces?.set(token, source, restyle === undefined ? (stretch) => carrier(font, stretch) : () => null, restyle) ??
              null);
      if (pieces === null) {
        const before = uncarried.size;
        for (const character of token) if (restyle !== undefined || carrier(font, character) === null) uncarried.add(character);
        // NEVER DROPPED UNSAID: a word that yields no pieces names its characters, so the edit is refused by name or the
        // caller gives it a face, and its words cannot vanish with nothing reported.
        if (uncarried.size === before) for (const character of token) uncarried.add(character);
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
      // CHARACTER SPACING IN USER SPACE, at the size the words are drawn: the wire's fraction of that size.
      const spacing = (set.spacing ?? 0) * size * (set.rise === undefined ? 1 : RISE_SCALE);
      return { set, source, font, sizePt, restyle, size, factor, rise, spacing };
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
        set.strike === true ||
        (set.highlight !== undefined && set.highlight !== null) ||
        (set.spacing !== undefined && set.spacing !== 0) ||
        set.rise !== undefined
      );
    };
    // AN ADDED BOX'S OWN LOOK is every word's, under the marks over it: its family, weight and slant go to the face the
    // resolver picks, as a mark's do (the PDFium writer seeds the box's object with them).
    const base = insert?.base;
    const insertBase: Restyle | undefined =
      base === undefined || (base.bold === undefined && base.italic === undefined && base.family === undefined)
        ? undefined
        : {
            ...(base.bold === undefined ? {} : { bold: base.bold }),
            ...(base.italic === undefined ? {} : { italic: base.italic }),
            ...(base.family === undefined ? {} : { family: base.family }),
          };
    const restyleOf = (marked: ReturnType<typeof markStyle> | undefined): Restyle | undefined =>
      insertBase === undefined ? marked?.restyle : marked?.restyle === undefined ? insertBase : { ...insertBase, ...marked.restyle };
    /** How far the pen moves for `pieces` in `source`'s state: a space no font carries moves it by a nominal space. */
    const pieceWidths =(source: ShowOperator, pieces: readonly FacePiece[], unit: number): number[] =>
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
      const unit = placed(run.first).unit * (marked?.factor ?? 1) * shrink;
      return (
        tokens(text).reduce((sum, token) => {
          // A TAB IS AT MOST A WHOLE STOP, the PDFium writer's rule: where it ends depends on where it starts.
          if (token === '\t') return sum + TAB_STOP;
          const pieces = piecesOf(source, token, restyleOf(marked));
          return pieces === null ? sum : sum + widthOfPieces(source, pieces, unit);
        }, 0) + spacedBy(text.replace(/\t/gu, ''), (marked?.spacing ?? 0) * shrink)
      );
    };

    /**
     * Lays out `words` set in `source`'s state from `x` on `line`, answering where it ended. `marked` is the mark that
     * styles them, where one does: its face, its size and rise, its colour, its drawings and its spacing. `perSpace` is
     * what a justified line adds after each space (ADR-0228 Decision 1).
     */
    const layOut = (
      source: ShowOperator,
      words: string,
      x: number,
      line: VisualLine,
      marked?: ReturnType<typeof markStyle>,
      perSpace = 0,
    ): number => {
      const unit = placed(indexOf.get(source) ?? -1).unit * (marked?.factor ?? 1) * shrink;
      // NO SPACING NOR STRETCH IN A JOINED RIGHT-TO-LEFT SCRIPT, the measure's own rule (`spacedBy`).
      const spacing = spaceable(words) ? (marked?.spacing ?? 0) * shrink : 0;
      const stretch = spaceable(words) ? perSpace : 0;
      const highlight = marked?.set.highlight ?? null;
      const style: SegmentStyle | undefined =
        marked === undefined && shrink === 1
          ? undefined
          : {
              colour: marked?.set.colour === undefined ? undefined : [marked.set.colour.r, marked.set.colour.g, marked.set.colour.b],
              factor: (marked?.factor ?? 1) * shrink,
              rise: (marked?.rise ?? 0) * shrink,
              underline: marked?.set.underline === true,
              strike: marked?.set.strike === true,
              highlight: highlight === null ? undefined : [highlight.r, highlight.g, highlight.b],
              spacing,
            };
      let cursor = x;
      const typed = tokens(words);
      for (const [index, token] of typed.entries()) {
        // A SPACE IN A RUN OF TWO OR MORE goes into a segment of the run's spaces alone, marked as exactly them (ADR-0228's
        // correction of 2026-10-16): joined to the words, a text page reads the run as one space.
        const inRun = token === ' ' && (typed[index - 1] === ' ' || typed[index + 1] === ' ');
        // A TAB IS A MARKED GAP (ADR-0228 Decision 2): a space shown as a segment of its own, which the emission wraps in
        // `/Span <</ActualText (tab)>>`, and the next words at the next stop from the block's left edge. A font with no
        // space draws nothing there, and the gap is still the stop's.
        if (token === '\t') {
          const gap = piecesOf(source, TAB_GAP, restyleOf(marked));
          const piece = gap?.length === 1 ? gap[0] : undefined;
          if (piece !== undefined) {
            faces?.drawn([piece]);
            line.segments.push({ source, font: piece.font, codes: [...piece.codes], text: '\t', x: cursor, style, actual: '\t' });
          }
          cursor = nextTabStop(cursor, blockLeft);
          continue;
        }
        const pieces = piecesOf(source, token, restyleOf(marked));
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
          // A RUN'S SPACE JOINS ONLY ITS RUN, and words join only words.
          const joins = inRun ? last?.actual !== undefined && last.actual !== '\t' : last?.actual === undefined;
          if (
            joins &&
            last?.verbatim === undefined &&
            last?.source === source &&
            last.font === piece.font &&
            last.style === style &&
            Math.abs(last.x + segmentWidth(last) - at) <= SAME
          ) {
            last.codes.push(...piece.codes);
            line.segments[line.segments.length - 1] = {
              ...last,
              text: last.text + text,
              ...(inRun ? { actual: `${last.actual ?? ''}${text}` } : {}),
            };
          } else {
            line.segments.push({ source, font: piece.font, codes: [...piece.codes], text, x: at, style, ...(inRun ? { actual: text } : {}) });
          }
          // `Tc` MOVES THE PEN AFTER EVERY CODE SHOWN, so the spacing is the codes' count's.
          at += (widths[k] ?? 0) + spacing * piece.codes.length;
        }
        // A SPACE NO FONT CARRIES is no code, and still takes its spacing, as the measure counts it; a justified line's
        // space then moves the pen on, which starts the next word in a segment of its own at its own `Tm`.
        cursor += width + (pieces.length === 0 ? spacedBy(token, spacing) : spacing * pieces.reduce((sum, piece) => sum + piece.codes.length, 0));
        if (token === ' ') cursor += stretch;
      }
      return cursor;
    };
    const segmentWidth = (segment: Segment): number =>
      (advanceOf(segment.font, segment.codes, segment.source.state) ?? 0) *
        placed(indexOf.get(segment.source) ?? -1).unit *
        (segment.style?.factor ?? 1) +
      (segment.style?.spacing ?? 0) * segment.codes.length;
    /**
     * Carries `line`'s operators to the block's new place as they are, `dy` lower than they stood, each an object of its
     * own at the origin it was drawn from: its codes, its kerning and its font are the page's. False where one cannot be
     * (a quote operator, whose move depends on the line the operator before it left, or a font the page lacks), and the
     * line's words are then set again.
     */
    /**
     * `line`'s operators as they can be carried, each with its place and font, the spaces between its runs among them, in
     * the order they stood; `null` where one cannot be (a quote operator, whose move depends on the line the operator
     * before it left, or a font the page lacks).
     */
    const carriedOf = (
      line: typeof firstLine,
    ): { readonly op: ShowOperator; readonly at: number; readonly font: PageFont; readonly run: (typeof firstLine)[number] }[] | null => {
      const carried: { readonly op: ShowOperator; readonly at: number; readonly font: PageFont; readonly run: (typeof firstLine)[number] }[] = [];
      for (const run of line) {
        for (const member of run.members) {
          const op = ops[member];
          const font = fonts.get(op?.state.font ?? '');
          if (op === undefined || font === undefined || (op.operator !== 'Tj' && op.operator !== 'TJ')) return null;
          carried.push({ op, at: member, font, run });
        }
      }
      // THE SPACES BETWEEN ITS RUNS GO WITH IT, drawn glyphs that no run holds: left behind they would be emptied with the
      // line, and a reader would find the words run together where the page had them apart.
      const first = Math.min(...line.map((run) => run.first));
      const last = Math.max(...line.map((run) => run.last));
      for (const at of spacesBetween(first, last)) {
        const op = ops[at];
        const font = fonts.get(op?.state.font ?? '');
        const run = line.find((candidate) => candidate.first <= at && at <= candidate.last) ?? line[0];
        if (op === undefined || font === undefined || run === undefined || (op.operator !== 'Tj' && op.operator !== 'TJ')) return null;
        carried.push({ op, at, font, run });
      }
      // IN THE ORDER THEY STOOD: a reader that takes the page in content order reads the spaces where the words were.
      return carried.sort((a, b) => a.at - b.at);
    };
    const replay = (line: (typeof firstLine), dy: number): boolean => {
      const carried = carriedOf(line);
      if (carried === null) return false;
      // A BLOCK RECOLOURED WHOLE carries its colour on every operator (ADR-0264 Decision 5); nothing else about it changes.
      const style: SegmentStyle | undefined =
        carriedColour === undefined
          ? undefined
          : { colour: carriedColour, factor: 1, rise: 0, underline: false, strike: false, highlight: undefined, spacing: 0 };
      for (const { op, at, font, run } of carried) {
        const origin = placed(at);
        const shown = op.elements.map((element) => (typeof element === 'number' ? num(element) : hexOfBytes(element)));
        const codes = codesOf(font, op.codes);
        visual.push({
          baseline: origin.y + dy,
          // THE OPERATOR'S OWN INK IS ITS RUN'S, which is what a turn's centre is worked out from.
          extent: { left: run.run.left, right: run.run.right },
          segments: [
            {
              source: op,
              font,
              codes,
              // THE WORDS AS THE STRUCTURAL READ-BACK READS THEM: a font with no ToUnicode shows one unknown character.
              text: font.toUnicode === null ? '\u0000' : codes.map((code) => font.toUnicode?.text.get(code) ?? '\u0000').join(''),
              x: origin.x,
              style,
              verbatim: op.operator === 'TJ' ? `[${shown.join(' ')}] TJ` : `${shown.join(' ')} Tj`,
            },
          ],
        });
      }
      return true;
    };

    // HOW EACH PARAGRAPH IS SET: the block's shape with what the person set over it (ADR-0180 Decision 2), as the PDFium
    // writer reads it. Edges are origins here, since an operator is placed by where its glyph is drawn from.
    const settings = new Map((block.paragraphs ?? []).map((setting) => [setting.paragraph, setting]));
    const setFor = (place: number): { align: Alignment | 'justify'; leftEdge: number; first: number; centre: number } => {
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
    const text = block.text.replace(/\r\n?/gu, '\n');
    const forced = new Set([
      ...(block.paragraphs ?? [])
        .filter(
          (setting) =>
            (setting.align !== undefined && setting.align !== shape.align) ||
            (setting.leftIndent !== undefined && Math.abs(blockLeft + setting.leftIndent - restOrigin) > 0.5) ||
            (setting.firstIndent !== undefined && Math.abs(setting.firstIndent - shape.firstIndent) > 0.5) ||
            (setting.lineSpacing !== undefined && Math.abs(setting.lineSpacing - 1) > 0.01) ||
            (setting.spaceBefore !== undefined && setting.spaceBefore > 0.5) ||
            (setting.spaceAfter !== undefined && setting.spaceAfter > 0.5),
        )
        .map((setting) => setting.paragraph),
      // SPACE AFTER A PARAGRAPH is the gap above the next one's first line, so the paragraph after it is set again too.
      ...(block.paragraphs ?? [])
        .filter((setting) => setting.spaceAfter !== undefined && setting.spaceAfter > 0.5)
        .map((setting) => setting.paragraph + 1),
      // A NEW MEASURE SETS EVERY PARAGRAPH AGAIN, words or not: the lines the old measure broke are not the lines the new
      // one does.
      ...(measured ? Array.from({ length: text.split('\n').length }, (_, paragraph) => paragraph) : []),
    ]);
    const marked = { marks: (block.marks ?? []).map(({ from, to }) => ({ from, to })), changes, forced };
    // A WHOLE-BLOCK COLOUR is planned as no change to the words, so the plan says whether they are the read's.
    const colour = push === undefined && block.place === undefined && fit === 'reflow' && (block.paragraphs?.length ?? 0) === 0 ? wholeColour(block) : undefined;
    let formatting = colour === undefined ? marked : { marks: [], changes: (): boolean => false, forced };
    const oldGap = (line: number): number => (baselines[line - 1] ?? 0) - (baselines[line] ?? 0);
    /**
     * Where each row's baseline falls at `scale`: the first where the block's first line was, and each after it a gap
     * lower. THE GAP ABOVE A LINE is the person's own where they set the paragraph's spacing, else the gap the line it
     * stands in had, else the block's pitch (and its paragraph spacing where it opens a paragraph); at a scale below 1 it
     * is that much smaller. The ONE place a row's baseline is worked out, asked by the fit as well as the layout (B3a).
     */
    const rowTargets = (rows: readonly Row[], scale: number): number[] => {
      const targets: number[] = [];
      let above = baselines[0] ?? 0;
      for (const [at, row] of rows.entries()) {
        const given = row.kind === 'new' ? settings.get(row.paragraph) : undefined;
        // THE SPACE AFTER THE PARAGRAPH ABOVE, added to this one's space before, the PDFium writer's rule (ADR-0228).
        const afterAbove = row.kind === 'new' && row.first && at > 0 ? settings.get(row.paragraph - 1)?.spaceAfter : undefined;
        const between = (given?.spaceBefore ?? (afterAbove === undefined ? spacing : 0)) + (afterAbove ?? 0);
        const spaced = given?.lineSpacing !== undefined || given?.spaceBefore !== undefined || afterAbove !== undefined;
        const gap =
          row.kind === 'old'
            ? oldGap(row.line)
            : row.kind === 'blank'
              ? pitch + (row.opens ? spacing : 0)
              : spaced
                ? pitch * (given?.lineSpacing ?? 1) + (row.first && at > 0 ? between : 0)
                : row.replaces > 0
                  ? oldGap(row.replaces)
                  : pitch + (row.opens ? spacing : 0);
        above = at === 0 ? (baselines[0] ?? 0) : above - gap * scale;
        targets.push(above);
      }
      return targets;
    };
    const planAt = (scale: number): BlockPlan => {
      shrink = scale;
      return planBlock(flow, text, measure, limits, formatting);
    };
    // A BLOCK FITS when its last line sits no lower than its old last line did (a baseline, not a bounding box: a
    // descender is not a line), which is the PDFium writer's own rule, and its bounds and steps are the same ones.
    if (fit === 'shrink') {
      shrink = largestFit((scale) => (rowTargets(planAt(scale).rows, scale).at(-1) ?? 0) >= (baselines.at(-1) ?? 0) - SAME);
    }
    let plan = planAt(shrink);
    /**
     * The colour every line of the block is carried in, as it was (ADR-0264 Decision 5): a block whose words are the read's,
     * every row one of its own lines, and every line one this writer can carry. Otherwise the mark is a mark, laid out as
     * any other: a line that cannot be carried would otherwise lose the colour it was asked for.
     */
    let carriedColour: readonly [number, number, number] | undefined;
    if (colour !== undefined) {
      const unchanged = plan.rows.length === lines.length && plan.rows.every((row, at) => row.kind === 'old' && row.line === at);
      if (unchanged && lines.every((line) => carriedOf(line) !== null)) {
        carriedColour = colour;
        replaceAll = true;
      } else {
        formatting = marked;
        plan = planAt(shrink);
      }
    }
    const targets = rowTargets(plan.rows, shrink);
    // A PUSHED BLOCK IS NEVER WRITTEN (ADR-0249 Decision 3): every row one of its own lines, as it was, or the edit is
    // refused — words nobody typed into a block nobody opened.
    if (push !== undefined && !(plan.rows.length === lines.length && plan.rows.every((row, at) => row.kind === 'old' && row.line === at))) {
      throw new Refused({ reason: 'numbering', detail: 'a block moved by another’s growth would have had its words set again' });
    }

    /** The old lines the plan keeps exactly as they are: their operators are not touched. */
    const kept = new Set<number>();
    /** How many leading runs of an old line a line set afresh leaves untouched. */
    const keptRuns = new Map<number, number>();
    let previous = baselines[0] ?? 0;
    for (const [at, row] of plan.rows.entries()) {
      const given = row.kind === 'new' ? settings.get(row.paragraph) : undefined;
      const target = targets[at] ?? previous;
      previous = target;
      if (row.kind === 'blank') {
        laid.push('');
        continue;
      }
      if (row.kind === 'old') {
        const line = lines[row.line];
        if (line === undefined) continue;
        const text = line.map((run) => run.run.text).join('');
        // A LINE THAT DID NOT MOVE is not touched.
        if (shrink === 1 && !replaceAll && Math.abs(target - (baselines[row.line] ?? 0)) <= SAME) {
          kept.add(row.line);
          laid.push(text);
          continue;
        }
        // A LINE AN EARLIER WRAP MOVED DOWN, and every line of a block placed or given a measure, is carried as it is,
        // operator by operator at its new place, so its glyphs, kerning and fonts are the page's and only its position
        // changes (ADR-0188; ADR-0266 Decision 1, the owner's *only their positions change, never their text or fonts*).
        if (shrink === 1 && replay(line, target - (baselines[row.line] ?? 0))) {
          laid.push(text);
          continue;
        }
        // ONLY A LINE THAT CANNOT BE CARRIED is set again whole at its new baseline, keeping the gap each run had to the one
        // before it.
        const placedLine: VisualLine = { baseline: target, segments: [] };
        visual.push(placedLine);
        let cursor = line[0]?.origin.x ?? 0;
        let previousEnd: number | null = null;
        for (const [index, run] of line.entries()) {
          if (previousEnd !== null) cursor += (run.origin.x - previousEnd) * shrink;
          // A TRAILING SPACE OF A RUN WITH A RUN AFTER IT is the gap that run keeps.
          const words = index === line.length - 1 ? run.run.text : run.run.text.replace(/ +$/u, '');
          cursor = layOut(sourceOf(run), words, cursor, placedLine);
          previousEnd = run.right;
        }
        laid.push(text);
        setLines.push(text);
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
      if (shrink === 1 && !replaceAll && replaced !== undefined && set.align === 'left' && keepsItsLine && Math.abs(target - (baselines[row.replaces] ?? 0)) <= SAME) {
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
      // A JUSTIFIED PARAGRAPH'S WRAPPED LINE widens its spaces to the measure, capped as the PDFium writer caps it; its last
      // line is not stretched (ADR-0228 Decision 1).
      const setting = row.pieces.slice(untouched);
      const spaces =
        set.align === 'justify' && !row.last
          ? setting.reduce(
              (sum, piece, at) =>
                sum +
                (spaceable(piece.text)
                  ? Array.from(at === setting.length - 1 ? piece.text.trimEnd() : piece.text).filter((each) => each === ' ').length
                  : 0),
              0,
            )
          : 0;
      const smallest = Math.min(
        ...setting.map((piece) => {
          const run = byId.get(piece.run) ?? firstRun;
          return sourceOf(run).state.size * placed(run.first).unit * shrink;
        }),
      );
      const perSpace = spaces === 0 ? 0 : Math.max(0, Math.min((blockRight - x - row.width) / spaces, JUSTIFY_CAP * smallest));
      let cursor = x;
      for (const piece of setting) {
        const run = byId.get(piece.run) ?? firstRun;
        cursor = layOut(
          sourceOf(run),
          piece.text,
          cursor,
          placedLine,
          piece.mark === NO_MARK ? undefined : markStyle(run, piece.mark),
          perSpace,
        );
      }
      laid.push(row.pieces.map((piece) => piece.text).join(''));
      setLines.push(setting.map((piece) => piece.text).join(''));
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
    checked.push(...setLines);
    baselinesOut.push({ first: baselines[0] ?? 0, last: previous, lastBefore: baselines.at(-1) ?? 0 });
    // WHAT THE BLOCK GREW, for the blocks it pushes; a placed block and a pushed one push nothing (the PDFium writer's rule).
    if (block.place === undefined && push === undefined) grew.set(jobAt, (baselines.at(-1) ?? 0) - previous);

    const segments = visual.flatMap((line) => line.segments.map((segment) => ({ ...segment, baseline: line.baseline })));
    // WHAT THE CODES SHOW, which the structural read-back reads them as: a tab's segment means a tab and draws its gap
    // (W9; read as the tab it stood for, every tab edit on this writer was refused as not reading as what it drew).
    drawn.push(segments.map((segment) => (segment.actual === '\t' ? TAB_GAP : segment.text)).join(''));
    if (segments.length === 0) continue;
    // THE CTM WHERE THE NEW OBJECT STANDS, which every position below is converted into: an arranged block is carried with
    // its first line's state (`contentCarry.ts`); lines only added go after the last run's text object; anything else goes
    // at the first text object it empties. These are one CTM while a block's lines share one; where they differ by a
    // translation (above), the first line's would set every line the edit writes off by the difference.
    const standsAt =
      (push === undefined ? blockPlace?.arrange : undefined) !== undefined
        ? firstRun.first
        : own.size === 0
          ? lastRun.last
          : [...own].reduce((best, at) => ((ops[at]?.textObject ?? 0) < (ops[best]?.textObject ?? 0) ? at : best));
    const here = ops[standsAt]?.state.ctm;
    const toBt = here === undefined ? null : inverse(here);
    if (toBt === null || here === undefined) throw new Refused({ reason: 'transformed', where: 'singular-ctm' });
    const decoder = new TextDecoder('latin1');
    // THE BLOCK PLACED (ADR-0188): one `cm` in front of the object, which is the placement in the space the words are
    // written in, so it moves, scales and turns every line of the block, the ones carried as they were and the ones set
    // afresh, as the one thing the block is. The placement is worked out in user space, as the PDFium writer works it out:
    // scaled about the block's top left, turned about the centre of what that leaves, then moved. (A turn is about a
    // centre and no other placement needs one, so the extent is worked out only for a turn.)
    let cm: Matrix | null = null;
    if (blockPlace !== undefined && movesBlock(blockPlace)) {
      const anchor = { x: Math.min(...lines.flat().map((run) => run.run.left)), y: Math.max(...lines.flat().map((run) => run.run.top)) };
      let centre = anchor;
      if ((blockPlace.rotate ?? 0) !== 0) {
        const pointSize = lead.state.size * firstRun.origin.up;
        const above = Math.max(ASCENT_EM * pointSize, ...lines.flat().map((run) => run.run.top - run.origin.y));
        const below = Math.max(DESCENT_EM * pointSize, ...lines.flat().map((run) => run.origin.y - run.run.bottom));
        const reaches = visual.map((line) => ({
          left: line.extent?.left ?? Math.min(...line.segments.map((segment) => segment.x)),
          right: line.extent?.right ?? Math.max(...line.segments.map((segment) => segment.x + segmentWidth(segment))),
          top: line.baseline + above,
          bottom: line.baseline - below,
        }));
        centre = {
          x: (Math.min(...reaches.map((reach) => reach.left)) + Math.max(...reaches.map((reach) => reach.right))) / 2,
          y: (Math.min(...reaches.map((reach) => reach.bottom)) + Math.max(...reaches.map((reach) => reach.top))) / 2,
        };
      }
      cm = multiply(multiply(here, placementMatrix(blockPlace, anchor, centre)), toBt);
    }
    const parts = cm === null ? ['q BT'] : ['q', `${cm.map(num).join(' ')} cm`, 'BT'];
    /** An instruction's settings as bytes, to tell whether two operators were drawn under the same ones. */
    const settingsKey = (op: ShowOperator): string => op.settings.map((setting) => `${String(setting.start)}:${String(setting.end)}`).join(',');
    let replayed: ShowOperator | null = null;
    let font: string | null = null;
    let fontSize = 0;
    /** Whether the fill colour in force is a mark's, so the next segment starts from the source's own again. */
    let tinted = false;
    /** The rules under and through marked words, drawn after the text object, in the same space. */
    const rules: string[] = [];
    /** The colours behind highlighted words, drawn BEFORE the text object, in the same space, so the words are over them. */
    const behind: string[] = [];
    /**
     * The `Tc` this writer last said, or `null` while it has said none and the page's own is in force. Once said it is
     * said again wherever it differs from what the next segment needs: a source's settings replayed need not name a `Tc`,
     * so a mark's spacing would otherwise carry on into the words after it, the fill colour's reason (`tinted`).
     */
    let said: number | null = null;
    for (const segment of segments) {
      const style = segment.style;
      if (segment.source !== replayed || tinted) {
        // OPERATORS CARRIED AS THEY WERE under the same settings as the one before say them once.
        const sameAsBefore =
          !tinted && segment.verbatim !== undefined && replayed !== null && settingsKey(segment.source) === settingsKey(replayed);
        if (!sameAsBefore) {
          const settings = segment.source.settings.map((setting) => decoder.decode(settingBytes(setting)));
          parts.push(...settings);
          // A PAGE THAT NEVER SET A FILL COLOUR draws in the default, which is black; leaving a mark's colour in force would
          // paint every word after it in that colour, so the default is said where the source says nothing.
          if (tinted && !settings.some((setting) => /(^|\s)(g|rg|k|sc|scn)(\s|$)/u.test(setting))) parts.push('0 g');
          font = segment.source.state.font;
          fontSize = segment.source.state.size;
        }
        replayed = segment.source;
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
      // CHARACTER SPACING AS `Tc`, in the unscaled text space `Tc` is stated in: the user-space spacing over the units one
      // text-space unit is on the page, on top of the source's own (ADR-0228 Decision 1).
      const unit = placed(indexOf.get(segment.source) ?? -1).unit;
      const wanted = segment.source.state.charSpacing + (style?.spacing === undefined || style.spacing === 0 || unit === 0 ? 0 : style.spacing / unit);
      if ((said !== null || wanted !== segment.source.state.charSpacing) && (said === null || Math.abs(said - wanted) > 1e-6)) {
        parts.push(`${num(wanted)} Tc`);
        said = wanted;
      }
      const [a, b, c, d] = segment.source.state.matrix;
      const raised = segment.baseline + (style?.rise ?? 0);
      const [e, f] = apply(toBt, segment.x, raised);
      const shown = `${[a, b, c, d, e, f].map(num).join(' ')} Tm ${segment.verbatim ?? `${hexOf(segment.font, segment.codes)} Tj`}`;
      // A MARKED GAP SAYS WHAT IT IS: marked content around its spaces, its text the tab or the spaces in UTF-16 (ADR-0228
      // Decision 2 and its correction of 2026-10-16).
      parts.push(segment.actual === undefined ? shown : `/Span <</ActualText ${actualTextString(segment.actual)}>> BDC ${shown} EMC`);
      // A RECTANGLE AS WIDE AS THE SEGMENT from `bottom` to `top` above the baseline, in the space the words are written in.
      const drawn = (bottom: number, top: number, colour: readonly number[]): string => {
        const [x0, y0] = apply(toBt, segment.x, raised + bottom);
        const [x1, y1] = apply(toBt, segment.x + segmentWidth(segment), raised + top);
        return `q ${colour.map((channel) => num(channel / 255)).join(' ')} rg ${[Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)].map(num).join(' ')} re f Q`;
      };
      if (style !== undefined && (style.underline || style.strike || style.highlight !== undefined)) {
        // THE RULES: this thick, under the baseline and through the words, in the words' colour where a mark set one and
        // else black — the page's own fill is not something its operators can be asked. The highlight in its own colour.
        const pointSize = segment.source.state.size * unit * (style.factor === 0 ? 1 : style.factor);
        const ink = style.colour ?? [0, 0, 0];
        // THE ONE BAND each kind is drawn in (`decorationBand`, B3a), here from the baseline at nought.
        const band = (kind: DecorationKind): [number, number] => {
          const { bottom, top } = decorationBand(kind, 0, pointSize);
          return [bottom, top];
        };
        if (style.underline) rules.push(drawn(...band('under'), ink));
        if (style.strike) rules.push(drawn(...band('through'), ink));
        if (style.highlight !== undefined) behind.push(drawn(...band('behind'), style.highlight));
      }
    }
    parts.push(...(rules.length === 0 ? ['ET Q\n'] : ['ET', ...rules, 'Q\n']));
    // THE COLOURS BEHIND go between the `q` (and the placement's `cm`) and the `BT`, so they are drawn first.
    if (behind.length > 0) {
      if (cm === null) parts.splice(0, 1, 'q', ...behind, 'BT');
      else parts.splice(2, 0, ...behind);
    }
    // AN ARRANGED BLOCK goes just past the object it was arranged past (ADR-0264 Decision 5): after its unit going forward,
    // before it going backward, inside a `q … Q` that carries the state its first line was drawn under there
    // (`contentCarry.ts`, the drawn object's own carry). Its operators are emptied where they stood, as a placement's are.
    const arrangement = push === undefined ? blockPlace?.arrange : undefined;
    if (arrangement !== undefined) {
      const members = lines.flat().flatMap((run) => run.members);
      const first = Math.min(...members.map((at) => ops[at]?.start ?? Number.POSITIVE_INFINITY));
      const last = Math.max(...members.map((at) => ops[at]?.end ?? Number.NEGATIVE_INFINITY));
      const layout = contentLayout(content, arrangeWith.kinds);
      const span = neighbourSpan(layout, arrangement.past);
      if (span === undefined) throw new Refused({ reason: 'numbering', detail: `the page holds no ${arrangement.past.kind} the arrange names` });
      const unit = layout.unitOf(span);
      const forward = arrangement.to === 'forward';
      // THE NEIGHBOUR IS ON THE SIDE THE ARRANGE GOES, or holds the block in its own text object: past it either way.
      if (forward ? unit.end < last : unit.start > first) {
        throw new Refused({ reason: 'numbering', detail: `the ${arrangement.past.kind} named is not ${forward ? 'after' : 'before'} the block` });
      }
      const at = forward ? unit.end : unit.start;
      const [one, two] = contentLayout(content, arrangeWith.kinds, forward ? [first, at] : [at, first]).states;
      const from = forward ? one : two;
      const to = forward ? two : one;
      if (from === undefined || to === undefined) throw new Error('the content pass answered no state at an offset it was asked for');
      const runs = lines.flat().map((run) => run.run);
      const box = {
        left: Math.min(...runs.map((run) => run.left)),
        bottom: Math.min(...runs.map((run) => run.bottom)),
        right: Math.max(...runs.map((run) => run.right)),
        top: Math.max(...runs.map((run) => run.top)),
      };
      const carry = carried(content, from, to, box, arrangeWith.plainState);
      if (carry === 'cropped') throw new Refused({ reason: 'cropped' });
      plain ||= carry.plain;
      insertions.push({ at, text: `\n${carry.before}${parts.join('\n')}${carry.after}` });
      continue;
    }
    // BEFORE THE FIRST EDITED OPERATOR'S BT, so inside its marked content; for lines only added below the block, before
    // its last run's, whose marked content they continue.
    if (insert !== undefined) {
      // AN ADDED BOX goes at the end of the content, after the `Q`s that close what the content left open (said once), so it
      // is drawn on top of the page under the CTM the page itself is drawn under.
      // A LINE BREAK FIRST, since the content need not end in white space and its last token must not run into a `Q`.
      const closers = closed || closing === undefined ? '' : 'Q\n'.repeat(closing.depth);
      closed = true;
      insertions.push({ at: content.length, text: `\n${closers}${parts.join('\n')}` });
      continue;
    }
    if (own.size === 0) {
      // LINES ONLY ADDED BELOW THE BLOCK go after its last run's text object, still inside the marked content it continues
      // and under the graphics state it was drawn under, so a reader that takes the page in content order reads them after
      // the lines they follow and the block's words are one stretch of its reading (a join is such an edit).
      const after = objectEnds.get(ops[lastRun.last]?.textObject ?? -1);
      if (after !== undefined) {
        // A LINE BREAK FIRST: the text object it follows ends at its `ET`, and a `q` set against it would be one token.
        insertions.push({ at: after, text: `\n${parts.join('\n')}` });
        continue;
      }
    }
    const anchors = own.size > 0 ? [...own] : [lastRun.last];
    const anchor = Math.min(...anchors.map((at) => ops[at]?.textObject ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(anchor) || anchor < 0) throw new Refused({ reason: 'numbering', detail: 'an edited operator is outside a text object' });
    // WHERE THE BLOCK'S KEPT WORDS BEFORE THE EDIT END (ADR-0176's correction of 2026-10-19): a text object that holds a
    // kept operator before the first edited one, and none after it, is followed by the new object rather than preceded,
    // so a reader that takes the page in content order reads the kept words first. Before its `BT`, a line whose ` – `
    // stayed in that object was read as the new words and then the dash, and the read-back refused a correct edit.
    const firstEdited = Math.min(...anchors.filter((at) => ops[at]?.textObject === anchor));
    const inAnchor = ops.flatMap((op, at) => (op.textObject === anchor && op.object !== null ? [at] : []));
    const keptBefore = inAnchor.some((at) => at < firstEdited && !own.has(at) && !emptied.has(at));
    const keptAfter = inAnchor.some((at) => at > firstEdited && !own.has(at) && !emptied.has(at));
    const ends = objectEnds.get(anchor);
    if (own.size > 0 && keptBefore && !keptAfter && ends !== undefined) {
      // A LINE BREAK FIRST, for the reason the lines added below give: a `q` set against the `ET` would be one token.
      insertions.push({ at: ends, text: `\n${parts.join('\n')}` });
      continue;
    }
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
  return { content: out, emptied: [...emptied].sort((x, y) => x - y), changes, written, checked, drawn, baselines: baselinesOut, moved, plain };
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
