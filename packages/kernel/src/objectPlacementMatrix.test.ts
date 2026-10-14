import { describe, expect, it } from 'vitest';

import { type PageMatrix, placementMatrix } from './objectPlacementMatrix.js';

/** Where a point lands under a page matrix, row-vector order. */
function at(matrix: PageMatrix, x: number, y: number): readonly [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [Math.round((x * a + y * c + e) * 1e9) / 1e9, Math.round((x * b + y * d + f) * 1e9) / 1e9];
}

const BOX = { left: 100, bottom: 200, right: 140, top: 220 };

describe('the one placement matrix (ADR-0243)', () => {
  it('with no turn is the scale about the lower-left corner and the move both engines applied before ADR-0243', () => {
    const matrix = placementMatrix({ box: BOX, moveBy: { x: 5, y: -3 }, scaleBy: { x: 2, y: 3 } });
    // CONTROL: the formula placeObject spelt until it took this one, written out.
    expect(matrix).toStrictEqual([2, 0, 0, 3, 100 * (1 - 2) + 5, 200 * (1 - 3) - 3]);
  });

  it('turns about the centre of the box the scale left: a quarter turn keeps the centre and swaps the sides', () => {
    const matrix = placementMatrix({ box: BOX, moveBy: { x: 0, y: 0 }, scaleBy: { x: 1, y: 1 }, rotateBy: 90 });
    // THE CENTRE (120, 210) STAYS, and a point 20 to its right lands 20 ABOVE it: counter-clockwise, as PDF measures.
    expect(at(matrix, 120, 210)).toStrictEqual([120, 210]);
    expect(at(matrix, 140, 210)).toStrictEqual([120, 230]);
  });

  it('turns about the SCALED box’s centre, then moves', () => {
    const matrix = placementMatrix({ box: BOX, moveBy: { x: 10, y: 0 }, scaleBy: { x: 2, y: 2 }, rotateBy: 180 });
    // SCALED 2 about (100, 200) the box is (100, 200)–(180, 240), centre (140, 220); its lower-left turns half round to
    // (180, 240), then moves 10 right.
    expect(at(matrix, 100, 200)).toStrictEqual([190, 240]);
  });
});
