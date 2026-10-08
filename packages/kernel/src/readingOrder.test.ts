import { describe, expect, it } from 'vitest';

import { logicalWordOrder, readingOrder, rightToLeftCount } from './readingOrder.js';

/**
 * The order right-to-left text is read in, from where its characters sit
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 * What PDFium answers for such text is measured against the real library in `scripts/proofs/rtlDeck.proof.mjs`; these cases
 * hand the function every shape that measurement found, so a change to it fails here before it fails there.
 */

const SHALOM = 'שלום';
const OLAM = 'עולם';

/**
 * `שלום עולם` as it sits on a page: the first word at the right, each letter 10 points to the left of the one before it.
 * The letters' lefts in READING order.
 */
const LEFTS: Record<string, number> = {};
Array.from(SHALOM).forEach((_, at) => {
  LEFTS[`${SHALOM}${String(at)}`] = 70 - at * 10;
});
Array.from(OLAM).forEach((_, at) => {
  LEFTS[`${OLAM}${String(at)}`] = 20 - at * 10;
});

/** A word's letters in the opposite order: how a producer lays them across the page. */
function reverseOf(word: string): string {
  return Array.from(word).reverse().join('');
}

/** The lefts of a word's letters, listed in the order `letters` names them, each a letter of `word`. */
function leftsOf(word: string, order: readonly number[]): number[] {
  return order.map((at) => LEFTS[`${word}${String(at)}`] ?? 0);
}

describe('the reading order of right-to-left text', () => {
  it('reads one sentence the same from every order PDFium answered it in', () => {
    // (A) words as they sit, each word's letters in reading order: what a single text object of glyphs came back as.
    const wordsAsSit = `${OLAM} ${SHALOM}`;
    const lefts = [...leftsOf(OLAM, [0, 1, 2, 3]), ...leftsOf(SHALOM, [0, 1, 2, 3])];
    expect(readingOrder(wordsAsSit, lefts)).toBe(`${SHALOM} ${OLAM}`);

    // (B) everything as it sits, letters too: what MuPDF's own text boxes came back as.
    const sitting = `${reverseOf(OLAM)} ${reverseOf(SHALOM)}`;
    const sittingLefts = [...leftsOf(OLAM, [3, 2, 1, 0]), ...leftsOf(SHALOM, [3, 2, 1, 0])];
    expect(readingOrder(sitting, sittingLefts)).toBe(`${SHALOM} ${OLAM}`);

    // (C) everything in reading order already: a producer that draws in reading order, placed right to left.
    const reading = `${SHALOM} ${OLAM}`;
    const readingLefts = [...leftsOf(SHALOM, [0, 1, 2, 3]), ...leftsOf(OLAM, [0, 1, 2, 3])];
    expect(readingOrder(reading, readingLefts)).toBe(`${SHALOM} ${OLAM}`);
  });

  it('CONTROL: the three answers differ, so each is a different input to the one function', () => {
    expect(new Set([`${OLAM} ${SHALOM}`, `${reverseOf(OLAM)} ${reverseOf(SHALOM)}`, `${SHALOM} ${OLAM}`]).size).toBe(3);
  });

  it('keeps a phrase that reads left to right in its own order, as one unit', () => {
    // `שלום see figure 3 עולם` sits as: עולם at the left, then `see figure 3`, then שלום at the right.
    // OLAM's letters first, then s e e, f i g u r e, 3, then SHALOM's letters in reading order (right to left).
    const answered = `${OLAM} see figure 3 ${SHALOM}`;
    const placed = [...leftsOf(OLAM, [0, 1, 2, 3]), 100, 106, 112, 130, 136, 142, 148, 154, 160, 180, 270, 260, 250, 240];
    expect(readingOrder(answered, placed)).toBe(`${SHALOM} see figure 3 ${OLAM}`);
  });

  it('leaves text with no right-to-left character exactly as answered, and text whose places do not account for it', () => {
    expect(readingOrder('one two three', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('one two three');
    // CONTROL: a count that does not match is not guessed at.
    expect(readingOrder(`${OLAM} ${SHALOM}`, [1, 2, 3])).toBe(`${OLAM} ${SHALOM}`);
  });

  it('counts the right-to-left characters of every script that runs that way, and no other', () => {
    expect(rightToLeftCount(`${SHALOM} abc`)).toBe(4);
    expect(rightToLeftCount(String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627))).toBe(5);
    expect(rightToLeftCount('plain 123')).toBe(0);
  });

  it('orders units of one direction apart from units of the other, whatever the unit is', () => {
    const units = [{ text: OLAM }, { text: 'see' }, { text: 'figure' }, { text: SHALOM }];
    expect(logicalWordOrder(units).map((unit) => unit.text)).toStrictEqual([SHALOM, 'see', 'figure', OLAM]);
  });
});
