import { describe, expect, it } from 'vitest';

import { cutPoint } from './boundedText.js';
import { MAX_TRANSLATE_TEXT, translationPieces } from './channels.js';
import { MAX_ASK_SELECTION, carriedSelection } from './askAbout.js';

/** The one rule a selection command cuts a person's text by, and its two callers (preserve, never drop). */
describe('where a person’s text is cut at a bound', () => {
  it('keeps text within the bound whole', () => {
    expect(cutPoint('a few words', 20)).toBe(11);
  });

  it('cuts after the last white space in reach, so no word is split', () => {
    // "one two three" at 9 would split *three*; the cut is after the space before it.
    expect(cutPoint('one two three', 9)).toBe(8);
  });

  it('never cuts between the two halves of a pair, where no white space is in reach', () => {
    const text = `${'a'.repeat(9)}\u{1F600}${'b'.repeat(5)}`;
    // THE BOUND FALLS AFTER THE HIGH HALF (index 9): the cut goes one earlier, before the pair.
    expect(cutPoint(text, 10)).toBe(9);
    // CONTROL: a bound that does not split a pair is the bound.
    expect(cutPoint(text, 9)).toBe(9);
  });

  it('a translation’s pieces are every character, in order, each within one ask', () => {
    const text = 'payment due '.repeat(2_000);
    const pieces = translationPieces(text);
    expect(pieces.join('')).toBe(text);
    expect(pieces.every((piece) => piece.length <= MAX_TRANSLATE_TEXT && piece.length > 0)).toBe(true);
    expect(pieces.length).toBe(Math.ceil(text.length / MAX_TRANSLATE_TEXT));
  });

  it('an ask carries a cut selection with its whole length, and a short one whole', () => {
    expect(carriedSelection('w'.repeat(MAX_ASK_SELECTION + 7))).toStrictEqual({ text: 'w'.repeat(MAX_ASK_SELECTION), whole: MAX_ASK_SELECTION + 7 });
    expect(carriedSelection('short')).toStrictEqual({ text: 'short', whole: 5 });
  });
});
