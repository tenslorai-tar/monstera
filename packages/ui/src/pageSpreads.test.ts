import { describe, expect, it } from 'vitest';

import { facesPages, spreadPages, spreadPlace, spreadStart, stepSpread, type ReadingDirection } from './pageSpreads.js';

/** Every pair of a document of `count` pages, in order, as a reader turns through them from the first. */
function pairs(count: number, cover: boolean): number[][] {
  const found: number[][] = [];
  for (let at = 0; ; ) {
    found.push([...spreadPages(at, count, cover)]);
    const next = stepSpread(at, count, cover, 1);
    if (next === at) return found;
    at = next;
  }
}

describe('which pages face each other (ADR-0284)', () => {
  it('pairs 1–2, 3–4 without a cover page, and an odd last page stands alone', () => {
    expect(pairs(5, false)).toStrictEqual([[0, 1], [2, 3], [4]]);
    expect(pairs(4, false)).toStrictEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('with a cover page, page 1 stands alone and pages 2 and 3 face each other; an even last page stands alone', () => {
    expect(pairs(5, true)).toStrictEqual([[0], [1, 2], [3, 4]]);
    expect(pairs(4, true)).toStrictEqual([[0], [1, 2], [3]]);
  });

  it('a page on the right of a pair is in its pair: a search hit, a link or a thumbnail there shows that pair', () => {
    expect(spreadPages(3, 10, false)).toStrictEqual([2, 3]);
    expect(spreadPages(2, 10, true)).toStrictEqual([1, 2]);
    expect(spreadStart(4, true)).toBe(3);
  });

  it('previous steps back a whole pair, and stays at the first', () => {
    expect(stepSpread(3, 10, false, -1)).toBe(0);
    expect(stepSpread(4, 10, true, -1)).toBe(1);
    expect(stepSpread(1, 10, true, -1)).toBe(0);
    expect(stepSpread(0, 10, true, -1)).toBe(0);
  });

  it('CONTROL: only the two facing layouts pair pages', () => {
    expect([facesPages('continuous'), facesPages('single'), facesPages('pair'), facesPages('facing')]).toStrictEqual([false, false, true, true]);
  });
});

/** Each page's place, as `row:column`, for a document of `count` pages. */
function places(count: number, cover: boolean, direction: ReadingDirection): string[] {
  return Array.from({ length: count }, (_, page) => {
    const { row, column } = spreadPlace(page, cover, direction);
    return `${String(row)}:${String(column)}`;
  });
}

describe('which side each page stands on (ADR-0284 Decision 10)', () => {
  it('a RIGHT-TO-LEFT book puts the earlier page of each pair on the right', () => {
    expect(places(5, false, 'R2L')).toStrictEqual(['0:2', '0:1', '1:2', '1:1', '2:2']);
  });

  it('and its cover page stands alone on the LEFT, so pages 2 and 3 face each other with 2 on the right', () => {
    expect(places(5, true, 'R2L')).toStrictEqual(['0:1', '1:2', '1:1', '2:2', '2:1']);
  });

  it('CONTROL: a left-to-right book stands as the grid stood it before: 1–2 left to right, and its cover alone on the right', () => {
    expect(places(5, false, 'L2R')).toStrictEqual(['0:1', '0:2', '1:1', '1:2', '2:1']);
    expect(places(5, true, 'L2R')).toStrictEqual(['0:2', '1:1', '1:2', '2:1', '2:2']);
  });

  it('CONTROL: the PAIRS are the same in both directions; only the sides differ', () => {
    for (const cover of [false, true]) {
      const rows = (direction: ReadingDirection): number[] => Array.from({ length: 7 }, (_, page) => spreadPlace(page, cover, direction).row);
      expect(rows('R2L')).toStrictEqual(rows('L2R'));
    }
  });
});
