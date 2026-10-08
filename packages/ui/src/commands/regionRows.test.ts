import { describe, expect, it } from 'vitest';

import { type ReadLine, addedReadLines, fitSize, isTabular, readingText, rowsOf } from './regionRows.js';

const line = (text: string, x0: number, y0: number, x1 = x0 + 50, y1 = y0 + 12): ReadLine => ({ text, box: { x0, y0, x1, y1 } });

describe('the lines a read ADDED', () => {
  it('takes a line out once per occurrence, so a box over words the page already had still shows what is new', () => {
    const a = line('a', 0, 0);
    const b = line('b', 0, 20);
    const c = line('c', 0, 40);
    expect(addedReadLines([a, b], [a, b, c]).map((each) => each.text)).toStrictEqual(['c']);
    expect(addedReadLines([a], [a, line('a', 0, 20), c]).map((each) => each.text)).toStrictEqual(['a', 'c']);
  });

  it('CONTROL: a read that added nothing adds nothing, and a page that had nothing shows everything', () => {
    const a = line('a', 0, 0);
    expect(addedReadLines([a], [a])).toStrictEqual([]);
    expect(addedReadLines([], [a, line('x', 0, 20)]).map((each) => each.text)).toStrictEqual(['a', 'x']);
  });
});

describe('rows in reading order', () => {
  it('groups the lines at one height into a row, left to right, and rows top to bottom', () => {
    // GIVEN OUT OF ORDER, as a recogniser may: the second row first, a row's cells right to left.
    const lines = [line('7', 100, 52), line('John', 0, 50), line('Hours', 100, 2), line('Names', 0, 0)];
    expect(rowsOf(lines).map((row) => row.map((each) => each.text))).toStrictEqual([
      ['Names', 'Hours'],
      ['John', '7'],
    ]);
    expect(readingText(rowsOf(lines))).toBe('Names\tHours\nJohn\t7');
  });

  it('a slightly lower cell (handwriting) still joins its row, and CONTROL: a line half a row away does not', () => {
    expect(rowsOf([line('a', 0, 0), line('b', 100, 4)])).toHaveLength(1);
    expect(rowsOf([line('a', 0, 0), line('b', 100, 11)])).toHaveLength(2);
  });

  it('is a table with two rows of two or more cells, and CONTROL: a paragraph and one split line are not', () => {
    expect(isTabular(rowsOf([line('a', 0, 0), line('b', 100, 0), line('c', 0, 30), line('d', 100, 30)]))).toBe(true);
    expect(isTabular(rowsOf([line('a', 0, 0), line('b', 0, 30), line('c', 0, 60)]))).toBe(false);
    expect(isTabular(rowsOf([line('a', 0, 0), line('b', 100, 0)]))).toBe(false);
  });
});

describe('fitSize', () => {
  it('fits the line’s height, and its width where the words are long', () => {
    expect(fitSize({ x0: 0, y0: 0, x1: 400, y1: 20 }, 'Hours')).toBe(16);
    // 20 characters in 60 points cannot be 16 points tall: the width decides.
    expect(fitSize({ x0: 0, y0: 0, x1: 60, y1: 20 }, 'a very long line of text')).toBeLessThan(8);
  });

  it('never goes below 4 or above 72 points', () => {
    expect(fitSize({ x0: 0, y0: 0, x1: 1, y1: 1 }, 'text')).toBe(4);
    expect(fitSize({ x0: 0, y0: 0, x1: 4000, y1: 400 }, 'x')).toBe(72);
  });
});
