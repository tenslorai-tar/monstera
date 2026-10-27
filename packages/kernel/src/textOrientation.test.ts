import { describe, expect, it } from 'vitest';

import { orientationOf } from './pdfiumFfi.js';

/**
 * How a text matrix sets text. Since [ADR-0273](../../../docs/DECISIONS/0273-text-set-at-an-angle-is-edited-in-its-own-frame.md)
 * every kind is edited, in its own frame; the kind still decides what is upright-only (a join of glyph objects along the
 * page's x, a line's reading order), so `upright` must be answered for straight text and nothing else.
 */

/** The matrix of a rotation by `degrees`, at scale `size`. */
function rotation(degrees: number, size = 11): [number, number, number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [size * Math.cos(radians), size * Math.sin(radians), -size * Math.sin(radians), size * Math.cos(radians)];
}

describe('orientationOf', () => {
  it('is upright for text set straight, and for rounding noise beside the scale', () => {
    expect(orientationOf(11, 0, 0, 11)).toBe('upright');
    expect(orientationOf(11, 1e-8, -1e-8, 11)).toBe('upright');
  });

  it('is vertical for a quarter turn either way, which is how a line that runs up or down a page is set', () => {
    expect(orientationOf(...rotation(90))).toBe('vertical');
    expect(orientationOf(...rotation(270))).toBe('vertical');
    expect(orientationOf(...rotation(-90))).toBe('vertical');
  });

  it('is turned for any other rotation, a half turn included', () => {
    expect(orientationOf(...rotation(180))).toBe('turned');
    expect(orientationOf(...rotation(30))).toBe('turned');
    expect(orientationOf(...rotation(-12.5))).toBe('turned');
  });

  it('is slanted for a shear, which a rotation never has: the columns are not at a right angle', () => {
    expect(orientationOf(11, 0, 3, 11)).toBe('slanted');
    // a shear stays a shear when it is turned as well
    expect(orientationOf(0, 11, -11, 3)).toBe('slanted');
  });

  it('is mirrored for a flip, whichever way it is drawn', () => {
    expect(orientationOf(-11, 0, 0, 11)).toBe('mirrored');
    expect(orientationOf(11, 0, 0, -11)).toBe('mirrored');
  });

  // THE CONTROL: only straight text is joined and read along the page's x, so every other answer must differ from it.
  it('answers upright for nothing but straight text', () => {
    const others = [rotation(90), rotation(180), rotation(30), [11, 0, 3, 11], [-11, 0, 0, 11]] as const;
    for (const matrix of others) expect(orientationOf(...(matrix as unknown as [number, number, number, number]))).not.toBe('upright');
  });
});
