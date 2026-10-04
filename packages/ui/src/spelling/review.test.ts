import { describe, expect, it } from 'vitest';

import type { SpellChecker } from './checker.js';
import {
  type SpellingOccurrence,
  comparePlaces,
  nextOccurrence,
  occurrencesIn,
  pageOccurrences,
  pastOccurrence,
  sortedOccurrences,
  splicedAll,
  splicedAt,
} from './review.js';

/** A checker with a stated vocabulary, so a case need not build one. */
const checker: SpellChecker = {
  correct: (word) => ['document', 'page', 'the', 'on', 'and', 'see'].includes(word.toLowerCase()),
  suggest: (word) => [`${word}!`],
};

const words = (found: readonly SpellingOccurrence[]): string[] => found.map((each) => each.word);

describe('the misspelt words in a page', () => {
  it('lists each occurrence where it is: its line, and its offset in that line', () => {
    expect(pageOccurrences(checker, 3, ['the documnet', 'documnet on teh page'])).toStrictEqual([
      { word: 'documnet', place: { kind: 'text', page: 3, line: 0, offset: 4 }, context: 'the documnet', writable: true },
      { word: 'documnet', place: { kind: 'text', page: 3, line: 1, offset: 0 }, context: 'documnet on teh page', writable: true },
      { word: 'teh', place: { kind: 'text', page: 3, line: 1, offset: 12 }, context: 'documnet on teh page', writable: true },
    ]);
  });

  it('KEEPS EACH OCCURRENCE, where the old list counted a word once: each is shown and changed on its own', () => {
    expect(words(pageOccurrences(checker, 0, ['Documnet and documnet']))).toStrictEqual(['Documnet', 'documnet']);
  });

  it('reads a line as itself, so two lines never fuse into a word nobody wrote', () => {
    // WITHOUT A LINE BOUNDARY `page` and `document` would read as `pagedocument`, a misspelling the reader never wrote.
    expect(pageOccurrences(checker, 0, ['page', 'document'])).toStrictEqual([]);
  });

  it('SKIPS numbers and single letters, which no dictionary can judge', () => {
    // `3rd` is here because ANY digit disqualifies, not all.
    expect(pageOccurrences(checker, 0, ['2026 x 3rd H2O'])).toStrictEqual([]);
  });

  it('places a comment or a field by its handle, and carries whether it may be written', () => {
    const [comment] = occurrencesIn(checker, 'see teh', (offset) => ({ kind: 'comment', page: 1, index: 4, offset }), {
      writable: false,
    });
    expect(comment).toStrictEqual({
      word: 'teh',
      place: { kind: 'comment', page: 1, index: 4, offset: 4 },
      context: 'see teh',
      writable: false,
    });
  });
});

describe('reading order and the review’s place in it', () => {
  const at = (kind: 'text' | 'comment' | 'field', page: number, row: number, offset: number): SpellingOccurrence => ({
    word: 'teh',
    place: kind === 'text' ? { kind, page, line: row, offset } : { kind, page, index: row, offset },
    context: 'teh',
    writable: true,
  });

  it('goes through a page’s text, then its comments, then its fields, before the next page', () => {
    const sorted = sortedOccurrences([at('text', 1, 0, 0), at('field', 0, 0, 0), at('comment', 0, 0, 0), at('text', 0, 2, 5), at('text', 0, 2, 1)]);
    expect(sorted.map((each) => `${each.place.kind}:${String(each.place.page)}:${String(each.place.offset)}`)).toStrictEqual([
      'text:0:1',
      'text:0:5',
      'comment:0:0',
      'field:0:0',
      'text:1:0',
    ]);
  });

  it('goes on PAST the word it was on, so the next word on the same line is the first one after it', () => {
    const first = at('text', 0, 0, 0);
    const second = at('text', 0, 0, 4);
    expect(nextOccurrence([first, second], pastOccurrence(first), new Set())).toBe(second);
    // CONTROL: from the word's own place, the word is still the first at or after it.
    expect(nextOccurrence([first, second], first.place, new Set())).toBe(first);
  });

  it('goes on past a REPLACEMENT by the replacement’s length, not the word’s', () => {
    // `teh` became `the cat`: the next word, read again after the edit, starts after the longer text.
    const first = at('text', 0, 0, 0);
    expect(comparePlaces(pastOccurrence(first, 7), { kind: 'text', page: 0, line: 0, offset: 7 })).toBe(0);
  });

  it('passes over a skipped word whatever its case, as the personal dictionary compares', () => {
    const upper = { ...at('text', 0, 0, 0), word: 'Teh' };
    const other = { ...at('text', 0, 0, 9), word: 'documnet' };
    expect(nextOccurrence([upper, other], undefined, new Set(['teh']))).toBe(other);
  });

  it('answers nothing once the review has gone through', () => {
    const only = at('text', 0, 0, 0);
    expect(nextOccurrence([only], pastOccurrence(only), new Set())).toBeUndefined();
  });
});

describe('splicing a replacement into the text it was read from', () => {
  it('replaces the word at its offset, and only there', () => {
    expect(splicedAt('teh cat and teh dog', 12, 'teh', 'the')).toBe('teh cat and the dog');
  });

  it('REFUSES where the word is not at its offset, which is a text that changed under the review', () => {
    expect(splicedAt('the cat', 0, 'teh', 'the')).toBeUndefined();
  });

  it('replaces every occurrence it was given, from the end, so an earlier offset is not moved', () => {
    expect(splicedAll('teh and teh', [0, 8], 'teh', 'the longer')).toBe('the longer and the longer');
  });

  it('leaves a word the review did not find alone — one inside another word', () => {
    // `tehx` holds `teh`, and the review never listed it, so only the listed offset changes.
    expect(splicedAll('teh tehx', [0], 'teh', 'the')).toBe('the tehx');
  });
});
