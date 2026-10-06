import { createRequire } from 'node:module';

import type { Bidi, BidiCharTypeName, EmbeddingLevels } from 'bidi-js';

/**
 * The order text is drawn in, by the Unicode Bidirectional Algorithm (UAX #9), for text Monstera writes onto a page
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## One module answers it
 *
 * The algorithm is the authority and `bidi-js` implements it: measured 2026-10-05, all 91,707 cases of Unicode 17's
 * `BidiCharacterTest.txt` give its levels and its order. Every writer that lays out mixed-direction text asks this
 * module, so there is one reading of the algorithm in the repository (B3a).
 *
 * ## A character past the BMP is given to `bidi-js` as two units of its own class
 *
 * `bidi-js` reads its string one UTF-16 unit at a time, so each half of a surrogate pair is classified alone, and a
 * lone surrogate is not in its tables: measured 2026-10-05, two Adlam letters (class R, which its own
 * `getBidiCharTypeName` reports correctly) were resolved as a left-to-right paragraph at level 0. The conformance file
 * holds no character past U+FFFF, which is why all 91,707 cases pass while this fails. So each unit of such a pair is
 * replaced, for the algorithm only, by a BMP character of the same class. Indices are unchanged, and two units of one
 * class resolve as one character of it does: no rule of the algorithm counts how many characters of a class are in a
 * row. Shaping and drawing still use the text itself.
 */

/**
 * The algorithm's one instance, its factory loaded by `require` and checked at load.
 *
 * The package's `main` is CommonJS whose `module.exports` IS the factory, while its types declare an ES default
 * export, and under this build's module resolution the compiler reads that as `module.exports.default` — a property
 * the package does not have (measured 2026-10-05: a default import type-checks as a namespace with no call signature,
 * and a namespace import's `default` as the same namespace). So the types are not taken on trust: the export is
 * required, checked to be a function, and given the package's own `Bidi` interface — `fontSubset.ts`' rule for a
 * WebAssembly module's exports.
 */
const BIDI = ((): Bidi => {
  const factory: unknown = createRequire(import.meta.url)('bidi-js');
  if (typeof factory !== 'function') throw new Error('bidi-js did not export its factory');
  return (factory as () => Bidi)();
})();

/** The direction a paragraph is laid out in. */
export type TextDirection = 'ltr' | 'rtl';

/** A stretch of one line drawn in one direction: a range of UTF-16 indices of the text, end exclusive. */
export interface VisualSpan {
  readonly start: number;
  readonly end: number;
  readonly rtl: boolean;
}

/**
 * A BMP character of each class a character past the BMP can have. Explicit embeddings, isolates and paragraph
 * separators are all in the BMP, so they never need one.
 */
const STAND_IN: Partial<Record<BidiCharTypeName, string>> = {
  L: 'a',
  R: '\u{5d0}',
  AL: '\u{627}',
  EN: '0',
  ES: '+',
  ET: '#',
  AN: '\u{660}',
  CS: ',',
  WS: ' ',
  ON: '!',
  BN: '\u{ad}',
  NSM: '\u{300}',
};

/** `text` as the algorithm is given it: each character past the BMP replaced, unit for unit, by one of its class. */
function forTheAlgorithm(text: string): string {
  // A CODE POINT RANGE, not a surrogate one: with the `u` flag a class of lone surrogates never matches a pair.
  if (!/[\u{10000}-\u{10ffff}]/u.test(text)) return text;
  let out = '';
  for (const character of text) {
    if (character.length === 1) {
      out += character;
      continue;
    }
    const standIn = STAND_IN[BIDI.getBidiCharTypeName(character)] ?? 'a';
    out += standIn + standIn;
  }
  return out;
}

/**
 * The direction a paragraph is laid out in, from its first strong character (rules P2 and P3), left to right where it
 * has none.
 */
export function paragraphDirection(text: string): TextDirection {
  const levels = BIDI.getEmbeddingLevels(forTheAlgorithm(text), 'auto');
  return (levels.paragraphs[0]?.level ?? 0) % 2 === 1 ? 'rtl' : 'ltr';
}

/** A paragraph's resolved levels, computed once and read per line. */
export interface ParagraphLevels {
  /** The text the algorithm was given, {@link forTheAlgorithm}'s, whose classes L1 reads. */
  readonly algorithmText: string;
  readonly direction: TextDirection;
  readonly levels: EmbeddingLevels;
}

/** Resolves a paragraph's levels in `direction`, for {@link lineSpans} to order its lines from. */
export function paragraphLevels(text: string, direction: TextDirection): ParagraphLevels {
  const algorithmText = forTheAlgorithm(text);
  return { algorithmText, direction, levels: BIDI.getEmbeddingLevels(algorithmText, direction) };
}

/** The classes rule L1 returns to the paragraph's level at the end of a line and before a separator. */
const RESET_BEFORE: ReadonlySet<BidiCharTypeName> = new Set(['WS', 'FSI', 'LRI', 'RLI', 'PDI', 'BN']);

/**
 * One line's levels after rule L1: a segment or paragraph separator, the whitespace and isolate formatters before
 * one, and those at the line's end, at the paragraph's level.
 *
 * ## Here, and not `bidi-js`' `getReorderSegments`
 *
 * Its L1 writes `lineLevels[i]` with `i` the index into the whole string while `lineLevels` is the line's slice
 * (`reordering.js`, read 2026-10-05), so every line after the first resets the wrong characters, and its
 * `lineStart < lineEnd` skips a line of one character. The levels themselves are `bidi-js`' and conformance holds
 * them; rules L1 and L2 are a dozen lines, and they live in this one module.
 *
 * **What proves which.** The conformance file runs every case at the start of the text and again after another
 * paragraph, which proves L2 at an offset. It cannot prove L1 at a line that ends inside a paragraph: every case is a
 * whole paragraph, and `getEmbeddingLevels` already applies L1 at a paragraph's end, so the reset here repeats work
 * for every case in the file. Measured 2026-10-05: with this reset writing `bidi-js`' absolute index, the whole file
 * still passed. The case `bidiOrder.test.ts` names for a LATER line is the one that turns red.
 */
function lineLevels(paragraph: ParagraphLevels, base: number, start: number, end: number): number[] {
  const levels = Array.from(paragraph.levels.levels.subarray(start, end));
  const classOf = (at: number): BidiCharTypeName =>
    BIDI.getBidiCharTypeName(paragraph.algorithmText[start + at] ?? 'a');
  const resetBefore = (from: number): void => {
    for (let at = from; at >= 0 && RESET_BEFORE.has(classOf(at)); at -= 1) levels[at] = base;
  };
  for (let at = 0; at < levels.length; at += 1) {
    const kind = classOf(at);
    if (kind === 'S' || kind === 'B') {
      levels[at] = base;
      resetBefore(at - 1);
    }
  }
  resetBefore(levels.length - 1);
  return levels;
}

/**
 * One line of a paragraph, `[start, end)` in its indices, as spans in drawing order, left to right (rules L1 and L2).
 *
 * Each span is a range the line holds at one level, so a span's characters are in logical order and its `rtl` says
 * which way the shaper sets them. A character past the BMP is never cut in two: its two units have one level, so L2
 * reverses them together and they stay next to each other.
 *
 * A range holding a paragraph separator is ordered one paragraph at a time, each at its own level, because a
 * separator ends a line: the algorithm never reorders across one.
 */
export function lineSpans(paragraph: ParagraphLevels, start: number, end: number): VisualSpan[] {
  const spans: VisualSpan[] = [];
  for (const part of paragraph.levels.paragraphs) {
    const from = Math.max(start, part.start);
    const to = Math.min(end, part.end + 1);
    if (from < to) spans.push(...paragraphLineSpans(paragraph, part.level, from, to));
  }
  return spans;
}

function paragraphLineSpans(paragraph: ParagraphLevels, base: number, start: number, end: number): VisualSpan[] {
  const levels = lineLevels(paragraph, base, start, end);
  // L2: from the highest level to the lowest odd one, reverse every run of characters at that level or higher.
  const order = levels.map((_, at) => at);
  const highest = Math.max(...levels);
  const lowestOdd = Math.min(...levels.map((level) => level | 1));
  for (let level = highest; level >= lowestOdd; level -= 1) {
    for (let at = 0; at < order.length; at += 1) {
      if ((levels[order[at] ?? 0] ?? 0) < level) continue;
      let last = at;
      while (last + 1 < order.length && (levels[order[last + 1] ?? 0] ?? 0) >= level) last += 1;
      order.splice(at, last - at + 1, ...order.slice(at, last + 1).reverse());
      at = last;
    }
  }
  const spans: { start: number; end: number; rtl: boolean; last: number; level: number }[] = [];
  for (const relative of order) {
    const index = start + relative;
    const level = levels[relative] ?? 0;
    const span = spans.at(-1);
    if (span?.level === level && Math.abs(index - span.last) === 1) {
      span.start = Math.min(span.start, index);
      span.end = Math.max(span.end, index + 1);
      span.last = index;
    } else {
      spans.push({ start: index, end: index + 1, rtl: level % 2 === 1, last: index, level });
    }
  }
  return spans.map((span) => ({ start: span.start, end: span.end, rtl: span.rtl }));
}

/**
 * One line's text in the order a PDF text object holds it: left to right as drawn, each right-to-left span reversed
 * (rules L1 and L2).
 *
 * ## A content stream is in VISUAL order, and a text page reads it back to LOGICAL
 *
 * Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build, an object set to `אב` and read from a text page reads
 * `בא`, and `שלום` reads `םולש`: the extractor assumes the stream is in drawing order and reverses a right-to-left run
 * to give the text as typed. So text written in the order typed is DRAWN backwards and read back as another string,
 * and the write was refused because the read-back did not match it. Written through this, the glyphs are drawn in the
 * order a reader sees and the read-back is the text typed.
 *
 * A character past the BMP stays whole, because it is reversed by code point; a combining mark is reversed with its
 * letter's neighbours and so precedes its base, which a text page reverses back and a renderer draws at the mark's own
 * advance (a mark's glyph is positioned by its font, not by the stream's order).
 */
export function drawnOrder(text: string): string {
  return reordered(text, lineDirection(text));
}

/**
 * The direction a line is laid out in: that of the MAJORITY of its letters, and of its first strong letter where the two
 * are level.
 *
 * ## Not the algorithm's own choice (rules P2 and P3), because the text is read back
 *
 * A PDF stores the drawn order and no paragraph direction, so a line read from a page has to be given one again, and
 * the first strong letter of what is read is the wrong place to ask: a right-to-left line that begins with a Latin word
 * reads, in drawing order, as left to right. The majority is the same set of letters in either order, so it is the same
 * answer for the line as typed and for the line as drawn, which is what makes writing what was read change nothing
 * ({@link logicalOf}). A line mostly of Hebrew with an English word in it is right to left whichever word comes first.
 */
export function lineDirection(text: string): TextDirection {
  let right = 0;
  let left = 0;
  for (const character of text) {
    const kind = BIDI.getBidiCharTypeName(character);
    if (kind === 'R' || kind === 'AL') right += 1;
    else if (kind === 'L') left += 1;
  }
  if (right === left) return paragraphDirection(text);
  return right > left ? 'rtl' : 'ltr';
}

/** Whether a character is of class R or AL: what a text page takes as a letter to be read right to left. */
function isRightToLeftLetter(character: string): boolean {
  const kind = BIDI.getBidiCharTypeName(character);
  return kind === 'R' || kind === 'AL';
}

/**
 * What a text page reads from an object whose glyphs are drawn as `drawn`: each unbroken run of right-to-left letters
 * reversed in place, a run of neutrals BETWEEN two of them reversed and mirrored with them, and everything else —
 * a neutral at an edge, digits, Latin — left where it stands.
 *
 * Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build: ` םולש` reads ` שלום`, `םלוע םולש` reads `עולם שלום` (each
 * WORD reversed and the words left in the order drawn: a text page reverses SEGMENTS of one kind, not the whole run
 * the algorithm would), and `(םלוע) םולש` reads `(עולם (שלום` (the leading bracket stays, the one between two words is
 * reversed and mirrored). So a text page does not give the order typed for a line of more than one word, and the
 * reading is its own inverse: applied to what it read, it gives what was drawn.
 *
 * This is a MODEL of PDFium's rule and not the algorithm's, and a read-back compares against it: where the model is
 * not what PDFium does the comparison fails and the edit is refused, since a character drawn and not read back is never
 * accepted for it.
 */
export function readBackOf(drawn: string): string {
  const segments: { kind: 'R' | 'N' | 'O'; text: string }[] = [];
  for (const character of drawn) {
    const name = BIDI.getBidiCharTypeName(character);
    const kind = isRightToLeftLetter(character) ? 'R' : DIRECTIONLESS.has(name) ? 'N' : 'O';
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += character;
    else segments.push({ kind, text: character });
  }
  return segments
    .map(({ kind, text }, at) => {
      if (kind === 'R') return reversedByCodePoint(text);
      // A NEUTRAL RUN AFTER A WORD AND BEFORE ANOTHER, OR BEFORE THE END, is read as part of the right-to-left text it
      // follows; one before a word, or next to a number or a Latin letter, is read where it stands.
      const follows = segments[at - 1]?.kind === 'R';
      const next = segments[at + 1];
      return kind === 'N' && follows && (next === undefined || next.kind === 'R') ? drawnRightToLeft(text) : text;
    })
    .join('');
}

/**
 * The classes a text page takes as having no direction of their own: white space, other neutrals and separators. The
 * weak classes (numbers and their separators, `:` `,` `.` `-`) are not among them: measured 2026-10-06, `םלוע :םולש`
 * reads `עולם :שלום` with the colon left where it is drawn, while `(םלוע) םולש` reads `(עולם (שלום`.
 */
const DIRECTIONLESS: ReadonlySet<BidiCharTypeName> = new Set(['WS', 'ON', 'S', 'B']);

function reversedByCodePoint(span: string): string {
  return Array.from(span).reverse().join('');
}

/**
 * A line as it was typed, from what a text page read of an object drawn in the order a reader sees: the drawn string
 * rebuilt by undoing the reading ({@link readBackOf} is its own inverse), then ordered back by the algorithm in the
 * line's direction ({@link lineDirection}), mirroring included. The inverse of {@link drawnOrder} for the lines this
 * module draws, and the best reading of one it did not.
 */
export function logicalOf(read: string): string {
  if (!Array.from(read).some(isRightToLeftLetter)) return read;
  return logicalOfDrawn(readBackOf(read));
}

/**
 * A line as it was typed, from the glyphs in the order they are drawn, left to right: the line's majority direction
 * ({@link lineDirection}) and the algorithm's reordering, the inverse of {@link drawnOrder}. What {@link logicalOf} does
 * once the text page's reading is undone, and what a LINE of several objects needs, because the reordering is a
 * property of the whole line: applied to each object alone, a space joined to the edge of a right-to-left word goes to
 * the wrong side of it, and the words of a line in two objects come back in the order drawn.
 */
export function logicalOfDrawn(drawn: string): string {
  return reordered(drawn, lineDirection(drawn));
}

/** The text a line's glyphs say in the order drawn, with where each unit of the line as typed came from; see {@link logicalOfDrawn}. */
export function logicalFromDrawn(drawn: string): { readonly text: string; readonly from: readonly number[] } {
  return reorderedFrom(drawn, lineDirection(drawn));
}

/** Whether `text` has a character the algorithm takes as a right-to-left letter. */
export function hasRightToLeftLetter(text: string): boolean {
  return Array.from(text).some(isRightToLeftLetter);
}

/** The bit {@link strongDirections} sets for a left-to-right letter. */
export const LEFT_TO_RIGHT = 1;
/** The bit {@link strongDirections} sets for a right-to-left letter. */
export const RIGHT_TO_LEFT = 2;

/**
 * Which ways the strong letters of `text` run: {@link LEFT_TO_RIGHT}, {@link RIGHT_TO_LEFT}, both added, or 0 where it has
 * none (digits, spaces and punctuation take their direction from what is beside them).
 */
export function strongDirections(text: string): number {
  let kinds = 0;
  for (const character of text) {
    const kind = BIDI.getBidiCharTypeName(character);
    if (kind === 'L') kinds |= LEFT_TO_RIGHT;
    else if (kind === 'R' || kind === 'AL') kinds |= RIGHT_TO_LEFT;
    if (kinds === (LEFT_TO_RIGHT | RIGHT_TO_LEFT)) break;
  }
  return kinds;
}

function reordered(text: string, direction: TextDirection): string {
  return reorderedFrom(text, direction).text;
}

/**
 * {@link reordered}'s answer and where each of its UTF-16 units came from: `from[k]` is the index in `text` of the unit at
 * `k` in the result. The one implementation of the reordering, so the text and the permutation cannot be two readings of
 * it (B3a): a line made of several objects asks which object each character of the line as typed came from.
 */
export function reorderedFrom(text: string, direction: TextDirection): { readonly text: string; readonly from: readonly number[] } {
  const paragraph = paragraphLevels(text, direction);
  // THE ALGORITHM SAYS WHETHER ANYTHING IS RIGHT TO LEFT, not a range of code points listed here: text with no odd
  // level is returned as it came.
  if (!paragraph.levels.levels.some((level) => level % 2 === 1)) {
    return { text, from: Array.from({ length: text.length }, (_, at) => at) };
  }
  let out = '';
  const from: number[] = [];
  for (const { start, end, rtl } of lineSpans(paragraph, 0, text.length)) {
    const units = rtl ? rightToLeftUnits(text.slice(start, end)) : [{ text: text.slice(start, end), at: 0 }];
    for (const unit of units) {
      out += unit.text;
      for (let offset = 0; offset < unit.text.length; offset += 1) from.push(start + unit.at + offset);
    }
  }
  return { text: out, from };
}

/**
 * `span`, one right-to-left span of a line, in the order and shape its glyphs are drawn: reversed by code point, and
 * each character that has a mirror image replaced by it (rule L4), so the opening bracket of a Hebrew phrase is drawn
 * facing the phrase it opens.
 */
export function drawnRightToLeft(span: string): string {
  return rightToLeftUnits(span)
    .map((unit) => unit.text)
    .join('');
}

/** The units of a right-to-left span in drawing order: each cluster, mirrored where it has a mirror image, and where it stood. */
function rightToLeftUnits(span: string): { readonly text: string; readonly at: number }[] {
  // A LETTER AND ITS MARKS ARE ONE UNIT, marks after the letter as typed: a mark is drawn at the pen where the letter
  // ended and sits over it through its own offset, so a mark set BEFORE its letter in the drawn order would stand over
  // the letter beside it. A text page reverses by character, which {@link readBackOf} models separately.
  const clusters = [...span.matchAll(/\P{M}\p{M}*|\p{M}+/gu)].map((match) => ({ text: match[0], at: match.index }));
  return clusters.reverse().map(({ text, at }) => ({ text: BIDI.getMirroredCharacter(text) ?? text, at }));
}

/**
 * Whether `read`, from a live text page, holds the glyphs of `written`: a bracket and its mirror image counted as one,
 * and for a text with right-to-left characters in it the same characters in any order.
 *
 * ## Why the live read-back cannot be exact for these
 *
 * Measured 2026-10-06: an object read alone reads as {@link readBackOf} says, and read among the line's other objects
 * it reads in the line's own direction, with a bracket mirrored and a space on the other side of its word
 * (`) םולש` alone, ` (שלום` in the line). The read-back exists to find a character the font did not draw, which reads
 * as another character or none, and that is a difference of CHARACTERS and not of order, so for these texts it asks
 * the question it was written for.
 */
export function drewTheGlyphs(written: string, read: string): boolean {
  const fold = (text: string): string[] =>
    Array.from(text, (character) => {
      const mirror = BIDI.getMirroredCharacter(character);
      return mirror !== null && mirror < character ? mirror : character;
    });
  // A BRACKET NEXT TO RIGHT-TO-LEFT TEXT is read mirrored even in an object with no such letter in it (`)` beside a
  // Hebrew word reads `(`), so the mirror image is the same glyph for every text; the ORDER is let go only for a text
  // that has right-to-left characters in it.
  const wanted = fold(written);
  const got = fold(read);
  if (isBidirectional(written)) return wanted.sort().join('') === got.sort().join('');
  return wanted.join('') === got.join('');
}

/** Whether the algorithm gives any character of `text` an odd level in a paragraph laid out in {@link lineDirection}. */
export function isBidirectional(text: string): boolean {
  return paragraphLevels(text, lineDirection(text)).levels.levels.some((level) => level % 2 === 1);
}

/** The classes that take their direction from their neighbours: white space, separators and other neutrals. */
const NEUTRAL: ReadonlySet<BidiCharTypeName> = new Set(['WS', 'ON', 'S', 'B', 'CS', 'ES', 'ET']);

/** Whether every character of `text` is a neutral, so that the text has no direction of its own. */
export function isNeutralOnly(text: string): boolean {
  return text !== '' && Array.from(forTheAlgorithm(text)).every((character) => NEUTRAL.has(BIDI.getBidiCharTypeName(character)));
}
