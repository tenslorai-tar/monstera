import { describe, expect, it } from 'vitest';

import { boxStyle, cssMatrixOf, place, pushedPastPage } from './editing.js';

describe('pushedPastPage: Q7’s sentence only for a block a person’s write put past the page (Fix 3, 2026-11-17)', () => {
  const CROP = [0, 0, 612, 792] as const;
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

  it('is true of a block inside the page before the write and past it after', () => {
    expect(pushedPastPage(box(72, 100, 300, 200), box(72, -30, 300, 200), CROP)).toBe(true);
  });

  it('of a block already past: true only where an edge moved further out, by more than the tolerance', () => {
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, -60, 300, 200), CROP)).toBe(true);
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, -30, 650, 200), CROP)).toBe(true);
    // CONTROL: kept where it was, a tolerance's width further, or brought in.
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, -30, 300, 200), CROP)).toBe(false);
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, -30.2, 300, 200), CROP)).toBe(false);
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, -10, 300, 200), CROP)).toBe(false);
  });

  it('is false of any block the write leaves on the page', () => {
    expect(pushedPastPage(box(72, -30, 300, 200), box(72, 10, 300, 200), CROP)).toBe(false);
    expect(pushedPastPage(box(72, 100, 300, 200), box(72, 50, 300, 200), CROP)).toBe(false);
  });
});

/** A page 600 by 800 points, upright, at twice its size. */
const PAGE = { crop: [0, 0, 600, 800] as [number, number, number, number], rotation: 0 as const, zoom: 2 };

describe('place, for a block set at an angle (ADR-0273)', () => {
  // A LINE RUNNING UP THE PAGE: its frame's x is the page's y, and its y the page's -x. Its box in the frame is 100..200
  // along the line and -312..-300 across it, so its top-left corner in the frame, (100, -300), is the page's (300, 100).
  const UP = [0, 1, -1, 0] as const;
  const BOX = { x0: 100, y0: -312, x1: 200, y1: -300 };

  it('puts the frame’s top-left corner where the page has it, and carries the box’s axes by the frame', () => {
    const placed = place(BOX, PAGE, UP);
    // (300, 100) on the page is (600, 1400) on the overlay at zoom 2, y down from the crop's top.
    expect(placed.left).toBeCloseTo(600, 6);
    expect(placed.top).toBeCloseTo(1400, 6);
    expect(placed.width).toBe(200);
    expect(placed.height).toBe(24);
    // ALONG THE LINE IS UP THE SCREEN, and down the lines is to the right.
    const [a, b, c, d] = placed.matrix ?? [];
    expect([a, b, c, d].map((value) => Math.round((value ?? Number.NaN) * 1e6) / 1e6)).toStrictEqual([0, -1, 1, 0]);
    expect(boxStyle(placed).transform).toMatch(/^matrix\(/u);
  });

  it('CONTROL: the same box with no frame is placed as before, by its own corner and the page’s turn alone', () => {
    const placed = place(BOX, PAGE);
    expect(placed.matrix).toBeUndefined();
    expect(placed.left).toBe(200);
    expect(placed.top).toBe(2200);
    expect(boxStyle(placed).transform).toBeUndefined();
    expect(cssMatrixOf(placed)).toStrictEqual([1, 0, -0, 1]);
  });
});
