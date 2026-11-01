import { describe, expect, it } from 'vitest';

import { LIST_ENTRY, listEntryOf } from './listEntry.js';

describe('listEntryOf (the owner’s C5): where a list entry’s words begin, by the one marker rule', () => {
  it('answers a bullet, a number, a letter, a dash and a star, each with where its words begin and its inked marker', () => {
    expect(listEntryOf('• Item text')).toStrictEqual({ wordsAt: 2, markerInk: 1 });
    expect(listEntryOf('12. Item text')).toStrictEqual({ wordsAt: 4, markerInk: 3 });
    expect(listEntryOf('(a) Item')).toStrictEqual({ wordsAt: 4, markerInk: 3 });
    expect(listEntryOf('– Item')).toStrictEqual({ wordsAt: 2, markerInk: 1 });
    expect(listEntryOf('* Item')).toStrictEqual({ wordsAt: 2, markerInk: 1 });
  });

  it('counts leading spaces and every space after the marker into where the words begin, and none into the marker', () => {
    expect(listEntryOf('  •   Item')).toStrictEqual({ wordsAt: 6, markerInk: 1 });
    // A BULLET TOUCHING ITS WORD is an entry too, as the grouping has always read it.
    expect(listEntryOf('•Item')).toStrictEqual({ wordsAt: 1, markerInk: 1 });
  });

  it('CONTROL: a line that begins no entry answers none, and so does a marker with nothing after it', () => {
    expect(listEntryOf('Plain words here')).toBeUndefined();
    expect(listEntryOf('1.5 litres of water')).toBeUndefined();
    expect(listEntryOf('•')).toBeUndefined();
    expect(listEntryOf('-  ')).toBeUndefined();
  });

  it('is the rule the grouping ends a paragraph by: the same expression, from the one module', () => {
    expect(LIST_ENTRY.test('2) Next item')).toBe(true);
    expect(LIST_ENTRY.test('Next sentence')).toBe(false);
  });
});
