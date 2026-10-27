import { describe, expect, it } from 'vitest';

import { LINE_GAP, oneLineReach } from './oneLineReach.js';

const PAGE = { x0: 0, y0: 0, x1: 612, y1: 792 };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe('oneLineReach', () => {
  const heading = box(72, 700, 150, 714);

  it('reaches the right edge of its column: the widest block sharing its span', () => {
    const paragraph = box(72, 600, 540, 680);
    expect(oneLineReach(heading, [paragraph], PAGE)).toBe(540);
  });

  it('stops short of the next block on its line, by the gap', () => {
    const paragraph = box(72, 600, 540, 680);
    const beside = box(300, 702, 400, 712);
    expect(oneLineReach(heading, [paragraph, beside], PAGE)).toBe(300 - LINE_GAP);
  });

  it('where nothing shares its span, reaches the page’s text margin; where nothing at all, the margin mirrored', () => {
    expect(oneLineReach(heading, [box(320, 400, 560, 500)], PAGE)).toBe(560);
    expect(oneLineReach(heading, [], PAGE)).toBe(612 - 72);
  });

  it('is never less than the block’s own right edge', () => {
    const touching = box(150, 702, 200, 712);
    expect(oneLineReach(heading, [touching], PAGE)).toBe(150);
  });
});
