/**
 * A page's content stream as its text-showing operators, numbered as PDFium numbers its text objects
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decision 3). THE ONE OWNER of that numbering: the MuPDF writer finds the operator an edit names through it, and the
 * research instrument that measured the rule reads through it, so the rule is never spelt twice.
 *
 * ## The rule, measured
 *
 * PDFium's k-th text object is the page's k-th `Tj`, `TJ`, `'` or `"` OUTSIDE a form that shows at least one character
 * code; an operator that shows none (`() Tj`, a `TJ` of spacing alone) makes no object. Measured 2026-10-06 on PDFium
 * 155.0.8044.0's Linux build by `scripts/research/type3Correspondence.mjs`: a Helvetica page, a hand-built Type 3 page,
 * a page of hard shapes (empty strings, both quote operators, clip-only text, marked content, a saved state, a font the
 * resources lack) and a Chromium print all agree, by position and length.
 *
 * ## What it reads, and what it does not
 *
 * The streams of one page joined as ISO 32000 §7.8.2 joins them, tokenised by §7.2's lexical rules, with the text state
 * of §9.3 and the text matrices of §9.4.2 followed through every operator that sets them. A form's content is not
 * entered, as PDFium does not enter it for its page walk. An inline image's data is skipped whole, since it is bytes and
 * not tokens. Nothing here knows a font's widths: what an operator draws is the caller's to measure, from the font the
 * operator names.
 */

import { DECORATION_KEY, DECORATION_TAG, type DecorationKind, type PageDecoration, type Rgb, decorationKindOf } from './markDecorations.js';

/** A 2D affine matrix `[a b c d e f]`, as a content stream writes one. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `left` then `right`: ISO 32000's row-vector convention, so `multiply(translation, tm)` moves within the text space. */
export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [A, B, C, D, E, F] = right;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

/** One lexical token, with where it is in the bytes. */
type Token =
  | { readonly kind: 'number'; readonly value: number; readonly start: number; readonly end: number }
  | { readonly kind: 'name'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly kind: 'string'; readonly bytes: Uint8Array; readonly start: number; readonly end: number }
  | { readonly kind: 'array'; readonly items: readonly Token[]; readonly start: number; readonly end: number }
  | { readonly kind: 'other'; readonly start: number; readonly end: number }
  | { readonly kind: 'operator'; readonly value: string; readonly start: number; readonly end: number };

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/u;

/** A literal string's bytes from `start` (its opening parenthesis), and where it ends: §7.3.4.2's escapes. */
function literalString(bytes: Uint8Array, start: number): { readonly bytes: Uint8Array; readonly end: number } {
  const out: number[] = [];
  let depth = 1;
  let at = start + 1;
  while (at < bytes.length) {
    const c = bytes[at] ?? 0;
    if (c === 0x5c) {
      const next = bytes[at + 1] ?? 0;
      const escaped: Readonly<Record<number, number>> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
      if (next >= 0x30 && next <= 0x37) {
        let value = 0;
        let digits = 0;
        while (digits < 3 && (bytes[at + 1 + digits] ?? 0) >= 0x30 && (bytes[at + 1 + digits] ?? 0) <= 0x37) {
          value = value * 8 + ((bytes[at + 1 + digits] ?? 0) - 0x30);
          digits += 1;
        }
        out.push(value & 0xff);
        at += 1 + digits;
      } else if (next === 0x0d || next === 0x0a) {
        // A BACKSLASH BEFORE AN END OF LINE continues the string onto the next line and adds nothing.
        at += next === 0x0d && bytes[at + 2] === 0x0a ? 3 : 2;
      } else {
        out.push(escaped[next] ?? next);
        at += 2;
      }
      continue;
    }
    if (c === 0x28) depth += 1;
    if (c === 0x29) {
      depth -= 1;
      if (depth === 0) return { bytes: Uint8Array.from(out), end: at + 1 };
    }
    out.push(c);
    at += 1;
  }
  throw new Error('a literal string in the content stream is not closed');
}

/** A hexadecimal string's bytes from `start` (its `<`), and where it ends: an odd last digit is followed by 0. */
function hexString(bytes: Uint8Array, start: number): { readonly bytes: Uint8Array; readonly end: number } {
  const digits: number[] = [];
  let at = start + 1;
  while (at < bytes.length && bytes[at] !== 0x3e) {
    const c = bytes[at] ?? 0;
    if (!WHITE.has(c)) {
      const value = Number.parseInt(String.fromCharCode(c), 16);
      if (Number.isNaN(value)) throw new Error('a hexadecimal string in the content stream holds a character that is not a digit');
      digits.push(value);
    }
    at += 1;
  }
  if (at >= bytes.length) throw new Error('a hexadecimal string in the content stream is not closed');
  if (digits.length % 2 === 1) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = ((digits[2 * index] ?? 0) << 4) | (digits[2 * index + 1] ?? 0);
  return { bytes: out, end: at + 1 };
}

/** The first `word` at or after `from` with whitespace before and after it, or the end of the bytes. */
function wordAt(bytes: Uint8Array, word: string, from: number): number {
  const a = word.charCodeAt(0);
  const b = word.charCodeAt(1);
  for (let at = from; at + 1 < bytes.length; at += 1) {
    if (bytes[at] === a && bytes[at + 1] === b && WHITE.has(bytes[at - 1] ?? 0x20) && WHITE.has(bytes[at + 2] ?? 0x20)) {
      return at;
    }
  }
  return bytes.length;
}

/** Every token of `bytes`, arrays as one token holding theirs. */
function tokenise(bytes: Uint8Array): Token[] {
  const latin1 = new TextDecoder('latin1');
  const stack: { start: number; items: Token[] }[] = [];
  const top: Token[] = [];
  const emit = (token: Token): void => {
    (stack.at(-1)?.items ?? top).push(token);
  };
  let at = 0;
  while (at < bytes.length) {
    const c = bytes[at] ?? 0;
    if (WHITE.has(c)) {
      at += 1;
      continue;
    }
    if (c === 0x25) {
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at += 1;
      continue;
    }
    if (c === 0x28) {
      const string = literalString(bytes, at);
      emit({ kind: 'string', bytes: string.bytes, start: at, end: string.end });
      at = string.end;
      continue;
    }
    if (c === 0x3c && bytes[at + 1] === 0x3c) {
      // A DICTIONARY OPERAND (marked content's properties) is kept as one opaque token: nothing here reads it.
      let depth = 0;
      const start = at;
      while (at < bytes.length) {
        if (bytes[at] === 0x3c && bytes[at + 1] === 0x3c) {
          depth += 1;
          at += 2;
        } else if (bytes[at] === 0x3e && bytes[at + 1] === 0x3e) {
          depth -= 1;
          at += 2;
          if (depth === 0) break;
        } else if (bytes[at] === 0x28) {
          at = literalString(bytes, at).end;
        } else {
          at += 1;
        }
      }
      emit({ kind: 'other', start, end: at });
      continue;
    }
    if (c === 0x3c) {
      const string = hexString(bytes, at);
      emit({ kind: 'string', bytes: string.bytes, start: at, end: string.end });
      at = string.end;
      continue;
    }
    if (c === 0x5b) {
      stack.push({ start: at, items: [] });
      at += 1;
      continue;
    }
    if (c === 0x5d) {
      const open = stack.pop();
      if (open === undefined) throw new Error('an array in the content stream closes without opening');
      at += 1;
      emit({ kind: 'array', items: open.items, start: open.start, end: at });
      continue;
    }
    let end = at + 1;
    if (c === 0x2f) {
      while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
      emit({ kind: 'name', value: latin1.decode(bytes.subarray(at + 1, end)), start: at, end });
      at = end;
      continue;
    }
    while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
    const word = latin1.decode(bytes.subarray(at, end));
    if (NUMBER.test(word)) {
      emit({ kind: 'number', value: Number(word), start: at, end });
    } else if (word === 'true' || word === 'false' || word === 'null') {
      emit({ kind: 'other', start: at, end });
    } else if (word === 'BI') {
      // AN INLINE IMAGE'S DATA IS BYTES, not tokens: the instruction runs to the EI after its ID.
      const ei = wordAt(bytes, 'EI', wordAt(bytes, 'ID', end) + 3);
      emit({ kind: 'operator', value: 'BI', start: at, end: Math.min(bytes.length, ei + 2) });
      end = Math.min(bytes.length, ei + 2);
    } else {
      emit({ kind: 'operator', value: word, start: at, end });
    }
    at = end;
  }
  if (stack.length > 0) throw new Error('an array in the content stream is not closed');
  return top;
}

/** The text state of §9.3 at one operator, and the two matrices of §9.4.2. */
export interface TextState {
  readonly font: string | null;
  readonly size: number;
  readonly charSpacing: number;
  readonly wordSpacing: number;
  /** Horizontal scaling, as a fraction: `Tz 100` is 1. */
  readonly scale: number;
  readonly leading: number;
  readonly rise: number;
  readonly render: number;
  /** The text matrix as the operator begins to show. */
  readonly matrix: Matrix;
  /** The text line matrix as the operator begins to show. */
  readonly line: Matrix;
  /** The current transformation matrix the operator shows under: every `cm` before it, through `q` and `Q`. */
  readonly ctm: Matrix;
}

/** One text-showing operator. */
export interface ShowOperator {
  /**
   * The text object PDFium numbers for it, or `null` for an operator that shows no code and so makes none: the rule
   * this module exists to state once.
   */
  readonly object: number | null;
  readonly operator: 'Tj' | 'TJ' | "'" | '"';
  /** The whole instruction, operands and operator, as byte offsets into the joined content. */
  readonly start: number;
  readonly end: number;
  /** Every character code byte it shows, strings joined in order. */
  readonly codes: Uint8Array;
  /** For a `TJ`, each element: a string's bytes or an adjustment in thousandths of text space. */
  readonly elements: readonly (Uint8Array | number)[];
  /**
   * The text state as it begins to show — for `'` and `"`, after their own move to the next line. Its `matrix` is the one
   * the last positioning operator set: showing advances the matrix by widths this module does not know, so where earlier
   * operators showed since that positioning (`positionedAt`), the caller adds their advances.
   */
  readonly state: TextState;
  /**
   * The index, in the answer, of the first operator shown since the matrix was last set by `BT`, `Tm`, `Td`, `TD`, `T*`,
   * `'` or `"`: this operator's own index when it is the first. The operators from there to this one, this one
   * excluded, advanced the matrix before it.
   */
  readonly positionedAt: number;
  /** Where the `BT` of its text object begins. */
  readonly textObject: number;
  /**
   * The instructions IN EFFECT at this operator that set what text is drawn WITH rather than where: the text state,
   * colour and the general graphics state, from the start of the page, through `q` and `Q`, each superseded one gone.
   * Replayed in this order into a new text object, their bytes reproduce this operator's state wherever that object is
   * placed: a Chromium print sets its colour and `gs` outside the `BT`, so the instructions inside it are not enough.
   */
  readonly settings: readonly { readonly start: number; readonly end: number }[];
}

/**
 * The operators that set how text is drawn, replayed into a new text object (ADR-0176 Decision 4), each with the slot
 * it fills: a later instruction for the same slot supersedes the earlier one. `gs` has none, because each one sets only
 * the parameters its dictionary names, so every one in effect is replayed in order.
 */
const SETTINGS: ReadonlyMap<string, string | null> = new Map([
  ['Tc', 'Tc'], ['Tw', 'Tw'], ['Tz', 'Tz'], ['TL', 'TL'], ['Tf', 'Tf'], ['Tr', 'Tr'], ['Ts', 'Ts'],
  ['w', 'w'], ['J', 'J'], ['j', 'j'], ['M', 'M'], ['d', 'd'], ['ri', 'ri'], ['i', 'i'], ['gs', null],
  ['cs', 'fill space'], ['sc', 'fill'], ['scn', 'fill'], ['g', 'fill'], ['rg', 'fill'], ['k', 'fill'],
  ['CS', 'stroke space'], ['SC', 'stroke'], ['SCN', 'stroke'], ['G', 'stroke'], ['RG', 'stroke'], ['K', 'stroke'],
]);

/**
 * What else an instruction supersedes (§8.6.8): setting a colour space sets the colour to that space's initial one, and
 * `g`, `rg` and `k` set the space as well as the colour.
 */
const SUPERSEDES: ReadonlyMap<string, readonly string[]> = new Map([
  ['cs', ['fill']], ['g', ['fill space']], ['rg', ['fill space']], ['k', ['fill space']],
  ['CS', ['stroke']], ['G', ['stroke space']], ['RG', ['stroke space']], ['K', ['stroke space']],
]);

/**
 * One instruction in effect, and the slot it fills (`null` for `gs`, which fills the parameters its dictionary names).
 * Exported for what carries an object's drawing state to another place in the content (ADR-0264 Decision 3).
 */
export interface Setting {
  readonly slot: string | null;
  readonly start: number;
  readonly end: number;
}

/** The slots {@link SETTINGS} fills, each once: what a carried state names a default for where the source sets none. */
export const SETTING_SLOTS: readonly string[] = [...new Set([...SETTINGS.values()].filter((slot): slot is string => slot !== null))];

const SHOWS = new Set(['Tj', 'TJ', "'", '"']);

/** What an XObject a `Do` names is, from the page's resources: the caller reads them, this module reads tokens. */
export type XObjectKind = 'image' | 'form' | undefined;

/**
 * One object PDFium makes of something DRAWN rather than shown ([ADR-0240](../../../docs/DECISIONS/0240-an-objects-placement-is-edited-where-it-is-drawn.md)):
 * a painted path, an image (an image `Do` or an inline image), a form (a form `Do`) or a shading (`sh`). `ordinal` is its
 * place among the page's objects of the same kind, outside every form, in content order: PDFium's own order.
 */
export interface DrawnObject {
  readonly kind: 'path' | 'image' | 'form' | 'shading';
  readonly ordinal: number;
  /** The instructions that draw it, as byte offsets into the joined content: a path from its first segment to its paint. */
  readonly start: number;
  readonly end: number;
  /** The CTM it is drawn under. */
  readonly ctm: Matrix;
  /** Whether a path also sets the clip (`W` or `W*` before its paint), which outlives it. */
  readonly clips: boolean;
  /** A path's points, in page space: the corners of its segments and their control points. */
  readonly points: readonly (readonly [number, number])[];
  /** The clip windows it is drawn through, outermost first (E3): what a placement may carry with it. */
  readonly windows: readonly ClipWindow[];
  /**
   * A path's segments as they are written, each with its operands in the space the path is built in: what a clipping
   * path's coordinates are rewritten from, in place (ADR-0264 Decision 3). Empty for every other kind.
   */
  readonly segments: readonly PathSegment[];
  /**
   * The instructions in effect where it is drawn that set how text and colour are drawn ({@link ShowOperator}'s
   * `settings`): what a form drawn here inherits from this stream (ADR-0269's correction of 2026-10-25).
   */
  readonly settings: readonly Setting[];
  /** A path's painting operator and where it stands, and its clip operator where it has one; absent for other kinds. */
  readonly paint?: { readonly op: string; readonly start: number; readonly end: number };
  readonly clip?: { readonly op: 'W' | 'W*'; readonly start: number; readonly end: number };
}

/**
 * One rectangle a page-text writer drew for a mark (`markDecorations.ts`): its kind, its box in page space and its fill,
 * and the marked-content sequence that is all of it, from its tag to past its `EMC`. Only a sequence holding exactly one
 * painted path and nothing else is one; anything else under the mark is a drawing, which nothing here moves or removes.
 */
export interface MarkedDecoration extends PageDecoration {
  readonly start: number;
  readonly end: number;
  /** Its path's points in page space, so a block set in a frame of its own reads the rule in that frame, not its box's. */
  readonly points: readonly (readonly [number, number])[];
}

/** One segment of a path as written: its operator, its numbers in the path's own space, and where the instruction is. */
export interface PathSegment {
  readonly op: string;
  readonly values: readonly number[];
  readonly start: number;
  readonly end: number;
}

/**
 * A CLIP a page sets (`W` or `W*`, then `n` or a paint), from the first segment of its path to the `Q` that ends it, or
 * to the end of the content where nothing does. A picture placed larger than the window it shows through is drawn under
 * one, and moving the picture without its window would slide the picture under a window that stays (the owner's E3).
 */
export interface ClipWindow {
  /** Where its path begins and where the `Q` that ends it begins, as byte offsets into the joined content. */
  readonly start: number;
  readonly end: number;
  /** The CTM its path is built under, which is the CTM at `start`. */
  readonly ctm: Matrix;
  /** Its path's points in page space, control points included. */
  readonly points: readonly (readonly [number, number])[];
  /** Where its path's segments end, which is where its `W` or `W*` begins: `start` to here is the path alone. */
  readonly segmentsEnd: number;
  /** Whether it clips by the even-odd rule (`W*`). */
  readonly evenOdd: boolean;
}

/** Every object PDFium makes of what a page DRAWS, in order, by kind (ADR-0240 Decision 2). */
export function drawnObjects(content: Uint8Array, xobject: (name: string) => XObjectKind): readonly DrawnObject[] {
  return scan(content, xobject).drawn;
}

/** The painting operators that make a path object; `n` ends a path and paints nothing, so makes none. */
const PAINTS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);

/** The operators that build a path, and how many coordinate pairs each names. */
const SEGMENTS: ReadonlyMap<string, number> = new Map([['m', 1], ['l', 1], ['c', 3], ['v', 2], ['y', 2], ['h', 0], ['re', 2]]);

/** A point under a matrix, row-vector convention. */
function apply(matrix: Matrix, x: number, y: number): readonly [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [x * a + y * c + e, x * b + y * d + f];
}

/** The page's content streams joined, each followed by an end of line so no token runs from one into the next. */
export function joinedContent(streams: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(streams.reduce((total, stream) => total + stream.length + 1, 0));
  let at = 0;
  for (const stream of streams) {
    joined.set(stream, at);
    at += stream.length;
    joined[at] = 0x0a;
    at += 1;
  }
  return joined;
}

/** Every text-showing operator of a page's joined content, in order, numbered by PDFium's rule. */
export function showOperators(content: Uint8Array): readonly ShowOperator[] {
  return scan(content).operators;
}

/**
 * Where each of the page's text objects ends, by where it begins (`ShowOperator.textObject`): the offset just past its
 * `ET`. A text object that is never closed has none. An object placed to continue a text object's own marked content,
 * after it in the reading, goes here, which is still under the graphics state the object was drawn under.
 */
export function textObjectEnds(content: Uint8Array): ReadonlyMap<number, number> {
  return scan(content).ends;
}

/**
 * What a page's content leaves open at its end: how many `q` it never closed, and the CTM the page is drawn under once
 * they are (a `cm` outside every `q` is permanent). An object appended to the content is set under this, after as many
 * `Q` as the first.
 */
export function contentEnd(content: Uint8Array): { readonly depth: number; readonly ctm: Matrix } {
  const { depth, baseCtm } = scan(content);
  return { depth, ctm: baseCtm };
}

/**
 * The drawing state in force at one offset of the content (ADR-0264 Decision 3): the CTM, every instruction in effect
 * (the `settings` a shown operator carries, here for any offset), and the clip windows in force, outermost first.
 */
export interface StateAt {
  readonly ctm: Matrix;
  readonly settings: readonly Setting[];
  readonly windows: readonly ClipWindow[];
}

/**
 * Where the page draws one thing ALONE (ADR-0264 Decision 3): a drawn object's instructions, or a text object's `BT … ET`,
 * widened over every `q … Q` and `BDC … EMC` (or `BMC … EMC`) around it that holds nothing else drawn or shown, and is
 * balanced in both. What an arrange lifts out and puts back elsewhere, so no wrapper is left empty or split.
 */
export interface ContentUnit {
  readonly start: number;
  readonly end: number;
  /**
   * The instructions inside the unit that change the state AFTER it — a setting or a `cm` at the unit's own `q` depth —
   * which stay where the unit stood when it is lifted out, so what follows is drawn as it was.
   */
  readonly leaks: readonly { readonly start: number; readonly end: number }[];
}

/** Every drawn object and text object of the page, the unit of any of them, and the state at each probed offset. */
export interface ContentLayout {
  readonly drawn: readonly DrawnObject[];
  readonly operators: readonly ShowOperator[];
  /** Where each text object ends, by where its `BT` begins: {@link textObjectEnds}' answer. */
  readonly textObjects: ReadonlyMap<number, number>;
  /** The unit of the span `[start, end)`, which is one drawn object's or one text object's (`BT` to past its `ET`). */
  unitOf(span: { readonly start: number; readonly end: number }): ContentUnit;
  /** The state at each offset asked, in the order asked: everything before the offset done, nothing at or after it. */
  readonly states: readonly StateAt[];
}

/** The first index in `sorted` whose value is at least `value`. */
function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The page's units and the state at `probes` (ADR-0264 Decision 3): the one pass, read for what an arrange needs. A unit
 * is worked out when asked for, since an arrange asks for two and a page may draw thousands of objects.
 */
export function contentLayout(content: Uint8Array, xobject: (name: string) => XObjectKind, probes: readonly number[] = []): ContentLayout {
  const { drawn, operators, ends, containers, depths, states } = scan(content, xobject, probes);
  /** Where every drawn object and text object begins, ascending: no two of them overlap. */
  const itemStarts = [...drawn.map((object) => object.start), ...ends.keys()].sort((a, b) => a - b);
  const depthStarts = depths.map((depth) => depth.start);
  /** The `q` and marked-content depths with everything before `offset` done. */
  const depthAt = (offset: number): { q: number; m: number } => {
    const at = lowerBound(depthStarts, offset);
    const before = depths[at - 1];
    return before === undefined ? { q: 0, m: 0 } : { q: before.qAfter, m: before.mAfter };
  };
  const within = (start: number, end: number): typeof depths => depths.slice(lowerBound(depthStarts, start), lowerBound(depthStarts, end));
  /** Whether `[start, end)` closes every `q` and marked-content sequence it opens, and closes none it did not. */
  const balanced = (start: number, end: number): boolean => {
    const at = depthAt(start);
    const after = depthAt(end);
    return at.q === after.q && at.m === after.m && within(start, end).every((depth) => depth.qAfter >= at.q && depth.mAfter >= at.m);
  };
  /** How many drawn or text objects begin in `[start, end)`. */
  const itemsWithin = (start: number, end: number): number => lowerBound(itemStarts, end) - lowerBound(itemStarts, start);
  const unitOf = (span: { readonly start: number; readonly end: number }): ContentUnit => {
    let { start, end } = span;
    for (;;) {
      const wider = containers
        .filter((container) => container.start <= start && container.end >= end && (container.start < start || container.end > end))
        .sort((a, b) => a.end - a.start - (b.end - b.start))
        // A CLIP SET AT THE WRAPPER'S OWN DEPTH outlives it (a marked-content sequence restores nothing), so a wrapper that
        // sets one is not lifted: the object is lifted without it, and the clip is carried as a window in force.
        .find((container) => {
          const base = depthAt(container.start).q;
          return (
            itemsWithin(container.start, container.end) === 1 &&
            balanced(container.start, container.end) &&
            within(container.start, container.end).every((depth) => depth.q !== base || (depth.op !== 'W' && depth.op !== 'W*'))
          );
        });
      if (wider === undefined) break;
      ({ start, end } = wider);
    }
    const base = depthAt(start).q;
    const leaks = within(start, end)
      .filter((depth) => depth.q === base && (depth.op === 'cm' || SETTINGS.has(depth.op)))
      .map((depth) => ({ start: depth.start, end: depth.end }));
    return { start, end, leaks };
  };
  return { drawn, operators, textObjects: ends, unitOf, states };
}

/**
 * {@link scanContent}'s answer for `content` read with no XObject kinds and no probes, kept while the bytes are: one edit
 * asks it of the same content three times (the fonts as PDFium read them, the writer, the structural check), and on the
 * text walk's dense page each pass over its 4.7 MB was 1.2 seconds (measured 2026-10-27). Keyed by the bytes object, so
 * new bytes are read afresh and nothing outlives them; the answer is read-only throughout.
 */
const plainScans = new WeakMap<Uint8Array, ReturnType<typeof scanContent>>();

/** {@link scanContent}, read once per content where nothing beyond the bytes shapes the answer. */
function scan(content: Uint8Array, xobject?: (name: string) => XObjectKind, probes?: readonly number[]): ReturnType<typeof scanContent> {
  if (xobject !== undefined || probes !== undefined) return scanContent(content, xobject, probes);
  const known = plainScans.get(content);
  if (known !== undefined) return known;
  const read = scanContent(content);
  plainScans.set(content, read);
  return read;
}

/** The ONE pass over a content stream (the numbering rule and the `q` and `Q` it is read through are stated here once). */
function scanContent(
  content: Uint8Array,
  xobject: (name: string) => XObjectKind = () => undefined,
  probes: readonly number[] = [],
): {
  readonly operators: readonly ShowOperator[];
  readonly depth: number;
  readonly baseCtm: Matrix;
  readonly ends: ReadonlyMap<number, number>;
  readonly drawn: readonly DrawnObject[];
  /** Every closed `q … Q` and marked-content sequence, from its first byte to its last. */
  readonly containers: readonly { readonly start: number; readonly end: number }[];
  /** Every instruction, with the `q` and marked-content depths before and after it. */
  readonly depths: readonly { readonly op: string; readonly start: number; readonly end: number; readonly q: number; readonly m: number; readonly qAfter: number; readonly mAfter: number }[];
  readonly states: readonly StateAt[];
  readonly decorations: readonly MarkedDecoration[];
} {
  const found: ShowOperator[] = [];
  const drawn: DrawnObject[] = [];
  /** Each open marked-content sequence's decoration where its tag and properties name one, and what it holds so far. */
  const openDecorations: ({ readonly kind: DecorationKind; readonly start: number; readonly paths: DrawnObject[]; other: number } | null)[] = [];
  const decorations: MarkedDecoration[] = [];
  /** The innermost open decoration, which what is drawn or shown now belongs to. */
  const holder = (): (typeof openDecorations)[number] => openDecorations.findLast((open) => open !== null) ?? null;
  const counts = { path: 0, image: 0, form: 0, shading: 0 };
  /** The path being built: where its first segment began, its points in page space, its segments, and its clip. */
  let path: { start: number; points: (readonly [number, number])[]; clips: boolean; segments: PathSegment[]; clip?: NonNullable<DrawnObject['clip']> } | null = null;
  /** The clips in force, outermost first, each with the `q` depth it was set at; `end` is filled when a `Q` ends it. */
  let windows: (ClipWindow & { start: number; end: number; depth: number })[] = [];
  const draw = (kind: DrawnObject['kind'], start: number, end: number, ctmNow: Matrix, clips = false, points: DrawnObject['points'] = [], extra: Pick<DrawnObject, 'paint' | 'clip'> & { segments?: readonly PathSegment[] } = {}): void => {
    // THE RECORDS THEMSELVES, not copies: a window's end is known only at the `Q` that ends it, after what it holds.
    const object: DrawnObject = { kind, ordinal: counts[kind], start, end, ctm: ctmNow, clips, points, windows: [...windows], segments: extra.segments ?? [], settings, ...(extra.paint === undefined ? {} : { paint: extra.paint }), ...(extra.clip === undefined ? {} : { clip: extra.clip }) };
    drawn.push(object);
    counts[kind] += 1;
    const open = holder();
    if (open !== null) {
      if (kind === 'path') open.paths.push(object);
      else open.other += 1;
    }
  };
  const containers: { start: number; end: number }[] = [];
  const openQ: number[] = [];
  const openMarked: number[] = [];
  const depths: { op: string; start: number; end: number; q: number; m: number; qAfter: number; mAfter: number }[] = [];
  const states: StateAt[] = [];
  let probe = 0;
  /** Where each text object ends, by where it begins: the offset just past its `ET`. */
  const ends = new Map<number, number>();
  let state: Omit<TextState, 'matrix' | 'line' | 'ctm'> = {
    font: null, size: 0, charSpacing: 0, wordSpacing: 0, scale: 1, leading: 0, rise: 0, render: 0,
  };
  let ctm: Matrix = IDENTITY;
  let settings: readonly Setting[] = [];
  /** The graphics states `q` saved, text state, CTM and the instructions in effect included (§8.4.1). */
  const saved: { readonly state: typeof state; readonly ctm: Matrix; readonly settings: readonly Setting[] }[] = [];
  let matrix: Matrix = IDENTITY;
  let line: Matrix = IDENTITY;
  let textObject = -1;
  let operands: Token[] = [];
  let numbered = 0;
  /** The index the next shown operator would have when the matrix was last set. */
  let positionedAt = 0;

  const nextLine = (tx: number, ty: number): void => {
    line = multiply([1, 0, 0, 1, tx, ty], line);
    matrix = line;
    positionedAt = found.length;
  };
  const number = (index: number): number => {
    const token = operands[index];
    return token?.kind === 'number' ? token.value : 0;
  };

  for (const token of tokenise(content)) {
    if (token.kind !== 'operator') {
      operands.push(token);
      continue;
    }
    const op = token.value;
    const start = operands[0]?.start ?? token.start;
    // THE STATE AT EACH PROBE, with everything before it done: an instruction that begins at or after it is not.
    while (probe < probes.length && start >= (probes[probe] ?? 0)) {
      states.push({ ctm, settings, windows: [...windows] });
      probe += 1;
    }
    const before = { q: saved.length, m: openMarked.length };
    switch (op) {
      case 'q':
        saved.push({ state, ctm, settings });
        openQ.push(token.start);
        break;
      case 'BDC':
      case 'BMC': {
        openMarked.push(start);
        const kind = op === 'BDC' ? decorationNamed(content, operands) : undefined;
        openDecorations.push(kind === undefined ? null : { kind, start, paths: [], other: 0 });
        break;
      }
      case 'EMC': {
        const opened = openMarked.pop();
        if (opened !== undefined) containers.push({ start: opened, end: token.end });
        // A DECORATION IS ITS WHOLE SEQUENCE: one painted path and nothing else, or it is a drawing left as it is.
        const decoration = openDecorations.pop() ?? null;
        const only = decoration?.paths[0];
        if (decoration !== null && only !== undefined && decoration.paths.length === 1 && decoration.other === 0 && only.points.length > 0) {
          const xs = only.points.map(([x]) => x);
          const ys = only.points.map(([, y]) => y);
          decorations.push({
            kind: decoration.kind,
            start: decoration.start,
            end: token.end,
            left: Math.min(...xs),
            right: Math.max(...xs),
            bottom: Math.min(...ys),
            top: Math.max(...ys),
            colour: fillOf(content, only.settings),
            points: only.points,
          });
        }
        break;
      }
      case 'Q': {
        const opened = openQ.pop();
        if (opened !== undefined) containers.push({ start: opened, end: token.end });
        // A CLIP ENDS WITH THE GRAPHICS STATE IT WAS SET IN (§8.5.4): every window set at this depth or deeper.
        for (const window of windows) if (window.depth >= saved.length) window.end = token.start;
        windows = windows.filter((window) => window.depth < saved.length);
        const restored = saved.pop();
        if (restored !== undefined) {
          state = restored.state;
          ctm = restored.ctm;
          settings = restored.settings;
        }
        break;
      }
      case 'cm':
        ctm = multiply([number(0), number(1), number(2), number(3), number(4), number(5)], ctm);
        break;
      case 'BT':
        matrix = IDENTITY;
        line = IDENTITY;
        textObject = token.start;
        positionedAt = found.length;
        break;
      case 'ET':
        if (textObject >= 0) ends.set(textObject, token.end);
        textObject = -1;
        break;
      case 'Tc':
        state = { ...state, charSpacing: number(0) };
        break;
      case 'Tw':
        state = { ...state, wordSpacing: number(0) };
        break;
      case 'Tz':
        state = { ...state, scale: number(0) / 100 };
        break;
      case 'TL':
        state = { ...state, leading: number(0) };
        break;
      case 'Ts':
        state = { ...state, rise: number(0) };
        break;
      case 'Tr':
        state = { ...state, render: number(0) };
        break;
      case 'Tf': {
        const name = operands[0];
        state = { ...state, font: name?.kind === 'name' ? name.value : null, size: number(1) };
        break;
      }
      case 'Td':
        nextLine(number(0), number(1));
        break;
      case 'TD':
        state = { ...state, leading: -number(1) };
        nextLine(number(0), number(1));
        break;
      case 'Tm':
        line = [number(0), number(1), number(2), number(3), number(4), number(5)];
        matrix = line;
        positionedAt = found.length;
        break;
      case 'T*':
        nextLine(0, -state.leading);
        break;
      default:
        break;
    }
    // WHAT IS DRAWN (ADR-0240): a path from its first segment to the paint that ends it, which makes an object unless it
    // is `n`; an image or a form by the `Do` that names it, or an inline image; a shading by `sh`.
    const segment = SEGMENTS.get(op);
    if (segment !== undefined) {
      path ??= { start, points: [], clips: false, segments: [] };
      const values = operands.flatMap((operand) => (operand.kind === 'number' ? [operand.value] : []));
      path.segments.push({ op, values, start, end: token.end });
      if (op === 're') {
        const [x = 0, y = 0, w = 0, h = 0] = values;
        path.points.push(apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h));
      } else {
        for (let at = 0; at + 1 < values.length; at += 2) path.points.push(apply(ctm, values[at] ?? 0, values[at + 1] ?? 0));
      }
    } else if (op === 'W' || op === 'W*') {
      if (path !== null) {
        path.clips = true;
        path.clip = { op, start: token.start, end: token.end };
      }
    } else if (PAINTS.has(op) || op === 'n') {
      if (path !== null && op !== 'n') {
        draw('path', path.start, token.end, ctm, path.clips, path.points, {
          segments: path.segments,
          paint: { op, start: token.start, end: token.end },
          ...(path.clip === undefined ? {} : { clip: path.clip }),
        });
      }
      // THE CLIP TAKES HOLD AFTER THE PAINT (§8.5.4), so the path that sets it is not drawn through it.
      if (path?.clips === true) {
        windows.push({
          start: path.start,
          end: content.length,
          depth: saved.length,
          ctm,
          points: path.points,
          segmentsEnd: path.clip?.start ?? token.start,
          evenOdd: path.clip?.op === 'W*',
        });
      }
      path = null;
    } else if (op === 'Do') {
      const name = operands[0];
      const kind = name?.kind === 'name' ? xobject(name.value) : undefined;
      if (kind !== undefined) draw(kind, start, token.end, ctm);
    } else if (op === 'BI') {
      draw('image', token.start, token.end, ctm);
    } else if (op === 'sh') {
      draw('shading', start, token.end, ctm);
    }
    if (op === "'" || op === '"') {
      if (op === '"') state = { ...state, wordSpacing: number(0), charSpacing: number(1) };
      nextLine(0, -state.leading);
    }
    if (SHOWS.has(op)) {
      const operand = operands.at(-1);
      const elements: (Uint8Array | number)[] =
        operand?.kind === 'array'
          ? operand.items.flatMap<Uint8Array | number>((item) =>
              item.kind === 'string' ? [item.bytes] : item.kind === 'number' ? [item.value] : [],
            )
          : operand?.kind === 'string'
            ? [operand.bytes]
            : [];
      const strings = elements.filter((element): element is Uint8Array => element instanceof Uint8Array);
      const codes = new Uint8Array(strings.reduce((total, string) => total + string.length, 0));
      let at = 0;
      for (const string of strings) {
        codes.set(string, at);
        at += string.length;
      }
      found.push({
        object: codes.length > 0 ? numbered : null,
        operator: op as ShowOperator['operator'],
        start,
        end: token.end,
        codes,
        elements,
        state: { ...state, matrix, line, ctm },
        positionedAt,
        textObject,
        settings: settings.map(({ start: from, end: to }) => ({ start: from, end: to })),
      });
      if (codes.length > 0) numbered += 1;
      const open = holder();
      if (open !== null) open.other += 1;
    } else if (SETTINGS.has(op)) {
      const slot = SETTINGS.get(op) ?? null;
      const gone = new Set([slot, ...(SUPERSEDES.get(op) ?? [])]);
      settings = [...settings.filter((setting) => setting.slot === null || !gone.has(setting.slot)), { slot, start, end: token.end }];
    }
    depths.push({ op, start, end: token.end, q: before.q, m: before.m, qAfter: saved.length, mAfter: openMarked.length });
    operands = [];
  }
  while (probe < probes.length) {
    states.push({ ctm, settings, windows: [...windows] });
    probe += 1;
  }
  return { operators: found, depth: saved.length, baseCtm: saved[0]?.ctm ?? ctm, ends, drawn, containers, depths, states, decorations };
}

/**
 * The kind a `BDC`'s tag and properties name a decoration (`markDecorations.ts`): `/Artifact` with its
 * {@link DECORATION_KEY} a string naming a kind, written inline as both writers write it. A property list named from the
 * resources is not read, and is then not a decoration.
 */
function decorationNamed(content: Uint8Array, operands: readonly Token[]): DecorationKind | undefined {
  const [tag, properties] = operands;
  if (tag?.kind !== 'name' || tag.value !== DECORATION_TAG || properties?.kind !== 'other') return undefined;
  if (content[properties.start] !== 0x3c || content[properties.start + 1] !== 0x3c) return undefined;
  const inside = [...tokenise(content.subarray(properties.start + 2, Math.max(properties.start + 2, properties.end - 2)))];
  for (const [at, token] of inside.entries()) {
    const value = inside[at + 1];
    if (token.kind === 'name' && token.value === DECORATION_KEY && value?.kind === 'string') {
      return decorationKindOf(new TextDecoder('latin1').decode(value.bytes));
    }
  }
  return undefined;
}

/** The fill colour `settings` leave in force, in 0 to 255, by the operator that set it: black where none did. */
function fillOf(content: Uint8Array, settings: readonly Setting[]): Rgb {
  const fill = settings.findLast((setting) => setting.slot === 'fill');
  if (fill === undefined) return { r: 0, g: 0, b: 0 };
  const said = [...tokenise(content.subarray(fill.start, fill.end))];
  const values = said.flatMap((token) => (token.kind === 'number' ? [Math.min(1, Math.max(0, token.value))] : []));
  const channel = (value: number): number => Math.round(value * 255);
  if (values.length === 1) {
    const grey = channel(values[0] ?? 0);
    return { r: grey, g: grey, b: grey };
  }
  if (values.length === 3) return { r: channel(values[0] ?? 0), g: channel(values[1] ?? 0), b: channel(values[2] ?? 0) };
  if (values.length === 4) {
    const [c = 0, m = 0, y = 0, k = 0] = values;
    return { r: channel((1 - c) * (1 - k)), g: channel((1 - m) * (1 - k)), b: channel((1 - y) * (1 - k)) };
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * The page's marked decorations ({@link MarkedDecoration}) beside its text-showing operators, from the one pass: what a
 * writer that sets a block's words again needs to take the block's old rules away with its old words.
 */
export function operatorsAndDecorations(content: Uint8Array): {
  readonly operators: readonly ShowOperator[];
  readonly decorations: readonly MarkedDecoration[];
} {
  const { operators, decorations } = scan(content);
  return { operators, decorations };
}

/** The operator PDFium's text object `object` is, or `undefined` where the content shows fewer. */
export function operatorOf(operators: readonly ShowOperator[], object: number): ShowOperator | undefined {
  return operators.find((operator) => operator.object === object);
}

/** How many text objects PDFium makes of this content: what the writer checks against PDFium's own count. */
export function textObjectCount(operators: readonly ShowOperator[]): number {
  return operators.filter((operator) => operator.object !== null).length;
}
