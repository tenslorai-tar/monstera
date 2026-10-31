import { describe, expect, it } from 'vitest';

import { LETTERS_FILE_MAX_BYTES, LETTERS_LINE_HEADER_BYTES, type WalkedLine, readLetters, writeLetters } from './textLetters.js';

/**
 * The letters' format (ADR-0280 and its second correction): its writer, and `main`'s reading of it as from a hostile
 * host (invariant 25). The producer of walked lines is not settled (cloud run 30's report), so these cases build the
 * walked lines themselves, as a producer would hand them.
 */
describe('main reads the letters as from a hostile host (invariant 25)', () => {
  const walked = (text: string): WalkedLine => ({
    direction: { x: 1, y: 0 },
    size: 11,
    characters: Array.from(text, (c, at) => ({ c, x: 72 + at * 5, y: 700 })),
    end: { x: 72 + Array.from(text).length * 5, y: 700 },
  });

  it('refuses a file one byte past the bound, whole, before reading a line', () => {
    const past = new Uint8Array(LETTERS_FILE_MAX_BYTES + 1);
    expect(readLetters(past, ['a'])).toStrictEqual({ refused: 'past-bound' });
    // CONTROL: a file AT the bound is not refused for its size.
    expect(readLetters(new Uint8Array(LETTERS_FILE_MAX_BYTES), ['a'])).not.toStrictEqual({ refused: 'past-bound' });
  });

  it('refuses a file whose record runs past its end', () => {
    const bytes = writeLetters([walked('abc')]);
    expect(readLetters(bytes.subarray(0, bytes.length - 1), ['abc'])).toStrictEqual({ refused: 'malformed' });
    expect(readLetters(bytes.subarray(0, LETTERS_LINE_HEADER_BYTES - 1), ['abc'])).toStrictEqual({ refused: 'malformed' });
  });

  it('places a line as today where its count disagrees with its text, and pairs the lines either side', () => {
    const bytes = writeLetters([walked('one'), walked('four'), walked('six')]);
    const answer = readLetters(bytes, ['one', 'fourx', 'six']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]?.advances).toStrictEqual([500, 500, 500]);
    expect(answer.lines[1]).toBeUndefined();
    expect(answer.lines[2]?.advances).toStrictEqual([500, 500, 500]);
  });

  it('places a line as today where its characters disagree with its text, though its count agrees', () => {
    const answer = readLetters(writeLetters([walked('cat')]), ['cot']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]).toBeUndefined();
  });

  it('carries no advances for a line one of whose letters advances past what 16 bits hold, and main places it as today', () => {
    const far: WalkedLine = { ...walked('ab'), end: { x: 72 + 5 + 400, y: 700 } };
    const answer = readLetters(writeLetters([far]), ['ab']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]).toBeUndefined();
  });

  it('reads letters only for the lines the page kept, as a cut page keeps its first ones', () => {
    const answer = readLetters(writeLetters([walked('kept'), walked('cut')]), ['kept']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines).toHaveLength(1);
    expect(answer.lines[0]?.advances).toHaveLength(4);
  });

  it('keeps each letter within half a hundredth of a point of its place, however long the line', () => {
    const line: WalkedLine = {
      direction: { x: 1, y: 0 },
      size: 11,
      characters: Array.from({ length: 1000 }, (_, at) => ({ c: 'x', x: 72 + at * 5.0049, y: 700 })),
      end: { x: 72 + 1000 * 5.0049, y: 700 },
    };
    const answer = readLetters(writeLetters([line]), ['x'.repeat(1000)]);
    if (!('lines' in answer)) throw new Error('refused');
    const advances = answer.lines[0]?.advances ?? [];
    const last = advances.reduce((sum, advance) => sum + advance, 0) / 100;
    expect(Math.abs(last - 1000 * 5.0049)).toBeLessThanOrEqual(0.005);
  });

  // A CHARACTER PAST U+FFFF IS PAIRED, the binding's cut applied on both sides: the walk hands U+1F600 as its low 16 bits
  // (U+F600), and main cuts the JSON's code point the same way. CONTROL: a text whose character cuts to something else
  // does not pair.
  it('pairs a character past U+FFFF by the same cut on both sides, its second unit advancing 0', () => {
    const cut: WalkedLine = { ...walked('AA'), end: { x: 72 + 15, y: 700 } };
    const answer = readLetters(writeLetters([cut]), ['A\u{1F600}A']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]?.advances).toStrictEqual([500, 500, 0, 500]);
    const control = readLetters(writeLetters([cut]), ['A\u{1F601}A']);
    if (!('lines' in control)) throw new Error('refused');
    expect(control.lines[0]).toBeUndefined();
  });
});
