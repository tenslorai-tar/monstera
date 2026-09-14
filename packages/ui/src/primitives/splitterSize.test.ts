import { describe, expect, it } from 'vitest';

import { pixelsOfRoot } from './splitterSize.js';

/**
 * Asserted OFF-CENTRE and against the library's own rule. A conversion that swapped its arguments,
 * or divided where it should multiply, agrees with itself at 50 % and at 100 %, so every figure
 * below is one where those mistakes give a different number.
 *
 * `inward` is `@zag-js/splitter` 1.43.3's `parsePanelSize` for a pixel value, quoted rather than
 * imported because the package does not export it. The round trip is the property this module
 * exists for: a width the library resolved inward comes back out as the same pixels.
 */
const inward = (pixels: number, rootPixels: number): number => (pixels / rootPixels) * 100;

describe('pixelsOfRoot', () => {
  it('converts a percentage of the root to pixels, off-centre', () => {
    expect(pixelsOfRoot(17.5, 1280)).toBeCloseTo(224, 10);
    expect(pixelsOfRoot(25, 1200)).toBeCloseTo(300, 10);
  });

  it("is the exact inverse of the library's inward resolution, at a root the figures above did not use", () => {
    const root = 977;
    for (const pixels of [1, 192, 224, 480]) {
      expect(pixelsOfRoot(inward(pixels, root), root)).toBeCloseTo(pixels, 9);
    }
  });

  it('refuses an UNMEASURED root rather than answering zero pixels', () => {
    // A root with no layout measures 0. Multiplying gives 0 — a width of nothing, which a caller
    // would store as though the person had chosen it.
    expect(pixelsOfRoot(17.5, 0)).toBeUndefined();
    expect(pixelsOfRoot(17.5, -5)).toBeUndefined();
    expect(pixelsOfRoot(17.5, Number.NaN)).toBeUndefined();
    expect(pixelsOfRoot(Number.NaN, 1280)).toBeUndefined();
  });
});
