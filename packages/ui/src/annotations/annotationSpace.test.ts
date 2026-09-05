import { pageTransform, pdfPoint, toViewport, viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { draggedRect, overlayTransform } from './annotationSpace.js';
import type { OverlayPage } from './annotationSpace.js';

/**
 * The renderer's half of the annotation coordinate boundary.
 *
 * ## Why the fixtures are all awkward
 *
 * On an upright page whose box starts at the origin, at zoom 1, three of the
 * four things this conversion does are invisible: the translation is zero, the
 * rotation is the identity and the scale is one. Only the y-flip shows, and a
 * great many wrong implementations get that right. So every case below carries a
 * non-zero crop origin, a zoom that is not 1, or a rotation — and the
 * round-trip case carries all three at once.
 *
 * ## The round trip is the load-bearing assertion
 *
 * A case that hand-computes the expected PDF coordinates is a case where the
 * same arithmetic has been written twice, and an error in the reasoning appears
 * in both. Sending a point out through `toViewport` and back through this
 * module cannot be satisfied that way: the two functions are inverses or they
 * are not, and `toViewport` is what the KERNEL uses to reach MuPDF's frame.
 *
 * That is what makes the round trip the statement of the correspondence rather
 * than a convenience — the renderer converts one way, the kernel the other, and
 * this is where the two are required to meet.
 */

const CROPPED: OverlayPage = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 1.5,
};

describe('overlayTransform', () => {
  it('takes the box, the rotation and the zoom the page was drawn with', () => {
    const transform = overlayTransform(CROPPED);
    expect(transform.crop).toStrictEqual({ x0: 50, y0: 100, x1: 250, y1: 400 });
    expect(transform.rotation).toBe(0);
    expect(transform.scale).toBe(1.5);
    // 200 by 300 PDF units at 1.5 CSS pixels each.
    expect(transform.viewport).toStrictEqual({ width: 300, height: 450 });
  });

  it('swaps the viewport axes on a quarter turn, which is what the overlay is laid out over', () => {
    const transform = overlayTransform({ ...CROPPED, rotation: 90 });
    expect(transform.viewport).toStrictEqual({ width: 450, height: 300 });
  });

  it('leaves the device pixel ratio at 1, because the overlay is laid out in CSS pixels', () => {
    // The bitmap under the overlay is drawn at `devicePixelRatio × zoom`; the
    // overlay receives pointer events in CSS pixels. Folding the ratio in here
    // would double every coordinate on a 2x display — and would be invisible on
    // the machine most of this is written on.
    expect(overlayTransform(CROPPED).pixelRatio).toBe(1);
  });
});

describe('draggedRect', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`round-trips a drag through the kernel's own conversion — rotated ${String(rotation)}`, () => {
      // THE CORRESPONDENCE, asserted in the direction that cannot be satisfied
      // by writing the same mistake twice. `toViewport` is what
      // `pageAnnotations.ts` uses to reach MuPDF's frame; this sends two known
      // PDF points into overlay coordinates with it, drags between them, and
      // requires the command's rectangle to name the points it started from.
      const page: OverlayPage = { ...CROPPED, rotation };
      const transform = overlayTransform(page);
      const a = pdfPoint(80, 150);
      const b = pdfPoint(200, 320);

      const rect = draggedRect(toViewport(a, transform), toViewport(b, transform), transform);

      expect(rect.x0).toBeCloseTo(80, 9);
      expect(rect.y0).toBeCloseTo(150, 9);
      expect(rect.x1).toBeCloseTo(200, 9);
      expect(rect.y1).toBeCloseTo(320, 9);
    });
  }

  it('keeps the drag\'s direction rather than ordering the corners', () => {
    // Ordering happens in the kernel, against the document's own boxes.
    // Ordering here as well would be two places deciding what a degenerate
    // rectangle is — and the case that catches that is this one, because an
    // implementation that ordered would answer the same rectangle for both
    // diagonals and nothing downstream would ever see the difference.
    const transform = overlayTransform({ crop: [0, 0, 200, 300], rotation: 0, zoom: 1 });
    const rect = draggedRect(viewportPoint(150, 200), viewportPoint(50, 100), transform);

    expect(rect.x0).toBe(150);
    expect(rect.x1).toBe(50);
    // y runs the other way: viewport 200 is nearer the bottom of the page.
    expect(rect.y0).toBe(100);
    expect(rect.y1).toBe(200);
  });

  it('translates by the crop origin, which a page starting at 0,0 cannot show', () => {
    const transform = overlayTransform({ crop: [50, 100, 250, 400], rotation: 0, zoom: 1 });
    const rect = draggedRect(viewportPoint(0, 0), viewportPoint(10, 10), transform);

    // The overlay's top-left is the crop box's top-left: x0 and y1.
    expect(rect.x0).toBe(50);
    expect(rect.y0).toBe(400);
    expect(rect.x1).toBe(60);
    expect(rect.y1).toBe(390);
  });

  it('divides by the zoom, so the same drag at 2x names half the document', () => {
    // A conversion that ignored the scale would place a rectangle twice the
    // size the reader drew, on every page that is not at 100%.
    const one = overlayTransform({ crop: [0, 0, 200, 300], rotation: 0, zoom: 1 });
    const two = overlayTransform({ crop: [0, 0, 200, 300], rotation: 0, zoom: 2 });
    const drag = [viewportPoint(20, 20), viewportPoint(60, 60)] as const;

    const atOne = draggedRect(drag[0], drag[1], one);
    const atTwo = draggedRect(drag[0], drag[1], two);

    expect(atTwo.x1 - atTwo.x0).toBeCloseTo((atOne.x1 - atOne.x0) / 2, 9);
  });
});

describe('the transform this module builds is the one the kernel builds', () => {
  it('agrees with pageTransform given the same box, rotation and scale', () => {
    // A control for the module rather than for a case: `overlayTransform`'s
    // only job is to unpack four numbers into a `Box` in the right order, and
    // a transposed unpacking — `[x0, x1, y0, y1]` — produces a transform that
    // is plausible on a square page and wrong on every other.
    const built = overlayTransform({ crop: [50, 100, 250, 400], rotation: 90, zoom: 2 });
    const expected = pageTransform({ x0: 50, y0: 100, x1: 250, y1: 400 }, 90, 2);
    expect(built).toStrictEqual(expected);
  });
});
