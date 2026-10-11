import { describe, expect, it } from 'vitest';

import { type PlacedField, arrange } from './arrange.js';

/**
 * Arranging fields, in the writer's own space where up is a larger y.
 *
 * Each case names the fields it expects to move, so a rule that moved every field, or none, fails. The CONTROL cases ask
 * for an arrangement the selection already has and expect no change at all, which is what stops aligning an aligned form
 * from costing an undo step.
 */
const handle = (index: number): PlacedField['field'] => ({ page: 0, index, name: `f${String(index)}` });

const A: PlacedField = { field: handle(0), rect: { x0: 100, y0: 500, x1: 200, y1: 520 } };
const B: PlacedField = { field: handle(1), rect: { x0: 130, y0: 450, x1: 260, y1: 480 } };
const C: PlacedField = { field: handle(2), rect: { x0: 90, y0: 400, x1: 150, y1: 440 } };

const rects = (moved: readonly PlacedField[]): Record<string, PlacedField['rect']> =>
  Object.fromEntries(moved.map((each) => [each.field.name, each.rect]));

describe('arranging form fields', () => {
  it('aligns left edges to the leftmost, keeping each width, and leaves the field already there', () => {
    expect(rects(arrange('align-left', [A, B, C]))).toStrictEqual({
      f0: { x0: 90, y0: 500, x1: 190, y1: 520 },
      f1: { x0: 90, y0: 450, x1: 220, y1: 480 },
    });
  });

  it('aligns right edges to the rightmost', () => {
    expect(rects(arrange('align-right', [A, B, C]))).toStrictEqual({
      f0: { x0: 160, y0: 500, x1: 260, y1: 520 },
      f2: { x0: 200, y0: 400, x1: 260, y1: 440 },
    });
  });

  it('aligns tops to the highest, which is the LARGEST y, and bottoms to the lowest', () => {
    expect(rects(arrange('align-top', [A, B, C]))).toStrictEqual({
      f1: { x0: 130, y0: 490, x1: 260, y1: 520 },
      f2: { x0: 90, y0: 480, x1: 150, y1: 520 },
    });
    expect(rects(arrange('align-bottom', [A, B, C]))).toStrictEqual({
      f0: { x0: 100, y0: 400, x1: 200, y1: 420 },
      f1: { x0: 130, y0: 400, x1: 260, y1: 430 },
    });
  });

  it('centres on the FIRST field selected', () => {
    expect(rects(arrange('centre-horizontally', [A, B]))).toStrictEqual({ f1: { x0: 85, y0: 450, x1: 215, y1: 480 } });
    expect(rects(arrange('centre-vertically', [B, A]))).toStrictEqual({ f0: { x0: 100, y0: 455, x1: 200, y1: 475 } });
  });

  it('makes fields the width, the height or the size of the first, keeping each top left corner', () => {
    expect(rects(arrange('same-width', [A, B, C]))).toStrictEqual({
      f1: { x0: 130, y0: 450, x1: 230, y1: 480 },
      f2: { x0: 90, y0: 400, x1: 190, y1: 440 },
    });
    expect(rects(arrange('same-height', [A, B, C]))).toStrictEqual({
      f1: { x0: 130, y0: 460, x1: 260, y1: 480 },
      f2: { x0: 90, y0: 420, x1: 150, y1: 440 },
    });
    expect(rects(arrange('same-size', [A, B]))).toStrictEqual({ f1: { x0: 130, y0: 460, x1: 230, y1: 480 } });
  });

  it('CONTROL: an arrangement the selection already has changes nothing, so it is no command', () => {
    const left = arrange('align-left', [A, B, C]);
    const settled = [A, B, C].map((each) => left.find((moved) => moved.field.index === each.field.index) ?? each);
    expect(arrange('align-left', settled)).toStrictEqual([]);
    expect(arrange('same-size', [A, { ...B, rect: { x0: 130, y0: 500, x1: 230, y1: 520 } }])).toStrictEqual([]);
  });

  it('CONTROL: one field, or none, is nothing to line up', () => {
    expect(arrange('align-left', [A])).toStrictEqual([]);
    expect(arrange('align-left', [])).toStrictEqual([]);
  });

  it('reads a rectangle given with its corners the other way round', () => {
    const turned: PlacedField = { field: handle(3), rect: { x0: 260, y0: 480, x1: 130, y1: 450 } };
    expect(rects(arrange('same-width', [A, turned]))).toStrictEqual({ f3: { x0: 130, y0: 450, x1: 230, y1: 480 } });
  });
});

describe('spreading form fields evenly', () => {
  // THREE IN A ROW, 20 wide each, from 0 to 200: the middle one at 30 is moved to 90, so both gaps are 70.
  const row = [0, 30, 180].map((x, at): PlacedField => ({ field: handle(at), rect: { x0: x, y0: 100, x1: x + 20, y1: 120 } }));

  it('across: the outermost stay, the middle one moves so every gap is the same', () => {
    expect(rects(arrange('distribute-horizontally', row))).toStrictEqual({ f1: { x0: 90, y0: 100, x1: 110, y1: 120 } });
  });

  it('down: from the top, the LARGEST y, the middle one moves', () => {
    const column = [500, 470, 300].map((y, at): PlacedField => ({ field: handle(at), rect: { x0: 0, y0: y - 20, x1: 20, y1: y } }));
    // From the top at 500 to the last one's foot at 280, three 20 tall: the gaps are 80, so the middle one's top is at 400.
    expect(rects(arrange('distribute-vertically', column))).toStrictEqual({ f1: { x0: 0, y0: 380, x1: 20, y1: 400 } });
  });

  it('CONTROL: two fields have nothing between them, and an even row is no command', () => {
    expect(arrange('distribute-horizontally', row.slice(0, 2))).toStrictEqual([]);
    const even = [0, 90, 180].map((x, at): PlacedField => ({ field: handle(at), rect: { x0: x, y0: 100, x1: x + 20, y1: 120 } }));
    expect(arrange('distribute-horizontally', even)).toStrictEqual([]);
  });
});
