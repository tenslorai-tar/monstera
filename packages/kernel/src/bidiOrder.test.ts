import { existsSync, readFileSync } from 'node:fs';

import { createRequire } from 'node:module';

import type { Bidi } from 'bidi-js';
import { describe, expect, it } from 'vitest';

import { type TextDirection, type VisualSpan, lineSpans, paragraphDirection, paragraphLevels } from './bidiOrder.js';

/** `bidi-js` itself, loaded as `bidiOrder.ts` loads it, for the controls that show what it answers without this module. */
const theirs = (createRequire(import.meta.url)('bidi-js') as () => Bidi)();

/**
 * The drawing order of mixed-direction text (UAX #9), against Unicode's own conformance cases and against the two
 * defects `bidiOrder.ts` stands between `bidi-js` and the page.
 */

/** Every index of the spans, in drawing order: a right-to-left span's indices last to first. */
function visualIndices(spans: readonly VisualSpan[]): number[] {
  return spans.flatMap((span) => {
    const indices = Array.from({ length: span.end - span.start }, (_, at) => span.start + at);
    return span.rtl ? indices.reverse() : indices;
  });
}

/** The spans as `[text, rtl]` pairs, which a case can read. */
function spansOf(text: string, direction: TextDirection = paragraphDirection(text)): [string, boolean][] {
  return lineSpans(paragraphLevels(text, direction), 0, text.length).map((span) => [
    text.slice(span.start, span.end),
    span.rtl,
  ]);
}

const HEBREW = 'שלום';
const OTHER_HEBREW = 'עולם';
const ADLAM = String.fromCodePoint(0x1e900, 0x1e901);

describe('paragraphDirection and lineSpans', () => {
  it('takes a paragraph’s direction from its first strong character', () => {
    expect(paragraphDirection(`${HEBREW} abc`)).toBe('rtl');
    // CONTROL: the same words the other way round.
    expect(paragraphDirection(`abc ${HEBREW}`)).toBe('ltr');
    expect(paragraphDirection('123 !')).toBe('ltr');
  });

  it('draws a right-to-left run inside a left-to-right line as one span, set right to left', () => {
    expect(spansOf(`ab ${HEBREW} cd`)).toStrictEqual([
      ['ab ', false],
      [HEBREW, true],
      [' cd', false],
    ]);
  });

  it('keeps a number left to right inside a right-to-left paragraph, and orders the words from the right', () => {
    expect(spansOf(`${HEBREW} 12 ${OTHER_HEBREW}`)).toStrictEqual([
      [` ${OTHER_HEBREW}`, true],
      ['12', false],
      [`${HEBREW} `, true],
    ]);
  });

  it('reads a right-to-left character past the BMP as right to left, which bidi-js alone does not', () => {
    expect(paragraphDirection(ADLAM)).toBe('rtl');
    expect(spansOf(`a ${ADLAM} b`, 'ltr')).toStrictEqual([
      ['a ', false],
      [ADLAM, true],
      [' b', false],
    ]);
    // CONTROL: `bidi-js` given the same text resolves it at level 0, so the stand-in is what makes the difference.
    expect(theirs.getEmbeddingLevels(ADLAM, 'auto').paragraphs[0]?.level).toBe(0);
  });

  it('resets the whitespace at the end of a LATER line to the paragraph’s level (rule L1)', () => {
    const text = `a ${HEBREW} ${OTHER_HEBREW} ${HEBREW}`;
    const paragraph = paragraphLevels(text, 'ltr');
    // The second line is the second Hebrew word and the space after it, and the paragraph goes on past it. That space
    // sits between two right-to-left words, so its resolved level is 1 until L1 returns it to 0 at the line's end.
    const second = text.indexOf(OTHER_HEBREW);
    const end = second + OTHER_HEBREW.length + 1;
    expect(lineSpans(paragraph, second, end).map((span) => [text.slice(span.start, span.end), span.rtl])).toStrictEqual([
      [OTHER_HEBREW, true],
      [' ', false],
    ]);
    // CONTROL: bidi-js' own reordering of that line reverses the space with the word, so it comes first — the defect
    // this module does not take. Its answer covers the whole string, so the line's part is read out of it.
    const order = theirs
      .getReorderedIndices(text, theirs.getEmbeddingLevels(text, 'ltr'), second, end - 1)
      .filter((index) => index >= second && index < end);
    expect(order[0]).toBe(end - 1);
  });

  it('orders a line of one character', () => {
    expect(spansOf(HEBREW.slice(0, 1))).toStrictEqual([[HEBREW.slice(0, 1), true]]);
  });

  it('orders each paragraph of a range on its own', () => {
    const text = `${HEBREW}\u{2029}ab`;
    expect(visualIndices(lineSpans(paragraphLevels(text, 'rtl'), 0, text.length))).toStrictEqual([4, 3, 2, 1, 0, 5, 6]);
  });
});

/** One case of `BidiCharacterTest.txt`: its text, the direction it is given, and what the algorithm answers. */
interface ConformanceCase {
  readonly line: number;
  readonly codePoints: readonly number[];
  readonly direction: 'ltr' | 'rtl' | 'auto';
  readonly paragraphLevel: number;
  readonly levels: readonly (number | null)[];
  readonly order: readonly number[];
}

function conformanceCases(): ConformanceCase[] {
  const path = process.env['MONSTERA_BIDI_CHARACTER_TEST'] ?? '';
  // ABSENT IS A FAILURE, never a skip: a skipped conformance run reads exactly like a passed one.
  if (path === '' || !existsSync(path)) {
    throw new Error(`Unicode's BidiCharacterTest.txt is not provisioned at ${path}. Run: node scripts/provision/unicodeTests.mjs`);
  }
  const cases: ConformanceCase[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      if (raw === '' || raw.startsWith('#')) return;
      const [points, direction, level, levels, order] = raw.split(';');
      if (points === undefined || direction === undefined || level === undefined || levels === undefined || order === undefined) {
        throw new Error(`line ${String(index + 1)} of the conformance file has fewer than five fields`);
      }
      cases.push({
        line: index + 1,
        codePoints: points.trim().split(' ').map((hex) => Number.parseInt(hex, 16)),
        direction: direction === '0' ? 'ltr' : direction === '1' ? 'rtl' : 'auto',
        paragraphLevel: Number(level),
        levels: levels.trim().split(' ').map((value) => (value === 'x' ? null : Number(value))),
        order: order.trim() === '' ? [] : order.trim().split(' ').map(Number),
      });
    });
  return cases;
}

/** What this module answers for a case, set after `prefix` units of another paragraph, as code point indices. */
function answer(entry: ConformanceCase, prefix: string): { paragraphLevel: number; order: number[] } {
  const text = prefix + String.fromCodePoint(...entry.codePoints);
  const unitOf: number[] = [];
  let unit = prefix.length;
  for (const point of entry.codePoints) {
    unitOf.push(unit);
    unit += point > 0xffff ? 2 : 1;
  }
  const own = String.fromCodePoint(...entry.codePoints);
  const direction: TextDirection =
    entry.direction === 'auto' ? paragraphDirection(own) : entry.direction;
  const paragraph = paragraphLevels(text, direction);
  // A CHARACTER THE FILE MARKS `x` has no level and no place in the order (rule X9 removes it), so it is left out of
  // what is compared, as the file's own header says.
  const kept = new Set(entry.levels.flatMap((level, at) => (level === null ? [] : [unitOf[at] ?? -1])));
  const order = visualIndices(lineSpans(paragraph, prefix.length, text.length))
    .filter((index) => kept.has(index))
    .map((index) => unitOf.indexOf(index));
  return { paragraphLevel: direction === 'rtl' ? 1 : 0, order };
}

describe('lineSpans against Unicode 17’s BidiCharacterTest.txt', () => {
  const cases = conformanceCases();

  it('reads every case of the file, so a parse that ate it cannot pass', () => {
    // THE FILE'S OWN COUNT, measured when it was pinned: a shorter read would be a broken parse rather than a clean run.
    expect(cases).toHaveLength(91_707);
  });

  it('gives every case its paragraph level and its visual order, at the start of the text and after another paragraph', () => {
    const failures: string[] = [];
    for (const entry of cases) {
      // AFTER A PARAGRAPH OF ITS OWN as well: every later line of a composed paragraph starts past index 0, which is
      // where `bidi-js`' own L1 goes wrong, so a run at offset 0 alone would prove nothing about them.
      for (const prefix of ['', 'abc\u{2029}']) {
        const got = answer(entry, prefix);
        if (got.paragraphLevel !== entry.paragraphLevel || got.order.join(' ') !== entry.order.join(' ')) {
          failures.push(`line ${String(entry.line)}${prefix === '' ? '' : ' after a paragraph'}: got ${got.order.join(' ')}, want ${entry.order.join(' ')}`);
        }
      }
    }
    expect(failures.slice(0, 10)).toStrictEqual([]);
    expect(failures).toHaveLength(0);
  });
});
