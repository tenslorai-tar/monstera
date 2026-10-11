import { describe, expect, it } from 'vitest';

import { overlayTransform } from '../annotations/annotationSpace.js';
import {
  around,
  handleAt,
  marqueeOf,
  marqueeTakes,
  movedRect,
  pixelsOf,
  rectOfPixels,
  resized,
  snappedHandle,
  snappedMove,
} from './fieldDesign.js';

/** A page whose crop starts away from zero, at zoom 2, so a pixel pass-through answers a different number. */
const UPRIGHT = overlayTransform({ crop: [50, 100, 250, 400], rotation: 0, zoom: 2 });
/** The same page turned a quarter: a pixel to the right is a point UP the page. */
const TURNED = overlayTransform({ crop: [50, 100, 250, 400], rotation: 90, zoom: 2 });

describe('fieldDesign — where a field is drawn and where a gesture puts it', () => {
  it('a field’s rect lands on the drawn page through the transform, and comes back unchanged', () => {
    const rect = { x0: 60, y0: 370, x1: 240, y1: 390 };
    const box = pixelsOf(rect, UPRIGHT);
    expect(box).toStrictEqual({ x0: 20, y0: 20, x1: 380, y1: 60 });
    expect(rectOfPixels(box, UPRIGHT)).toStrictEqual(rect);
  });

  it('a move is the pointer’s travel in PDF points: right and down on an upright page, right and UP on a turned one', () => {
    const rect = { x0: 60, y0: 370, x1: 240, y1: 390 };
    // 20 pixels right and 10 down at zoom 2 is 10 points right and 5 points down.
    expect(movedRect(rect, [0, 0], [20, 10], UPRIGHT)).toStrictEqual({ x0: 70, y0: 365, x1: 250, y1: 385 });
    // CONTROL: the same travel on a turned page is not the same move, so the transform decides it.
    expect(movedRect(rect, [0, 0], [20, 10], TURNED)).not.toStrictEqual({ x0: 70, y0: 365, x1: 250, y1: 385 });
  });

  it('a corner handle moves its two edges, an edge handle one, and the box never turns inside out', () => {
    const box = { x0: 10, y0: 10, x1: 110, y1: 50 };
    expect(handleAt(box, 'se')).toStrictEqual([110, 50]);
    expect(handleAt(box, 'n')).toStrictEqual([60, 10]);
    expect(resized(box, 'se', [150, 80], 8)).toStrictEqual({ x0: 10, y0: 10, x1: 150, y1: 80 });
    expect(resized(box, 'w', [0, 999], 8)).toStrictEqual({ x0: 0, y0: 10, x1: 110, y1: 50 });
    // PAST THE OPPOSITE EDGE stops `least` short of it.
    expect(resized(box, 'e', [-50, 30], 8)).toStrictEqual({ x0: 10, y0: 10, x1: 18, y1: 50 });
  });

  it('a marquee takes every box it overlaps at all, and none it misses', () => {
    const boxes = [
      { index: 0, box: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { index: 1, box: { x0: 20, y0: 0, x1: 30, y1: 10 } },
      { index: 2, box: { x0: 100, y0: 100, x1: 110, y1: 110 } },
    ];
    expect(marqueeTakes(marqueeOf([25, 5], [5, 15]), boxes)).toStrictEqual([0, 1]);
    // CONTROL: a marquee in empty paper takes nothing, so the overlap is what decides.
    expect(marqueeTakes(marqueeOf([40, 40], [90, 90]), boxes)).toStrictEqual([]);
  });
});

describe('snapping to the other fields (the owner’s B2)', () => {
  const other = { x0: 100, y0: 200, x1: 200, y1: 220 };
  const moving = { x0: 10, y0: 10, x1: 60, y1: 30 };

  it('a move that brings a left edge within reach of another field’s left lands on it, with a guide there', () => {
    // 10 + 87 = 97: three short of the other field's left at 100.
    const snap = snappedMove(moving, [other], [87, 300]);
    expect(snap.travel).toStrictEqual([90, 300]);
    expect(snap.guides).toStrictEqual([{ axis: 'x', at: 100 }]);
  });

  it('snaps the two axes on their own, and a centre to a centre', () => {
    // A TALLER BOX, so its top and bottom are nowhere near the other's and only the middles can meet: its middle (y 30)
    // is brought to 209, one short of the other's middle at 210.
    const snap = snappedMove({ x0: 10, y0: 10, x1: 60, y1: 50 }, [other], [300, 179]);
    expect(snap.travel).toStrictEqual([300, 180]);
    expect(snap.guides).toStrictEqual([{ axis: 'y', at: 210 }]);
  });

  it('CONTROL: outside the reach nothing moves and nothing is drawn', () => {
    expect(snappedMove(moving, [other], [80, 300])).toStrictEqual({ travel: [80, 300], guides: [] });
    expect(snappedMove(moving, [], [87, 300])).toStrictEqual({ travel: [87, 300], guides: [] });
  });

  it('a side handle snaps only on the axis it moves, and a corner on both', () => {
    expect(snappedHandle([198, 213], 'e', [other])).toStrictEqual({ point: [200, 213], guides: [{ axis: 'x', at: 200 }] });
    expect(snappedHandle([198, 219], 'se', [other])).toStrictEqual({
      point: [200, 220],
      guides: [
        { axis: 'x', at: 200 },
        { axis: 'y', at: 220 },
      ],
    });
  });

  it('the box around a selection is what a move of several lines up', () => {
    expect(around([moving, other])).toStrictEqual({ x0: 10, y0: 10, x1: 200, y1: 220 });
    expect(around([])).toBeUndefined();
  });
});
