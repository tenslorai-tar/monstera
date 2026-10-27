import { describe, expect, it } from 'vitest';

import { fromTextFrame, intoTextFrame, sameTextFrame, textFrameOf } from './textFrame.js';

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

describe('textFrameOf, the one answer to how text is set (ADR-0273)', () => {
  it('is NO frame for upright text at any size, and for float noise a file reads back', () => {
    expect(textFrameOf(1, 0, 0, 1)).toBeNull();
    expect(textFrameOf(12, 0, 0, 12)).toBeNull();
    expect(textFrameOf(12, 1e-9, -1e-9, 12)).toBeNull();
    // A HORIZONTAL SCALE (Tz) keeps the axes: still upright.
    expect(textFrameOf(9, 0, 0, 12)).toBeNull();
  });

  it('is the turn, slant or flip at unit length along the line, whatever the size', () => {
    expect(textFrameOf(12 * COS, 12 * SIN, -12 * SIN, 12 * COS)?.map((value) => Number(value.toFixed(9)))).toStrictEqual(
      [COS, SIN, -SIN, COS].map((value) => Number(value.toFixed(9))),
    );
    expect(textFrameOf(0, 10, -10, 0)).toStrictEqual([0, 1, -1, 0]);
    expect(textFrameOf(10, 0, 2.5, 10)).toStrictEqual([1, 0, 0.25, 1]);
    expect(textFrameOf(-10, 0, 0, 10)).toStrictEqual([-1, 0, 0, 1]);
    // UPSIDE DOWN is a turn, not upright: both diagonals negative.
    expect(textFrameOf(-10, 0, 0, -10)).toStrictEqual([-1, 0, 0, -1]);
  });

  it('is no frame for text drawn at no size, which has no inverse and no space to set a word in', () => {
    expect(textFrameOf(0, 0, 0, 0)).toBeNull();
    expect(textFrameOf(10, 0, 20, 0)).toBeNull();
  });

  it('takes a point into the frame and back to where it was, for every kind', () => {
    for (const frame of [[COS, SIN, -SIN, COS], [0, 1, -1, 0], [1, 0, 0.25, 1], [-1, 0, 0, 1]] as const) {
      const inside = intoTextFrame(frame, 123.5, -40.25);
      const back = fromTextFrame(frame, inside.x, inside.y);
      expect(back.x).toBeCloseTo(123.5, 9);
      expect(back.y).toBeCloseTo(-40.25, 9);
    }
    // CONTROL: a turn moves a point, so the round trip above is not the identity twice.
    expect(fromTextFrame([0, 1, -1, 0], 10, 0)).toStrictEqual({ x: 0, y: 10 });
  });

  it('calls two frames one only within the noise a file carries', () => {
    expect(sameTextFrame([COS, SIN, -SIN, COS], [COS + 1e-6, SIN, -SIN, COS])).toBe(true);
    expect(sameTextFrame([COS, SIN, -SIN, COS], [1, 0, 0.25, 1])).toBe(false);
    expect(sameTextFrame(null, null)).toBe(true);
    expect(sameTextFrame(null, [0, 1, -1, 0])).toBe(false);
  });
});
