import { describe, expect, it } from 'vitest';

import { facesPages, spreadPages, spreadStart, stepSpread } from './pageSpreads.js';

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
