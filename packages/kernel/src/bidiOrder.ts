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
