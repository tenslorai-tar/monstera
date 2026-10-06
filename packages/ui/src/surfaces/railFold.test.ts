import { describe, expect, it } from 'vitest';

import { railCapacity, railFolded } from './railFold.js';

const sorted = (set: ReadonlySet<number>): number[] => [...set].sort((a, b) => a - b);

describe('railCapacity', () => {
  it('counts buttons and the gaps between them, not after the last', () => {
    // Ten of 38 with gaps of 2 need 398; 398 holds ten and 397 holds nine.
    expect(railCapacity(398, 38, 2)).toBe(10);
    expect(railCapacity(397, 38, 2)).toBe(9);
  });

  it('holds everything before a ruler has been measured', () => {
    expect(railCapacity(100, 0, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('railFolded (ADR-0147)', () => {
  it('folds nothing while every entry fits', () => {
    expect(sorted(railFolded(10, 0, 10))).toStrictEqual([]);
  });

  it('folds from the END and keeps one place for More', () => {
    // Seven places: six entries and More.
    expect(sorted(railFolded(10, 0, 7))).toStrictEqual([6, 7, 8, 9]);
  });

  it('never folds the ACTIVE section: the entry before it goes instead', () => {
    expect(sorted(railFolded(10, 8, 7))).toStrictEqual([5, 6, 7, 9]);
  });

  it('CONTROL: without the active rule the same column would fold the active section', () => {
    expect(railFolded(10, undefined, 7).has(8)).toBe(true);
    expect(railFolded(10, 8, 7).has(8)).toBe(false);
  });

  it('keeps the active section drawn beside More however short the column', () => {
    expect(sorted(railFolded(10, 3, 1))).toStrictEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  });
});
