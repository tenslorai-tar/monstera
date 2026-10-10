import { describe, expect, it } from 'vitest';

import { caretIndexAt } from './fieldCaret.js';

/** Every character ten pixels wide, so a press's place reads straight off the numbers. */
const tens = (prefix: string): number => prefix.length * 10;

describe('caretIndexAt', () => {
  it('puts the caret at the boundary nearest the press, inside the word', () => {
    // CONTROL: the end, which is where a focused box puts its caret and the defect the owner saw.
    expect(caretIndexAt('Lovelace', 80, tens)).toBe(8);
    expect(caretIndexAt('Lovelace', 31, tens)).toBe(3);
    expect(caretIndexAt('Lovelace', 36, tens)).toBe(4);
  });

  it('is the start before the text and the end past it', () => {
    expect(caretIndexAt('Ada', -5, tens)).toBe(0);
    expect(caretIndexAt('Ada', 500, tens)).toBe(3);
    expect(caretIndexAt('', 40, tens)).toBe(0);
  });

  it('measures prefixes, so a face that kerns a pair is counted as drawn', () => {
    // "AV" kerned four pixels tighter than its letters summed: a press at 17 is nearer the end (16) than the middle.
    const kerned = (prefix: string): number => (prefix === 'AV' ? 16 : prefix.length * 10);
    expect(caretIndexAt('AV', 17, kerned)).toBe(2);
  });

  it('never puts a caret inside a surrogate pair', () => {
    const one = '\u{1F600}';
    // Two code units, one character: a press at its middle goes to one side or the other, never to 1.
    expect(caretIndexAt(`${one}a`, 10, tens)).not.toBe(1);
  });
});
