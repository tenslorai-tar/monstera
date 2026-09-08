import { describe, expect, it } from 'vitest';

import { countWords } from './wordCount.js';

describe('countWords', () => {
  it('counts words on an ordinary line', () => {
    expect(countWords(['one two three']).words).toBe(3);
  });

  it('counts a wrapped sentence as the words it has, not one fewer', () => {
    // A structured-text line is a run on a baseline, so a wrapped sentence is
    // two of them. Concatenating without a separator fuses "quick" and "brown"
    // into one word that appears in no document — and the count is then wrong
    // by one per line, in the direction nobody checks.
    expect(countWords(['the quick', 'brown fox']).words).toBe(4);
  });

  it('does NOT count punctuation or whitespace as words', () => {
    // A whitespace split reports 5 here, counting the em dash as a word.
    expect(countWords(['one, two — three!']).words).toBe(3);
  });

  it('counts CJK text, which a whitespace split reports as one word', () => {
    // THE CASE THE PLATFORM'S SEGMENTER EXISTS FOR, and the reason this module
    // does not split on spaces. Chinese is written without them, so the naive
    // rule answers 1 for any amount of it — reporting a document as nearly
    // empty rather than as wrong, which is the reassuring direction.
    expect(countWords(['今天天气很好']).words).toBeGreaterThan(1);
  });

  it('CONTROL: the same line under a whitespace split would be one word', () => {
    // The control that gives the case above its meaning: without it, "greater
    // than 1" is a fact about a string with no spaces that could hold anything.
    expect('今天天气很好'.split(/\s+/u).filter((part) => part !== '').length).toBe(1);
  });

  it('counts characters as CODE POINTS, so a surrogate pair is one character', () => {
    // `'𝐀'.length` is 2. A person counting characters means the things they can
    // see, and the figure a document reports must not depend on an encoding.
    expect(countWords(['𝐀𝐁']).characters).toBe(2);
  });

  it('separates characters with and without spaces', () => {
    expect(countWords(['ab cd'])).toStrictEqual({
      words: 2,
      characters: 5,
      charactersNoSpaces: 4,
    });
  });

  it('counts the line separator it inserts, so the two figures stay consistent', () => {
    // Two lines of two characters plus the joining space: five and four. A
    // module that counted the words across lines but the characters within them
    // would report figures that cannot both describe one page.
    expect(countWords(['ab', 'cd'])).toStrictEqual({
      words: 2,
      characters: 5,
      charactersNoSpaces: 4,
    });
  });

  it('reads no lines as zero rather than throwing', () => {
    expect(countWords([])).toStrictEqual({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
    });
  });
});
