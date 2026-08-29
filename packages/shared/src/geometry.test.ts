import { describe, expect, it } from 'vitest';

import {
  type Box,
  fromFitz,
  fromRaster,
  fromXObject,
  normaliseRotation,
  pageTransform,
  pdfPoint,
  rasterPoint,
  toFitz,
  toPdf,
  toRaster,
  toViewport,
  viewportPoint,
  xObjectPoint,
} from './geometry.js';

/**
 * THE HARD SHAPE, and every case here uses it (checklist item 2).
 *
 * A CropBox at the origin and a rotation of 0 is what a bare `height - y` gets
 * right, so a fixture with either would let the banned inline flip pass every
 * case on this page. This box starts at **(20, 30)** and is 400 × 500, so an
 * origin the conversion forgot shows up as a 20- or 30-unit offset rather than
 * as nothing.
 */
const CROP: Box = { x0: 20, y0: 30, x1: 420, y1: 530 };

/** The same region with its corners stored the other way round, as files do. */
const CROP_REVERSED: Box = { x0: 420, y0: 530, x1: 20, y1: 30 };

const roughly = (value: number): number => Math.round(value * 1e6) / 1e6;

describe('normaliseRotation', () => {
  it('accepts the four quarter turns and the out-of-range multiples real files carry', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-450)).toBe(270);
    expect(normaliseRotation(720)).toBe(0);
  });

  it('treats a malformed rotation as upright rather than refusing the page', () => {
    // A viewer that would not render a page because its /Rotate is 45 is worse
    // than one that renders it upright, and this is the single place that
    // choice is made.
    expect(normaliseRotation(45)).toBe(0);
    expect(normaliseRotation(Number.NaN)).toBe(0);
  });
});

describe('pageTransform', () => {
  it('normalises a box whose corners are stored diagonally the other way', () => {
    // The specification allows either diagonal, so a transform that trusted the
    // order would produce negative dimensions on a legal file.
    expect(pageTransform(CROP_REVERSED, 0, 1).crop).toStrictEqual(CROP);
  });

  it('swaps the viewport axes on a quarter turn, and does not on a half', () => {
    // The assertion is the PAIR. A page size read straight from the CropBox is
    // correct at 0 and 180 and wrong at 90 and 270, so asserting only the
    // rotated case cannot tell a correct swap from an unconditional one.
    expect(pageTransform(CROP, 0, 1).viewport).toStrictEqual({ width: 400, height: 500 });
    expect(pageTransform(CROP, 180, 1).viewport).toStrictEqual({ width: 400, height: 500 });
    expect(pageTransform(CROP, 90, 1).viewport).toStrictEqual({ width: 500, height: 400 });
    expect(pageTransform(CROP, 270, 1).viewport).toStrictEqual({ width: 500, height: 400 });
  });

  it('scales the viewport', () => {
    expect(pageTransform(CROP, 0, 2).viewport).toStrictEqual({ width: 800, height: 1000 });
  });
});

describe('toViewport', () => {
  it('subtracts the CropBox origin, which a bare y-flip does not', () => {
    const transform = pageTransform(CROP, 0, 1);

    // The lower-left of the VISIBLE region is (20, 30) in user space and must
    // land at the viewport's bottom-left corner, (0, 500). A conversion that
    // flipped against a page height and ignored the origin puts it somewhere
    // else in both axes — which is what makes this fixture separate anything.
    expect(toViewport(pdfPoint(20, 30), transform)).toStrictEqual(viewportPoint(0, 500));
    expect(toViewport(pdfPoint(20, 530), transform)).toStrictEqual(viewportPoint(0, 0));
    expect(toViewport(pdfPoint(420, 530), transform)).toStrictEqual(viewportPoint(400, 0));
  });

  it('puts the visible region inside the viewport at every rotation', () => {
    // The property that holds for all four, asserted for all four: the four
    // corners of the CropBox map onto the four corners of the viewport. A
    // rotation applied in the wrong direction sends them outside it, and a
    // rotation forgotten leaves them in the unrotated positions.
    for (const rotation of [0, 90, 180, 270] as const) {
      const transform = pageTransform(CROP, rotation, 1);
      const corners = [
        toViewport(pdfPoint(20, 30), transform),
        toViewport(pdfPoint(420, 30), transform),
        toViewport(pdfPoint(20, 530), transform),
        toViewport(pdfPoint(420, 530), transform),
      ];
      const xs = corners.map((corner) => corner.x).sort((a, b) => a - b);
      const ys = corners.map((corner) => corner.y).sort((a, b) => a - b);

      expect([xs[0], xs[3]]).toStrictEqual([0, transform.viewport.width]);
      expect([ys[0], ys[3]]).toStrictEqual([0, transform.viewport.height]);
    }
  });

  it('CONTROL: the four rotations do not agree, so the rotation is not being ignored', () => {
    // Every assertion above is satisfied by a transform that ignores rotation
    // entirely at 0 and 180, and the corner-set property is rotation-invariant
    // by construction. This is the case that separates them: one interior
    // point, four rotations, four different answers.
    const point = pdfPoint(120, 80);
    const seen = ([0, 90, 180, 270] as const).map((rotation) => {
      const at = toViewport(point, pageTransform(CROP, rotation, 1));
      return `${String(at.x)},${String(at.y)}`;
    });
    expect(new Set(seen).size).toBe(4);
  });
});

describe('toPdf', () => {
  it('round-trips every rotation and a non-unit scale', () => {
    // Asserted as a round trip rather than against hand-computed numbers,
    // because a sign error present in BOTH directions is exactly what a
    // hand-written expectation would enshrine. The interior point is off-centre
    // in both axes so a transposed inverse cannot survive.
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const scale of [1, 1.5]) {
        const transform = pageTransform(CROP, rotation, scale);
        const original = pdfPoint(137, 291);
        const back = toPdf(toViewport(original, transform), transform);
        expect([roughly(back.x), roughly(back.y)]).toStrictEqual([137, 291]);
      }
    }
  });

  it('CONTROL: the round trip is not the identity function on the viewport', () => {
    // A `toViewport` and a `toPdf` that both returned their argument unchanged
    // would pass every round trip above. This asserts that the intermediate
    // value is genuinely a different point.
    const transform = pageTransform(CROP, 90, 2);
    const original = pdfPoint(137, 291);
    const middle = toViewport(original, transform);
    expect([middle.x, middle.y]).not.toStrictEqual([137, 291]);
  });
});

describe('toFitz', () => {
  it('flips y about the CropBox top and drops the origin, without picking up the zoom', () => {
    // The zoom clause is the point of the case. A conversion routed through the
    // viewport would multiply by `scale`, and a kernel-side coordinate that
    // varied with the user's zoom is the defect keeping these separate prevents.
    const at1 = toFitz(pdfPoint(120, 80), pageTransform(CROP, 0, 1));
    const at3 = toFitz(pdfPoint(120, 80), pageTransform(CROP, 0, 3));

    expect(at1).toStrictEqual(at3);
    expect([at1.x, at1.y]).toStrictEqual([100, 450]);
  });

  it('ignores rotation, because MuPDF space is unrotated', () => {
    const upright = toFitz(pdfPoint(120, 80), pageTransform(CROP, 0, 1));
    const turned = toFitz(pdfPoint(120, 80), pageTransform(CROP, 90, 1));
    expect(turned).toStrictEqual(upright);
  });

  it('round-trips', () => {
    const transform = pageTransform(CROP, 0, 1);
    const back = fromFitz(toFitz(pdfPoint(137, 291), transform), transform);
    expect([back.x, back.y]).toStrictEqual([137, 291]);
  });
});

describe('toRaster', () => {
  it('applies the device pixel ratio and nothing else', () => {
    const transform = pageTransform(CROP, 0, 2, 1.5);
    expect(toRaster(viewportPoint(100, 200), transform)).toStrictEqual(rasterPoint(150, 300));
  });

  it('CONTROL: the ratio is separate from the scale', () => {
    // Two transforms with the same total magnification and different splits
    // between zoom and pixel ratio. A single number that both of them wrote
    // would make these agree — that is the one-writer violation this space
    // exists to prevent, and it produces a half-resolution page.
    const zoomed = pageTransform(CROP, 0, 3, 1);
    const dense = pageTransform(CROP, 0, 1, 3);
    expect(toRaster(viewportPoint(100, 100), zoomed)).not.toStrictEqual(
      toRaster(viewportPoint(100, 100), dense),
    );
  });

  it('round-trips', () => {
    const transform = pageTransform(CROP, 0, 1, 2);
    expect(fromRaster(toRaster(viewportPoint(37, 91), transform), transform)).toStrictEqual(
      viewportPoint(37, 91),
    );
  });
});

describe('fromXObject', () => {
  it('applies [a b c d e f] in the order the file stores it', () => {
    // A translation-only matrix, which every implementation gets right, is not
    // the fixture: this one has a non-zero `b` and `c`, so a transposed matrix
    // produces a different answer. With b = c = 0 the two are identical, which
    // is why the classic transposition survives most test suites.
    expect(fromXObject(xObjectPoint(2, 3), [1, 2, 3, 4, 5, 6])).toStrictEqual(pdfPoint(16, 22));
  });

  it('CONTROL: the transposed matrix gives a different answer, so the case can see one', () => {
    expect(fromXObject(xObjectPoint(2, 3), [1, 3, 2, 4, 5, 6])).not.toStrictEqual(
      fromXObject(xObjectPoint(2, 3), [1, 2, 3, 4, 5, 6]),
    );
  });
});
