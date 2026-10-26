import type { BlockMarkSet, BlockPlace, EditedBlock, PageInsert } from '@monstera/contract/host';
import {
  type Alignment,
  type Result,
  TAB_STOP,
  agree,
  blockShape,
  characterUnit,
  err,
  nextTabStop,
  ok,
  paragraphEdges,
  paragraphSpacing,
} from '@monstera/shared';

import type { PageFont } from './pageFonts.js';
import type { PageBox, PageCoverCell } from './paperColour.js';
import { type BlockPlan, type FlowLine, type Measure, NO_MARK, type Row, largestFit, planBlock } from './paragraphFlow.js';
import { DECORATION_KEY, DECORATION_KINDS, DECORATION_TAG, type DecorationKind, decorationBand, decorationsOf } from './markDecorations.js';
import { JUSTIFY_CAP, RISE_SCALE, SUBSCRIPT_DROP, SUPERSCRIPT_RISE, spaceable, spacedBy } from './markFigures.js';
import { carried, holds, neighbourSpan } from './contentCarry.js';
import {
  type MarkedDecoration,
  type Matrix,
  type ShowOperator,
  type XObjectKind,
  contentEnd,
  contentLayout,
  multiply,
  operatorsAndDecorations,
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
  /** Present where every object of it is set in a fixed-pitch face, by the read's one rule (`isMono`, `pdfiumFfi.ts`). */
  readonly fixedPitch?: true | undefined;
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
 * What an edit needs from the page beyond its text: what each XObject the content names is, so a drawn neighbour is found
 * as PDFium numbers it and a picture under recognised words is seen; the name the caller will add a plain graphics state
 * under (ADR-0264 Decision 5); and the paper round boxes on the page as it is drawn before the edit, which a line of a
 * scan set afresh is covered with (ADR-0271's correction of 2026-10-26, the fourth writer change).
 */
export interface ArrangeContext {
  readonly kinds: (name: string) => XObjectKind;
  readonly plainState: string;
  /** The cover for each box, in page space and in the order given (`coversInPageSpace`); asked only where a scan's line is set. */
  readonly paper: (boxes: readonly PageBox[]) => readonly (readonly PageCoverCell[])[];
}

/** No arrange is possible: no XObject is known, a plain state is never named, and a cover is the plain white one. */
const NO_ARRANGE: ArrangeContext = {
  kinds: () => undefined,
  plainState: '',
  paper: (boxes) => boxes.map((box) => [{ box, colour: { r: 255, g: 255, b: 255 } }]),
};

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
  /**
   * What each inserted object draws, one entry per object in the order the objects sit in the content: the structural
   * read-back reads each object against its own entry. NOT the blocks' order: an edit of several blocks — a replace of
   * every match, a block and the blocks it pushes — inserts each where its own lines are, and the page's content need not
   * hold them in the order they were edited (measured 2026-10-24: 157 edits of one corpus document refused as not reading
   * as what they drew, every one correct).
   */
  readonly drawn: readonly string[];
  /** Each block's first and last baseline after the edit, and its last before it, in user space. */
  readonly baselines: readonly { readonly first: number; readonly last: number; readonly lastBefore: number }[];
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

/**
 * The page's fonts AS PDFium READ THEM: each font's `ToUnicode` with the codes PDFium named that the font itself names
 * nothing for ([ADR-0270](../../../docs/DECISIONS/0270-edit-text-writes-what-the-person-typed-and-never-refuses-it.md)
 * Decision 3, the document's own font first). The editor's words are PDFium's reading, so a character the page draws
 * with a code its font gives no text for — measured 2026-10-24 in the owner's document 2, a Type 3 glyph PDFium reads
 * as U+073C that no font on the page maps — was a character "no face carries", though the page's own font draws it.
 * Learned only from a run whose codes and PDFium's characters line up exactly, white space aside — an unnamed code read
 * as the characters up to where the next named code's text begins, since one glyph may be read as two (measured there:
 * `=` and U+073C from one code) — so a code is never guessed; a text two codes are read as keeps the first. The writer
 * and its structural check both take these fonts, so the words an edit sets and the words the check reads are one
 * reading.
 *
 * @param fonts the page's fonts, `pageFonts`'
 * @param content the page's content, joined
 * @param page PDFium's reading of the page: its runs and its text objects' indices
 */
export function pageFontsAsRead(fonts: ReadonlyMap<string, PageFont>, content: Uint8Array, page: PageRuns): ReadonlyMap<string, PageFont> {
  const ops = showOperators(content);
  const opAt = new Map<number, number>();
  for (const [at, op] of ops.entries()) {
    const object = op.object === null ? undefined : page.textObjects[op.object];
    if (object !== undefined) opAt.set(object, at);
  }
  const learned = new Map<string, Map<number, string>>();
  const visible = (text: string): string[] => Array.from(text).filter((character) => !/\s/u.test(character));
  for (const run of page.runs) {
    const said = visible(run.text);
    // THE RUN'S CODES IN ORDER, each with the text its font names for it, or none.
    const flat: { readonly resource: string; readonly code: number; readonly named: string | undefined }[] = [];
    let whole = true;
    for (const member of run.members) {
      const op = ops[opAt.get(member) ?? -1];
      const font = op?.state.font === null || op === undefined ? undefined : fonts.get(op.state.font);
      if (op === undefined || font === undefined) {
        whole = false;
        break;
      }
      for (const code of codesOf(font, op.codes)) flat.push({ resource: font.resource, code, named: font.toUnicode?.text.get(code) });
    }
    if (!whole) continue;
    const found: { readonly resource: string; readonly code: number; readonly text: string }[] = [];
    let next = 0;
    let aligned = true;
    for (const [at, item] of flat.entries()) {
      if (item.named !== undefined) {
        for (const character of visible(item.named)) {
          if (said[next] !== character) aligned = false;
          next += 1;
        }
        if (!aligned) break;
        continue;
      }
      // AN UNNAMED CODE READS AS EVERYTHING UP TO WHERE THE NEXT NAMED CODE'S TEXT BEGINS, or to the run's end: one glyph
      // PDFium may read as more than one character (measured: `=` and a mark). Two unnamed codes side by side would split
      // their characters by a guess, so such a run teaches nothing.
      if (flat[at + 1] !== undefined && flat[at + 1]?.named === undefined) {
        aligned = false;
        break;
      }
      const following = flat.slice(at + 1).map((each) => visible(each.named ?? '')[0]).find((first) => first !== undefined);
      let end = following === undefined ? said.length : said.indexOf(following, next + 1);
      if (following !== undefined && end < 0) end = -1;
      if (end <= next) {
        aligned = false;
        break;
      }
      found.push({ resource: item.resource, code: item.code, text: said.slice(next, end).join('') });
      next = end;
    }
    if (!aligned || next !== said.length) continue;
    for (const { resource, code, text } of found) {
      const known = learned.get(resource) ?? new Map<number, string>();
      if (![...known.values()].includes(text)) known.set(code, text);
      learned.set(resource, known);
    }
  }
  if (learned.size === 0) return fonts;
  return new Map(
    [...fonts].map(([resource, font]) => {
      const extra = learned.get(resource);
      if (extra === undefined) return [resource, font];
      const text = new Map([...(font.toUnicode?.text ?? new Map<number, string>()), ...extra]);
      return [resource, { ...font, toUnicode: { text, bytes: font.toUnicode?.bytes ?? font.codeBytes }, readByPdfium: new Set(extra.keys()) }];
    }),
  );
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
  /**
   * Whether a word in `font` that nobody marked is set bold: what a mark's *bold* is compared with, so a mark that asks
   * what an unmarked word already is changes nothing, and one that asks otherwise is set (ADR-0176's correction of
   * 2026-10-26). For a font whose letters are drawn that is the weight they look, measured; the descriptor's number
   * answers only where nothing can be measured, and where no faces are given at all.
   */
  isBold(font: PageFont): boolean;
}

/** Whether a word in `font` is set bold with no mark, where no face set can say: its descriptor's weight. */
export function statedBold(font: PageFont): boolean {
  return font.weight !== null && font.weight >= 600;
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
  /** The colour a rule the words already carried keeps, where no mark colours the words (the owner's L2). */
  readonly underInk?: readonly [number, number, number];
  readonly throughInk?: readonly [number, number, number];
}

/** The marked decorations a run's words carry on the page, each by its colour in 0 to 255: present only where they are. */
interface Carries {
  readonly under: readonly [number, number, number] | undefined;
  readonly through: readonly [number, number, number] | undefined;
  readonly behind: readonly [number, number, number] | undefined;
}

const CARRIES_NOTHING: Carries = { under: undefined, through: undefined, behind: undefined };

/**
 * A run's look under `set`, a mark over it or none: the mark's underline, line through and highlight where it names them,
 * else what the run's words carry (`Carries`). A highlight set to `null` is one taken off.
 */
function decoratedBy(set: BlockMarkSet | undefined, carries: Carries): Pick<SegmentStyle, 'underline' | 'strike' | 'highlight' | 'underInk' | 'throughInk'> {
  const asked = set?.highlight;
  return {
    underline: set?.underline ?? carries.under !== undefined,
    strike: set?.strike ?? carries.through !== undefined,
    highlight: asked === undefined ? carries.behind : asked === null ? undefined : [asked.r, asked.g, asked.b],
    ...(carries.under === undefined ? {} : { underInk: carries.under }),
    ...(carries.through === undefined ? {} : { throughInk: carries.through }),
  };
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
 * A line as ANOTHER READER may read it: each glyph set with a code whose text is PDFium's reading and not its font's own
 * (`PageFont.readByPdfium`) stands as U+FFFD, one glyph that reader may name however it likes — MuPDF reads the one
 * measured (document 2, 2026-10-24) as U+F4BC where PDFium reads `=` and U+073C. What the reading check holds the edit to.
 *
 * @param text the line's words, as the writer set them
 * @param line the line as laid, whose segments say which font and code drew each part
 */
function asAnotherReaderMay(text: string, line: VisualLine): string {
  let read = text;
  for (const segment of line.segments) {
    for (const code of segment.codes) {
      if (segment.font.readByPdfium?.has(code) !== true) continue;
      const named = segment.font.toUnicode?.text.get(code);
      if (named !== undefined && named !== '') read = read.replace(named, '�');
    }
  }
  return read;
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
  const { operators: real, decorations: pageDecorations } = operatorsAndDecorations(content);
  /**
   * Whether the content sets a clip at all (a `W` or `W*` operator): only then can a clip hide the words a block sets, and
   * only then is the content read again for the windows in force (ADR-0266's correction of 2026-10-25). A false yes costs a
   * read; a false no is impossible, since a clip has no other operator.
   */
  const setsAClip = /(?:^|[\s\])>])W\*?(?=\s)/u.test(new TextDecoder('latin1').decode(content));
  /** The marked decorations that go with old words set again, taken away where they stood (the owner's L2). */
  const decorationsGone = new Set<MarkedDecoration>();
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

  /**
   * THE PICTURES THE PAGE DRAWS, in page space, each with where its instruction stands: what makes invisible words a scan's
   * recognised words (ADR-0181 Decision 9). Read only where the content paints some text invisibly at all, since it is a
   * pass over the whole page. A picture inside a form is not among them: the page walk does not enter a form.
   */
  const pictures = real.some((op) => op.state.render === 3)
    ? contentLayout(content, arrangeWith.kinds)
        .drawn.filter((object) => object.kind === 'image')
        .map((object) => {
          const corners = [apply(object.ctm, 0, 0), apply(object.ctm, 1, 0), apply(object.ctm, 0, 1), apply(object.ctm, 1, 1)];
          return {
            start: object.start,
            left: Math.min(...corners.map((corner) => corner[0])),
            right: Math.max(...corners.map((corner) => corner[0])),
            bottom: Math.min(...corners.map((corner) => corner[1])),
            top: Math.max(...corners.map((corner) => corner[1])),
          };
        })
    : [];
  /**
   * Whether a run is recognised words over a scan: every operator of it painted invisibly, over a picture drawn BEFORE it,
   * so the words a person reads there are the picture's pixels. Invisible text over no picture is text a document keeps
   * for a reader that is not eyes, and stays as invisible as it was (ADR-0179's keep list).
   */
  const overAScan = (run: PageRun, members: readonly number[]): boolean => {
    const first = ops[members[0] ?? -1];
    if (pictures.length === 0 || first === undefined || !members.every((at) => ops[at]?.state.render === 3)) return false;
    return pictures.some(
      (picture) => picture.start < first.start && run.left < picture.right && run.right > picture.left && run.bottom < picture.top && run.top > picture.bottom,
    );
  };

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
  const carrier = (own: PageFont, word: string, drawn: boolean): { readonly font: PageFont; readonly codes: number[] } | null => {
    const siblings = [...fonts.values()]
      .filter(
        (font) =>
          font !== own &&
          own.face !== null &&
          font.face === own.face &&
          (font.weight === null || own.weight === null || font.weight === own.weight),
      )
      .sort((a, b) => (a.resource < b.resource ? -1 : 1));
    // A FONT OF DRAWN LETTERS IS NO FACE FOR A NEW WORD (ADR-0176's correction of 2026-10-25, the owner's font principle):
    // `drawn` is false for a word the run did not already say, and such a word goes to an ordinary face.
    for (const font of [own, ...siblings].filter((each) => drawn || each.subtype !== 'Type3')) {
      const codes = font.toUnicode === null ? null : codesFor(font.toUnicode, word);
      if (codes?.every((code) => font.draws(code) && font.width(code) !== null) === true) return { font, codes };
    }
    return null;
  };

  /**
   * `word` in the page's fonts, the longest stretch first, each stretch in the first of `own` and its siblings that
   * carries all of it; `null` where some character is carried by none of them.
   */
  const acrossPageFonts = (own: PageFont, word: string, drawn: boolean): FacePiece[] | null => {
    const characters = Array.from(word);
    const pieces: FacePiece[] = [];
    let at = 0;
    while (at < characters.length) {
      let end = characters.length;
      let hit = carrier(own, characters.slice(at, end).join(''), drawn);
      while (hit === null && end > at + 1) {
        end -= 1;
        hit = carrier(own, characters.slice(at, end).join(''), drawn);
      }
      if (hit === null) return null;
      pieces.push(hit);
      at = end;
    }
    return pieces;
  };

  const emptied = new Set<number>();
  /** The operators a block's rewrite is placed before: their `BT`, one inserted object per block, with what it draws. */
  const insertions: { readonly at: number; readonly text: string; readonly drawn: string }[] = [];
  const written: string[] = [];
  const checked: string[] = [];
  const baselinesOut: { first: number; last: number; lastBefore: number }[] = [];
  const uncarried = new Set<string>();
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
  /**
   * The words the edit's runs already said, by the font that drew them, compared whole (ADR-0176's corrections of
   * 2026-10-25): only these may be set in a font of drawn letters, so a line set again keeps its old words' glyphs
   * wherever the layout puts them, and a new word — typed, replaced, corrected or translated — goes to an ordinary face.
   * Read from EVERY block the edit names, a join's emptied block among them, and never across fonts: a word another
   * font drew is new to this one. A run the loop below cannot place is skipped here, since that loop refuses it by name.
   */
  const saidIn = new Map<PageFont, Set<string>>();
  for (const block of blocks) {
    for (const index of block.lines.flat()) {
      const run = runs.get(index);
      const at = run?.members[0] === undefined ? undefined : opAt.get(run.members[0]);
      const op = at === undefined ? undefined : ops[at];
      const font = op === undefined ? undefined : (syntheticFonts.get(op) ?? (op.state.font === null ? undefined : fonts.get(op.state.font)));
      if (run === undefined || font === undefined) continue;
      const said = saidIn.get(font) ?? new Set<string>();
      for (const word of tokens(run.text)) said.add(word);
      saidIn.set(font, said);
    }
  }

  for (const { block, insert } of jobs) {
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
    // A SCAN'S LINES, REDRAWN WHOLE (ADR-0271's correction of 2026-10-26, the owner's answer): the operators of every run
    // that is recognised words over a picture, which are drawn visible wherever the edit sets them again; the lines holding
    // one, none of whose runs is left as its own operator when the line is set afresh; and the ink of each such run the
    // edit empties, which is covered with the paper that is there.
    const scanRuns = lines.map((line) => line.map((run) => overAScan(run.run, run.members)));
    const runOnScan = scanRuns.flat();
    const drawnVisible = new Set(lines.flat().flatMap((run, at) => (runOnScan[at] === true ? run.members.map((member) => ops[member]) : [])));
    const covers: PageBox[] = [];
    const ctm = ops[firstRun.first]?.state.ctm;
    // ONE INSERTED OBJECT DRAWS EVERY LINE, under the CTM where it stands. A line drawn under another CTM is reproduced
    // exactly inside it: its origin is taken from page space back through that CTM (`toBt` below), and its text matrix
    // carries the rest of the difference (`inStandingSpace` below) — a glyph is placed by its text matrix times its CTM,
    // so the text matrix times its own CTM times the standing one's inverse, under the standing one, is the same
    // placement, and its size, spacing and every operator carried as it was mean what they meant. That covers a
    // translation, as some producers set every line in its own `q 1 0 0 1 x y cm … Q`, and a scale or turn as well.
    // Measured 2026-10-24: one corpus page draws its text under fifteen CTMs at three scales, and every block an edit
    // pushed across them was refused. What one object cannot reproduce is a CLIP the first line is not drawn through,
    // since the object stands where the first line did: that is still refused.
    const members = lines.flatMap((line) => line.flatMap((run) => run.members));
    const sameCtm = (op: ShowOperator | undefined): boolean =>
      op !== undefined && ctm !== undefined && op.state.ctm.every((value, at) => Math.abs(value - (ctm[at] ?? 0)) <= SAME);
    if (!members.every((member) => sameCtm(ops[member]))) {
      const starts = members.map((member) => ops[member]?.start ?? 0);
      const windows = contentLayout(content, arrangeWith.kinds, starts).states.map((state) => JSON.stringify(state.windows.map((window) => window.points)));
      if (windows.some((each) => each !== windows[0])) throw new Refused({ reason: 'transformed', where: 'lines-under-different-ctms' });
    }
    const inkRight = Math.max(...lines.flat().map((run) => run.right));
    const baselines = lines.map((line) => line[0]?.origin.y ?? 0);
    // WHAT THE PERSON DID TO THE BLOCK AS A WHOLE (ADR-0188): placed, so every line of it is set again under one `cm`, or
    // given a measure, so every paragraph of it is. Either way no line of it is left where it was.
    const blockPlace = block.place;
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
    /** Each old paragraph, by place: whether every run of every line of it is fixed pitch (`PageRun.fixedPitch`). */
    const fixedParagraphs: boolean[] = [];
    let fixedSoFar = true;
    for (const [at, line] of lines.entries()) {
      fixedSoFar &&= line.every((run) => run.run.fixedPitch === true);
      if (soft[at] !== true) {
        fixedParagraphs.push(fixedSoFar);
        fixedSoFar = true;
      }
    }
    const flow: FlowLine[] = lines.map((line, at) => ({
      runs: line.map((run) => ({ id: run.run.index, text: run.run.text })),
      soft: soft[at] === true,
    }));
    const extents = lines.map((line) => ({
      x0: Math.min(...line.map((run) => run.run.left)),
      x1: Math.max(...line.map((run) => run.run.right)),
      characters: line.reduce((sum, run) => sum + run.run.text.length, 0),
    }));
    const shape = blockShape(extents, soft);
    /** One character's width across the block: what two of its edges are compared in, the shape's own unit. */
    const unit = characterUnit(extents);
    const spacing = paragraphSpacing(baselines, soft);
    const byId = new Map(lines.flat().map((run) => [run.run.index, run]));
    /**
     * THE MARKED DECORATIONS EACH RUN CARRIES, by the one resolver the read takes (`decorationsOf`), from where its words
     * are before anything moves (the owner's L2). A run set again or carried draws them again where its words go, in their
     * own colour, and its old ones go with its old words; a mark changes them only where it names them, since the editor
     * sends what differs from the run's own look.
     */
    const claimedBy = new Map(
      lines.flat().map((run) => {
        const geometry = { left: run.run.left, right: run.run.right, baseline: run.origin.y, size: sourceOf(run).state.size * run.origin.unit };
        const claimed = pageDecorations.filter((decoration) => Object.keys(decorationsOf(geometry, [decoration])).length > 0);
        return [run.run.index, claimed] as const;
      }),
    );
    const carriesOf = (run: (typeof firstLine)[number]): Carries => {
      const claimed = claimedBy.get(run.run.index) ?? [];
      const colourOf = (kind: DecorationKind): readonly [number, number, number] | undefined => {
        const found = claimed.find((decoration) => decoration.kind === kind);
        return found === undefined ? undefined : [found.colour.r, found.colour.g, found.colour.b];
      };
      return { under: colourOf('under'), through: colourOf('through'), behind: colourOf('behind') };
    };
    // WHERE A LINE SET AFRESH STARTS: the origin of the line that keeps the paragraph's left edge, since the shape's edge
    // is where ink begins and an operator is placed by its origin.
    const blockLeft = Math.min(...lines.map((line) => line[0]?.origin.x ?? 0));
    // A MEASURE THE PERSON GAVE is the measure, from the block's own left edge (the PDFium writer's rule).
    const blockRight = blockPlace?.width !== undefined ? blockLeft + blockPlace.width : inkRight;
    const restOrigin = Math.min(...(lines.length > 1 ? lines.slice(1) : lines).map((line) => line[0]?.origin.x ?? 0));
    // EACH OLD PARAGRAPH'S OWN EDGES (ADR-0179's correction of 2026-10-24), the editor's own reading of the same lines
    // (`paragraphEdges`), so a bulleted item and the plain paragraph after it in one block are each set from their own left.
    // In ink for comparing a line's start, and in origins for placing one, since an operator is placed by its origin: the
    // leftmost origin of the paragraph's lines after its first, or its one line's origin less the indent it takes.
    const edges = paragraphEdges(extents, soft);
    const paragraphOrigins: number[] = [];
    {
      let from = 0;
      for (let at = 0; at < lines.length; at += 1) {
        if (at < lines.length - 1 && soft[at] === true) continue;
        const origins = lines.slice(from, at + 1).map((line) => line[0]?.origin.x ?? 0);
        const [head = 0, ...rest] = origins;
        paragraphOrigins.push(rest.length > 0 ? Math.min(...rest) : head - (edges[paragraphOrigins.length]?.firstIndent ?? 0));
        from = at + 1;
      }
    }

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
      const drawn = token === ' ' || (saidIn.get(font)?.has(token) ?? false);
      // A RESTYLED WORD is not looked for in the run's own font: only white space is, which has no style to be wrong in.
      const found = restyle !== undefined && token !== ' ' ? null : carrier(font, token, drawn);
      // A WORD NO ONE PAGE FONT CARRIES, set across them in the longest stretches each carries (ADR-0176's correction of
      // 2026-10-19, later): a letter typed before a full stop Chromium drew in a subset holding only `.`.
      const across = found !== null || restyle !== undefined || token === ' ' ? null : acrossPageFonts(font, token, drawn);
      const pieces: readonly FacePiece[] | null =
        found !== null
          ? [found]
          : token === ' '
            ? []
            : (across ??
              faces?.set(token, source, restyle === undefined ? (stretch) => carrier(font, stretch, drawn) : () => null, restyle) ??
              null);
      if (pieces === null) {
        const before = uncarried.size;
        for (const character of token) if (restyle !== undefined || carrier(font, character, drawn) === null) uncarried.add(character);
        // NEVER DROPPED UNSAID: a word that yields no pieces names its characters, so the edit is refused by name or the
        // caller gives it a face, and its words cannot vanish with nothing reported.
        if (uncarried.size === before) for (const character of token) uncarried.add(character);
      }
      answers.set(key, pieces);
      return pieces;
    };
    /**
     * The glyph a tab's marked gap stands on (ADR-0228 Decision 2): the run's own space where its font draws one, else a
     * face's. `piecesOf` answers a space no page font carries with NO piece, since a space between words is a gap and
     * needs none; a tab's mark does — `/ActualText` names the text of the glyphs inside it, and with none inside, the tab
     * is gone from the saved words. Measured 2026-10-25 on the text walk's sample, whose Helvetica holds no code for a
     * space: every tab typed there was written as a gap with no mark (step 11, 0 marks). Where no face is given either,
     * the tab is named as a character the edit needs a face for, so the caller gives it one and it is never dropped
     * unsaid.
     */
    const tabGapOf = (source: ShowOperator, restyle?: Restyle): FacePiece | undefined => {
      const own = piecesOf(source, TAB_GAP, restyle);
      if (own !== null && own.length === 1) return own[0];
      const key = `${String(indexOf.get(source))}|${JSON.stringify(restyle ?? null)}|tab`;
      if (answers.has(key)) return answers.get(key)?.[0];
      const faced = faces?.set(TAB_GAP, source, () => null, restyle) ?? null;
      const piece = faced !== null && faced.length === 1 ? faced[0] : undefined;
      if (piece === undefined) uncarried.add('\t');
      answers.set(key, piece === undefined ? null : [piece]);
      return piece;
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
      const run = byId.get(runId) ?? firstRun;
      const { set, font, sizePt } = markStyle(run, mark);
      // A DECORATION A MARK NAMES differs from what the words carry, put on or taken off (the owner's L2).
      const carries = carriesOf(run);
      const decorated = decoratedBy(set, carries);
      const undecorated = decoratedBy(undefined, carries);
      if (
        decorated.underline !== undecorated.underline ||
        decorated.strike !== undecorated.strike ||
        JSON.stringify(decorated.highlight) !== JSON.stringify(undecorated.highlight)
      ) {
        return true;
      }
      // WHAT A PAGE'S OPERATORS DO NOT SAY — its slant, its colour — a mark that names is a change.
      return (
        (set.bold !== undefined && set.bold !== (faces?.isBold(font) ?? statedBold(font))) ||
        set.italic === true ||
        (set.size !== undefined && Math.abs(set.size - sizePt) > 0.05) ||
        set.colour !== undefined ||
        (set.family !== undefined && !(font.face ?? '').toLowerCase().includes(set.family.toLowerCase())) ||
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
      carries: Carries = CARRIES_NOTHING,
    ): number => {
      const unit = placed(indexOf.get(source) ?? -1).unit * (marked?.factor ?? 1) * shrink;
      // NO SPACING NOR STRETCH IN A JOINED RIGHT-TO-LEFT SCRIPT, the measure's own rule (`spacedBy`).
      const spacing = spaceable(words) ? (marked?.spacing ?? 0) * shrink : 0;
      const stretch = spaceable(words) ? perSpace : 0;
      const decorated = decoratedBy(marked?.set, carries);
      const style: SegmentStyle | undefined =
        marked === undefined && shrink === 1 && !decorated.underline && !decorated.strike && decorated.highlight === undefined
          ? undefined
          : {
              colour: marked?.set.colour === undefined ? undefined : [marked.set.colour.r, marked.set.colour.g, marked.set.colour.b],
              factor: (marked?.factor ?? 1) * shrink,
              rise: (marked?.rise ?? 0) * shrink,
              ...decorated,
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
          const piece = tabGapOf(source, restyleOf(marked));
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
      // A BLOCK RECOLOURED WHOLE carries its colour on every operator (ADR-0264 Decision 5), and every run the decorations
      // its words carry (the owner's L2); nothing else about it changes. One look per run, so its operators join.
      const looks = new Map<number, SegmentStyle | undefined>();
      const lookOf = (run: (typeof firstLine)[number]): SegmentStyle | undefined => {
        if (looks.has(run.run.index)) return looks.get(run.run.index);
        const decorated = decoratedBy(undefined, carriesOf(run));
        const look: SegmentStyle | undefined =
          carriedColour === undefined && !decorated.underline && !decorated.strike && decorated.highlight === undefined
            ? undefined
            : { colour: carriedColour, factor: 1, rise: 0, ...decorated, spacing: 0 };
        looks.set(run.run.index, look);
        return look;
      };
      for (const { op, at, font, run } of carried) {
        const style = lookOf(run);
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
    // writer reads it. Edges are origins here, since an operator is placed by where its glyph is drawn from. A left-aligned
    // block's paragraph takes the edges of the old paragraph it is set in (`shapedBy`, the planner's), as the editor draws it.
    const settings = new Map((block.paragraphs ?? []).map((setting) => [setting.paragraph, setting]));
    const setFor = (place: number, shapedBy: number): { align: Alignment | 'justify'; leftEdge: number; first: number; centre: number } => {
      const given = settings.get(place);
      const align = given?.align ?? shape.align;
      const own = shape.align === 'left' ? { left: paragraphOrigins[shapedBy], first: edges[shapedBy]?.firstIndent } : { left: undefined, first: undefined };
      const leftEdge = given?.leftIndent === undefined ? (own.left ?? restOrigin) : blockLeft + given.leftIndent;
      const first = given?.firstIndent ?? (given?.leftIndent === undefined ? (own.first ?? shape.firstIndent) : 0);
      const centre = given?.align === undefined && shape.align === 'center' ? shape.centre : (leftEdge + blockRight) / 2;
      return { align, leftEdge, first, centre };
    };
    const limits = (place: number, shapedBy: number): { first: number; rest: number } => {
      // CODE IS NOT A WRAPPED PARAGRAPH (ADR-0096's correction of 2026-10-25): one set wholly in a fixed-pitch face widens
      // past the block, as the editor draws it, and a command that grows stays one line.
      if (fixedParagraphs[shapedBy] === true) return { first: Number.POSITIVE_INFINITY, rest: Number.POSITIVE_INFINITY };
      const set = setFor(place, shapedBy);
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
    const colour = block.place === undefined && fit === 'reflow' && (block.paragraphs?.length ?? 0) === 0 ? wholeColour(block) : undefined;
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
          cursor = layOut(sourceOf(run), words, cursor, placedLine, undefined, 0, carriesOf(run));
          previousEnd = run.right;
        }
        laid.push(text);
        setLines.push(asAnotherReaderMay(text, placedLine));
        continue;
      }
      // A LINE SET AFRESH, one run of words after another in each run's own state, aligned as the block's paragraphs are.
      const replaced = row.replaces >= 0 ? lines[row.replaces] : undefined;
      // THE RUNS BEFORE THE FIRST ONE THE EDIT NAMES KEEP THEIR OPERATORS, as they always have: where the line stands
      // where it did and is set from its left, each leading piece that is exactly an old run is that run, untouched.
      // At least one old run is set again, which is where the rest of the line begins.
      let untouched = 0;
      const set = setFor(row.paragraph, row.shapedBy);
      // A LINE SET AFRESH STARTS WHERE ITS PARAGRAPH SETS IT, which is where the editor draws it — its first line at the
      // indent, every other at the left edge — and where the plan measured its width from. The line it replaces keeps its
      // own start only where that start IS that place: its ink's left agrees with the paragraph's edge, in the shape's own
      // terms and unit (`agree`, `paragraphShape.ts`). Measured 2026-10-24 in the owner's document 12: a paragraph's second
      // line stood 19.2 pt right of the edge, was refilled to the 82.87 pt the edge allows, and was drawn from its own start,
      // ending 17.4 pt past the block's right.
      const inkStart = extents[row.replaces]?.x0;
      const edge = shape.align === 'left' ? edges[row.shapedBy] : undefined;
      const inkEdge = edge === undefined ? shape.left + (row.first ? shape.firstIndent : 0) : edge.left + (row.first ? edge.firstIndent : 0);
      const startsWhereSet = replaced !== undefined && inkStart !== undefined && agree([inkStart, inkEdge], unit);
      const keepsItsLine = given?.leftIndent === undefined && given?.firstIndent === undefined && startsWhereSet;
      const onAScan = scanRuns[row.replaces]?.includes(true) === true;
      if (shrink === 1 && !replaceAll && !onAScan && replaced !== undefined && set.align === 'left' && keepsItsLine && Math.abs(target - (baselines[row.replaces] ?? 0)) <= SAME) {
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
          carriesOf(run),
        );
      }
      laid.push(row.pieces.map((piece) => piece.text).join(''));
      setLines.push(asAnotherReaderMay(setting.map((piece) => piece.text).join(''), placedLine));
    }
    // EVERY OLD LINE THE PLAN DID NOT KEEP is emptied from its first run that was set again: a line set afresh stands in
    // for it, or the person removed it.
    // ITS OLD DECORATIONS GO WITH IT, drawn again above where its words now are; one a run left untouched also carries
    // stays, since taking it away would take it from words nobody set again.
    const staying = new Set<MarkedDecoration>();
    const going = new Set<MarkedDecoration>();
    for (const [at, line] of lines.entries()) {
      const from = kept.has(at) ? line.length : (keptRuns.get(at) ?? 0);
      for (const [index, run] of line.entries()) for (const decoration of claimedBy.get(run.run.index) ?? []) (index < from ? staying : going).add(decoration);
      if (kept.has(at)) continue;
      for (const [index, run] of line.entries()) {
        if (index < from) continue;
        empty(run.members);
        if (scanRuns[at]?.[index] === true) covers.push({ left: run.run.left, bottom: run.run.bottom, right: run.run.right, top: run.run.top });
      }
      emptyBetween(line[from]?.first ?? 0, line.at(-1)?.last ?? -1);
    }
    for (const decoration of going) if (!staying.has(decoration)) decorationsGone.add(decoration);
    const lastLine = lines.at(-1) ?? firstLine;
    const lastRun = lastLine.at(-1) ?? firstRun;
    if (uncarried.size > 0) continue;
    for (const at of own) emptied.add(at);
    written.push(laid.join('\n'));
    checked.push(...setLines);
    baselinesOut.push({ first: baselines[0] ?? 0, last: previous, lastBefore: baselines.at(-1) ?? 0 });

    const segments = visual.flatMap((line) => line.segments.map((segment) => ({ ...segment, baseline: line.baseline })));
    // WHAT THE CODES SHOW, which the structural read-back reads them as: a tab's segment means a tab and draws its gap
    // (W9; read as the tab it stood for, every tab edit on this writer was refused as not reading as what it drew).
    const drawnWords = segments.map((segment) => (segment.actual === '\t' ? TAB_GAP : segment.text)).join('');
    // NOTHING TO DRAW is nothing to insert, unless a scan's old words were taken away: their ink is still covered.
    if (segments.length === 0 && covers.length === 0) continue;
    // THE CTM WHERE THE NEW OBJECT STANDS, which every position below is converted into: an arranged block is carried with
    // its first line's state (`contentCarry.ts`); lines only added go after the last run's text object; anything else goes
    // at the first text object it empties. These are one CTM while a block's lines share one; where they differ by a
    // translation (above), the first line's would set every line the edit writes off by the difference.
    const standsAt =
      blockPlace?.arrange !== undefined
        ? firstRun.first
        : own.size === 0
          ? lastRun.last
          : [...own].reduce((best, at) => ((ops[at]?.textObject ?? 0) < (ops[best]?.textObject ?? 0) ? at : best));
    const here = ops[standsAt]?.state.ctm;
    const toBt = here === undefined ? null : inverse(here);
    if (toBt === null || here === undefined) throw new Refused({ reason: 'transformed', where: 'singular-ctm' });
    /**
     * An operator's text matrix (its scale, turn and skew) for drawing it under `here`: its own, where it was drawn under
     * `here` too, and else its own times its CTM times `here`'s inverse, which places every glyph where its own CTM did.
     */
    const inStandingSpace = (op: ShowOperator): Matrix => {
      const { matrix, ctm: own } = op.state;
      if (own.every((value, at) => Math.abs(value - (here[at] ?? 0)) <= SAME)) return matrix;
      return multiply(multiply([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0], own), toBt);
    };
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
    /** Whether this writer has said `0 Tr` for a scan's words since the source's settings were last replayed. */
    let shownVisible = false;
    /**
     * Each decoration of the block as stretches of one kind and colour on one line, in user space: a rule under or through
     * words is drawn after the text object, a highlight BEFORE it, so the words are over it.
     */
    const stretches: { readonly kind: DecorationKind; readonly colour: readonly number[]; readonly baseline: number; readonly left: number; right: number; readonly bottom: number; readonly top: number }[] = [];
    /** The stretch of each kind the last segment drew, which the next continues where it is the same. */
    const open = new Map<DecorationKind, (typeof stretches)[number]>();
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
          shownVisible = false;
        }
        replayed = segment.source;
        tinted = false;
      }
      // A SCAN'S WORDS SET AGAIN ARE DRAWN, in fill mode, where the source's own settings paint them invisibly; and a
      // segment after them from text that is not a scan's goes back to the source's own mode.
      const visible = drawnVisible.has(segment.source);
      if (visible !== shownVisible) {
        parts.push(`${String(visible ? 0 : segment.source.state.render)} Tr`);
        shownVisible = visible;
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
      const [a, b, c, d] = inStandingSpace(segment.source);
      const raised = segment.baseline + (style?.rise ?? 0);
      const [e, f] = apply(toBt, segment.x, raised);
      const shown = `${[a, b, c, d, e, f].map(num).join(' ')} Tm ${segment.verbatim ?? `${hexOf(segment.font, segment.codes)} Tj`}`;
      // A MARKED GAP SAYS WHAT IT IS: marked content around its spaces, its text the tab or the spaces in UTF-16 (ADR-0228
      // Decision 2 and its correction of 2026-10-16).
      parts.push(segment.actual === undefined ? shown : `/Span <</ActualText ${actualTextString(segment.actual)}>> BDC ${shown} EMC`);
      // THE RULES: this thick, under the baseline and through the words, in the words' colour where a mark set one and else
      // black — the page's own fill is not something its operators can be asked; a rule the words already carried keeps its
      // own colour. The highlight in its own colour. Each in the ONE band its kind is drawn in (`decorationBand`, B3a).
      const pointSize = segment.source.state.size * unit * (style === undefined || style.factor === 0 ? 1 : style.factor);
      const ink = (carried: readonly [number, number, number] | undefined): readonly number[] => style?.colour ?? carried ?? [0, 0, 0];
      const decorations: Partial<Record<DecorationKind, readonly number[]>> = {
        ...(style?.underline === true ? { under: ink(style.underInk) } : {}),
        ...(style?.strike === true ? { through: ink(style.throughInk) } : {}),
        ...(style?.highlight === undefined ? {} : { behind: style.highlight }),
      };
      for (const kind of DECORATION_KINDS) {
        const colour = decorations[kind];
        if (colour === undefined) {
          open.delete(kind);
          continue;
        }
        const { bottom, top } = decorationBand(kind, raised, pointSize);
        const right = segment.x + segmentWidth(segment);
        // ONE STRETCH ACROSS THE GAPS BETWEEN DECORATED WORDS, as the editor draws it: a space no font carries moves the pen
        // and is no segment, and a rule per segment left the page's underline broken at every space (the walk's L2).
        const going = open.get(kind);
        if (
          going?.baseline === segment.baseline &&
          going.colour.join() === colour.join() &&
          Math.abs(going.bottom - bottom) <= SAME &&
          Math.abs(going.top - top) <= SAME &&
          segment.x >= going.right - SAME
        ) {
          going.right = right;
          continue;
        }
        const stretch = { kind, colour, baseline: segment.baseline, left: segment.x, right, bottom, top };
        stretches.push(stretch);
        open.set(kind, stretch);
      }
    }
    /**
     * A stretch as a rectangle in the space the words are written in, MARKED AS WHAT IT IS (`markDecorations.ts`): an
     * artifact of its kind, as the PDFium writer marks one, so a later read gives it back to these words and a later edit
     * takes it away with them (the owner's L2).
     */
    const drawnStretch = (stretch: (typeof stretches)[number]): string => {
      const [x0, y0] = apply(toBt, stretch.left, stretch.bottom);
      const [x1, y1] = apply(toBt, stretch.right, stretch.top);
      const box = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)].map(num).join(' ');
      return `${pdfName(DECORATION_TAG)} <<${pdfName(DECORATION_KEY)} (${stretch.kind})>> BDC q ${stretch.colour.map((channel) => num(channel / 255)).join(' ')} rg ${box} re f Q EMC`;
    };
    const rules = stretches.filter((stretch) => stretch.kind !== 'behind').map(drawnStretch);
    const behind = stretches.filter((stretch) => stretch.kind === 'behind').map(drawnStretch);
    parts.push(...(rules.length === 0 ? ['ET Q\n'] : ['ET', ...rules, 'Q\n']));
    // THE COLOURS BEHIND go between the `q` (and the placement's `cm`) and the `BT`, so they are drawn first.
    if (behind.length > 0) {
      if (cm === null) parts.splice(0, 1, 'q', ...behind, 'BT');
      else parts.splice(2, 0, ...behind);
    }
    // THE PAPER OVER A SCAN'S OLD INK (ADR-0187, ADR-0271's correction of 2026-10-26) goes first of all, straight after the
    // `q`: over the picture, which is drawn before these words, under any highlight and the words, and before a
    // placement's `cm`, since it covers where the old words were and not where the block is put. In the page's own fill.
    if (covers.length > 0) {
      const papers = arrangeWith.paper(covers).flatMap((cells) =>
        cells.map(({ box, colour }) => {
          const [x0, y0] = apply(toBt, box.left, box.bottom);
          const [x1, y1] = apply(toBt, box.right, box.top);
          const rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)].map(num).join(' ');
          return `q ${[colour.r, colour.g, colour.b].map((channel) => num(channel / 255)).join(' ')} rg ${rect} re f Q`;
        }),
      );
      if (parts[0] === 'q BT') parts.splice(0, 1, 'q', ...papers, 'BT');
      else parts.splice(1, 0, ...papers);
    }
    // AN ARRANGED BLOCK goes just past the object it was arranged past (ADR-0264 Decision 5): after its unit going forward,
    // before it going backward, inside a `q … Q` that carries the state its first line was drawn under there
    // (`contentCarry.ts`, the drawn object's own carry). Its operators are emptied where they stood, as a placement's are.
    const arrangement = blockPlace?.arrange;
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
      insertions.push({ at, text: `\n${carry.before}${parts.join('\n')}${carry.after}`, drawn: drawnWords });
      continue;
    }
    /**
     * WHERE THE PAGE'S OWN CLIP WOULD HIDE THE LINES (ADR-0266's correction of 2026-10-25): `text` placed at `at`, or, where
     * a clip window in force there does not hold the lines' box, past the end of the outermost such window, carrying the
     * state there and the windows that do hold it — never the one that would hide the words. A placed block's box is its
     * placement's, which this does not work out, so it is placed as before.
     */
    const pastHidingClip = (at: number, text: string): { readonly at: number; readonly text: string } => {
      if (cm !== null || visual.length === 0 || !setsAClip) return { at, text };
      const extents = visual.map((line) => {
        const size = Math.max(...line.segments.map((segment) => segment.source.state.size * placed(indexOf.get(segment.source) ?? -1).unit * (segment.style?.factor ?? 1)));
        return {
          left: Math.min(...line.segments.map((segment) => segment.x)),
          right: Math.max(...line.segments.map((segment) => segment.x + segmentWidth(segment))),
          bottom: line.baseline - DESCENT_EM * size,
          top: line.baseline + ASCENT_EM * size,
        };
      });
      const box = {
        left: Math.min(...extents.map((each) => each.left)),
        bottom: Math.min(...extents.map((each) => each.bottom)),
        right: Math.max(...extents.map((each) => each.right)),
        top: Math.max(...extents.map((each) => each.top)),
      };
      const [here] = contentLayout(content, arrangeWith.kinds, [at]).states;
      const hiding = here?.windows.find((window) => !holds(window, box));
      // A WINDOW NEVER CLOSED has no end to be placed past: the words stay where they were, as before.
      if (here === undefined || hiding === undefined || hiding.end >= content.length) return { at, text };
      // PAST ITS `Q`, which `end` names the first byte of.
      const past = hiding.end + 1;
      const [there] = contentLayout(content, arrangeWith.kinds, [past]).states;
      if (there === undefined) return { at, text };
      const carry = carried(content, { ...here, windows: here.windows.filter((window) => holds(window, box)) }, there, box, arrangeWith.plainState);
      if (carry === 'cropped') return { at, text };
      plain ||= carry.plain;
      return { at: past, text: `\n${carry.before}${text}${carry.after}` };
    };
    // BEFORE THE FIRST EDITED OPERATOR'S BT, so inside its marked content; for lines only added below the block, before
    // its last run's, whose marked content they continue.
    if (insert !== undefined) {
      // AN ADDED BOX goes at the end of the content, after the `Q`s that close what the content left open (said once), so it
      // is drawn on top of the page under the CTM the page itself is drawn under.
      // A LINE BREAK FIRST, since the content need not end in white space and its last token must not run into a `Q`.
      const closers = closed || closing === undefined ? '' : 'Q\n'.repeat(closing.depth);
      closed = true;
      insertions.push({ at: content.length, text: `\n${closers}${parts.join('\n')}`, drawn: drawnWords });
      continue;
    }
    if (own.size === 0) {
      // LINES ONLY ADDED BELOW THE BLOCK go after its last run's text object, still inside the marked content it continues
      // and under the graphics state it was drawn under, so a reader that takes the page in content order reads them after
      // the lines they follow and the block's words are one stretch of its reading (a join is such an edit).
      const after = objectEnds.get(ops[lastRun.last]?.textObject ?? -1);
      if (after !== undefined) {
        // A LINE BREAK FIRST: the text object it follows ends at its `ET`, and a `q` set against it would be one token.
        insertions.push({ ...pastHidingClip(after, `\n${parts.join('\n')}`), drawn: drawnWords });
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
      insertions.push({ ...pastHidingClip(ends, `\n${parts.join('\n')}`), drawn: drawnWords });
      continue;
    }
    insertions.push({ ...pastHidingClip(anchor, parts.join('\n')), drawn: drawnWords });
  }
  if (uncarried.size > 0) throw new Refused({ reason: 'needs-a-face', characters: [...uncarried] });
  if (emptied.size === 0 && insertions.length === 0) throw new Refused({ reason: 'unchanged' });

  // THE SPLICES, in the order they sit in the bytes: each emptied operator's span, and each insertion at its BT.
  const splices: { readonly start: number; readonly end: number; readonly text: string; readonly inserted: boolean; readonly drawn?: string }[] = [];
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
  // A DECORATION THAT WENT WITH ITS WORDS is taken away whole, from its tag to past its `EMC`, where nothing else stands.
  for (const decoration of decorationsGone) splices.push({ start: decoration.start, end: decoration.end, text: '', inserted: false });
  for (const insertion of insertions) splices.push({ start: insertion.at, end: insertion.at, text: insertion.text, inserted: true, drawn: insertion.drawn });
  // AN INSERTION SITS BEFORE AN EMPTIED OPERATOR AT THE SAME OFFSET, and two blocks' insertions keep their order.
  splices.sort((left, right) => left.start - right.start || Number(right.inserted) - Number(left.inserted));
  // WHAT EACH INSERTED OBJECT DRAWS, in the order the objects now sit: the order `changes` lists them in.
  const drawn = splices.flatMap((splice) => (splice.inserted ? [splice.drawn ?? ''] : []));

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
  return { content: out, emptied: [...emptied].sort((x, y) => x - y), changes, written, checked, drawn, baselines: baselinesOut, plain };
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

  const { operators: was, decorations } = operatorsAndDecorations(before);
  const now = showOperators(after);
  // EVERY SPAN TAKEN AWAY is an emptied operator's or a whole marked decoration's: the edit names nothing else it changed.
  const emptiedSpans = new Set(edit.emptied.map((at) => `${String(was[at]?.start)}-${String(was[at]?.end)}`));
  const decorationSpans = new Set(decorations.map((decoration) => `${String(decoration.start)}-${String(decoration.end)}`));
  for (const change of edit.changes) {
    if (change.inserted) continue;
    const span = `${String(change.before.start)}-${String(change.before.end)}`;
    if (!emptiedSpans.has(span) && !decorationSpans.has(span)) return err('a span the edit took away is neither an emptied operator nor a decoration');
  }
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
  /** What an operator shows, through its own font. */
  const reads = (op: ShowOperator): string => {
    const font = op.state.font === null ? undefined : fonts.get(op.state.font);
    if (font?.toUnicode === null || font === undefined) return '\u0000';
    return codesOf(font, op.codes).map((code) => font.toUnicode?.text.get(code) ?? '\u0000').join('');
  };
  // EACH INSERTED OBJECT AGAINST WHAT IT WAS TO DRAW, one by one in the order they sit: a concatenation would let one
  // object's words stand in for another's.
  if (insertedSpans.length !== edit.drawn.length) return err('the inserted text does not read as the words drawn');
  for (const [at, span] of insertedSpans.entries()) {
    const shown = now
      .filter((op) => op.start >= span.start && op.end <= span.end)
      .map(reads)
      .join('');
    if (shown !== edit.drawn[at]) return err('the inserted text does not read as the words drawn');
  }
  return ok(undefined);
}
