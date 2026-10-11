import { describe, expect, it } from 'vitest';

import { overlayTransform } from '../annotations/annotationSpace.js';
import { handleAt, marqueeOf, marqueeTakes, movedRect, pixelsOf, rectOfPixels, resized } from './fieldDesign.js';

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
