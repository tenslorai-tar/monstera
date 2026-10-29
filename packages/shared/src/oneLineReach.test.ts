import { describe, expect, it } from 'vitest';

import { LINE_GAP, oneLineReach, pageAlongFrame } from './oneLineReach.js';

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

describe('pageAlongFrame (ADR-0273): the page along a turned block’s own line', () => {
  it('is the page’s height for a line turned a quarter, so a turned heading reaches the margin mirrored along it', () => {
    // A QUARTER TURN: the frame's x runs up the page, so a frame point (x, y) is the page's (-y, x).
    const quarter = [0, 1, -1, 0] as const;
    const turned = box(100, -310, 200, -300);
    const along = pageAlongFrame(PAGE, quarter, turned);
    expect([along.x0, along.x1]).toStrictEqual([0, 792]);
    expect(oneLineReach(turned, [], along)).toBe(792 - 100);
  });

  it('is the chord the line cuts across the page at an eighth of a turn', () => {
    const eighth = [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2] as const;
    const along = pageAlongFrame(box(0, 0, 100, 100), eighth, box(10, -1, 20, 1));
    expect(along.x0).toBeCloseTo(0, 6);
    expect(along.x1).toBeCloseTo(100 * Math.SQRT2, 6);
  });

  it('CONTROL: where the line misses the page, is the block’s own span, so its reach is its own right edge', () => {
    const quarter = [0, 1, -1, 0] as const;
    const off = box(100, 10, 200, 20);
    expect(pageAlongFrame(PAGE, quarter, off)).toStrictEqual(off);
    expect(oneLineReach(off, [], pageAlongFrame(PAGE, quarter, off))).toBe(200);
  });
});
