import { describe, expect, it } from 'vitest';

import { dragged, MIN_MEASURE, NOT_PLACED, nudged, placeOf, placeTransform, type BlockBox, type Placement } from './textPlacement.js';

/** A block 200 wide and 40 tall, its top left at (100, 500). */
const BOX: BlockBox = { x0: 100, y0: 460, x1: 300, y1: 500 };

/** Where a point of the block (from its top left, y up) lands under a placement, as the writer applies one. */
function landed(placement: Placement, from: { x: number; y: number }): { x: number; y: number } {
  const scaled = { x: from.x * placement.scale, y: from.y * placement.scale };
  const width = (placement.width ?? 200) * placement.scale;
  const height = 40 * placement.scale;
  const centre = { x: width / 2, y: -height / 2 };
  const radians = (placement.rotate * Math.PI) / 180;
  const at = { x: scaled.x - centre.x, y: scaled.y - centre.y };
  const turned = {
    x: at.x * Math.cos(radians) - at.y * Math.sin(radians) + centre.x,
    y: at.x * Math.sin(radians) + at.y * Math.cos(radians) + centre.y,
  };
  return { x: turned.x + placement.move.x, y: turned.y + placement.move.y };
}

describe('dragged', () => {
  it('the east side sets a wider measure and moves nothing', () => {
    const next = dragged('e', NOT_PLACED, { x: 40, y: 7 }, BOX, 1);
    expect(next.width).toBe(240);
    expect(next.move).toStrictEqual({ x: 0, y: 0 });
    expect(next.scale).toBe(1);
  });

  it('the west side keeps the RIGHT edge where it was: the measure shrinks and the left edge moves in by as much', () => {
    const next = dragged('w', NOT_PLACED, { x: 30, y: 0 }, BOX, 1);
    expect(next.width).toBe(170);
    expect(next.move.x).toBe(30);
    // CONTROL: the right edge is the left edge plus the measure, before and after.
    expect(BOX.x0 + 200).toBe(300);
    expect(BOX.x0 + next.move.x + (next.width ?? 0)).toBe(300);
  });

  it('never narrows a block below a column that holds a letter', () => {
    expect(dragged('e', NOT_PLACED, { x: -500, y: 0 }, BOX, 1).width).toBe(MIN_MEASURE);
  });

  it('a corner scales about the corner OPPOSITE it, which stays where it is', () => {
    // THE FOUR, each against the corner that must not move (from the block's top left, y up).
    const fixed = {
      se: { x: 0, y: 0 },
      sw: { x: 200, y: 0 },
      ne: { x: 0, y: -40 },
      nw: { x: 200, y: -40 },
    } as const;
    for (const handle of ['se', 'sw', 'ne', 'nw'] as const) {
      const next = dragged(handle, NOT_PLACED, { x: handle === 'se' || handle === 'ne' ? 100 : -100, y: 0 }, BOX, 1);
      expect(next.scale).toBeCloseTo(1.5, 6);
      const where = landed(next, fixed[handle]);
      expect(where.x).toBeCloseTo(fixed[handle].x, 6);
      expect(where.y).toBeCloseTo(fixed[handle].y, 6);
    }
  });

  it('CONTROL: the corner dragged is the one that MOVES, so the case above separates a scale about the wrong corner', () => {
    const next = dragged('se', NOT_PLACED, { x: 100, y: 0 }, BOX, 1);
    const moved = landed(next, { x: 200, y: -40 });
    expect(moved.x).toBeCloseTo(300, 6);
    expect(moved.y).toBeCloseTo(-60, 6);
  });

  it('clamps a scale inside the bounds the contract holds', () => {
    expect(dragged('se', NOT_PLACED, { x: 100000, y: 0 }, BOX, 1).scale).toBe(10);
    expect(dragged('se', NOT_PLACED, { x: -100000, y: 0 }, BOX, 1).scale).toBe(0.1);
  });

  it('the top grip moves the block by the drag, from where it already was', () => {
    const first = dragged('n', NOT_PLACED, { x: 10, y: -5 }, BOX, 1);
    expect(first.move).toStrictEqual({ x: 10, y: -5 });
    expect(dragged('n', first, { x: 3, y: 4 }, BOX, 1).move).toStrictEqual({ x: 13, y: -1 });
  });

  it('the turn handle gives the angle the pointer is at about the centre, and snaps a hair off level to level', () => {
    // THE HANDLE STARTS 20 points right of the right edge, level with the middle: 120 from the centre.
    const up = dragged('r', NOT_PLACED, { x: -120, y: 120 }, BOX, 1);
    expect(up.rotate).toBeCloseTo(90, 6);
    expect(dragged('r', NOT_PLACED, { x: 0, y: 1 }, BOX, 1).rotate).toBe(0);
    // CONTROL: a drag to the left of the centre is a half turn, not nothing.
    expect(Math.abs(dragged('r', NOT_PLACED, { x: -240, y: 0.0001 }, BOX, 1).rotate)).toBeCloseTo(180, 3);
  });
});

describe('nudged', () => {
  it('a key reaches the placement the same drag does', () => {
    expect(nudged({ kind: 'move', x: 1, y: -10 }, NOT_PLACED, BOX, 1)).toStrictEqual(dragged('n', NOT_PLACED, { x: 1, y: -10 }, BOX, 1));
    expect(nudged({ kind: 'width', by: 10 }, NOT_PLACED, BOX, 1).width).toBe(210);
    expect(nudged({ kind: 'scale', by: 0.05 }, NOT_PLACED, BOX, 1).scale).toBeCloseTo(1.05, 9);
    expect(nudged({ kind: 'turn', degrees: 5 }, NOT_PLACED, BOX, 1).rotate).toBe(5);
  });

  it('keeps going from where the last one left the block, rather than from the start', () => {
    const once = nudged({ kind: 'turn', degrees: 5 }, NOT_PLACED, BOX, 1);
    expect(nudged({ kind: 'turn', degrees: 5 }, once, BOX, 1).rotate).toBe(10);
    const wider = nudged({ kind: 'width', by: 10 }, NOT_PLACED, BOX, 1);
    expect(nudged({ kind: 'width', by: 10 }, wider, BOX, 1).width).toBe(220);
  });
});

describe('placeOf', () => {
  it('is nothing for a block nobody placed, so it is written exactly as it was', () => {
    expect(placeOf(NOT_PLACED, BOX)).toBeUndefined();
    // A MEASURE WITHIN HALF A POINT of the block's own is not a new one.
    expect(placeOf({ ...NOT_PLACED, width: 200.3 }, BOX)).toBeUndefined();
  });

  it('names only what was done', () => {
    expect(placeOf({ ...NOT_PLACED, move: { x: 5, y: 0 } }, BOX)).toStrictEqual({ move: { x: 5, y: 0 } });
    expect(placeOf({ ...NOT_PLACED, width: 150 }, BOX)).toStrictEqual({ width: 150 });
    expect(placeOf({ move: { x: 1, y: 2 }, scale: 2, rotate: 30, width: 180 }, BOX)).toStrictEqual({
      move: { x: 1, y: 2 },
      scale: 2,
      rotate: 30,
      width: 180,
    });
  });
});

describe('placeTransform', () => {
  it('shows a move as a translation with the screen’s y running down', () => {
    expect(placeTransform({ ...NOT_PLACED, move: { x: 10, y: 20 } }, { width: 200, height: 40 }, 2)).toBe(
      'translate(20px, -40px) translate(100px, 20px) rotate(0deg) translate(-100px, -20px) scale(1)',
    );
  });

  it('turns counter-clockwise as the page does, which is a negative CSS angle', () => {
    expect(placeTransform({ ...NOT_PLACED, rotate: 90 }, { width: 200, height: 40 }, 1)).toContain('rotate(-90deg)');
  });
});
