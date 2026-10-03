import { describe, expect, it } from 'vitest';

import {
  type KeepableSignature,
  MAX_PLACED_SIGNATURE_POINTS,
  MAX_SIGNATURE_OUTLINE_POINTS,
  MAX_SIGNATURE_STROKE_POINTS,
  MAX_SIGNATURE_STROKES,
  RETIRED_SIGNATURE_FONTS,
  SIGNATURE_OUTLINE_GRID,
  type SignatureOutline,
  keepableSignatureSchema,
  libraryEntrySchema,
  outlineOpCodes,
  outlineOpsArePath,
  outlinePointsOf,
  placeSignatureMarkSchema,
  placedMarkOf,
  signatureFontOf,
  strokesOfPlaced,
} from './commands.js';

/**
 * A drawing fitted to the placing command (finding DDDDDDD-1): within the bound it crosses exactly as drawn, past it it
 * is thinned rather than cut, and the command's schema refuses a drawing past the bound or with strokes out of order.
 */

type Stroke = Extract<KeepableSignature, { kind: 'drawn' }>['strokes'][number];

/** A stroke of `length` points along a diagonal, each point distinct, so a dropped or reordered point is visible. */
function stroke(length: number, offset = 0): Stroke {
  return Array.from({ length }, (_, at) => [(at + offset) / 4096, ((at + offset) % 97) / 97] as [number, number]);
}

const PLACING = { kind: 'placeSignatureMark', page: 0, rect: { x0: 0, y0: 0, x1: 150, y1: 50 }, stamp: { author: 'A', created: '2026-10-02T12:00:00Z' } } as const;

describe('placedMarkOf and strokesOfPlaced', () => {
  it('a drawing within the bound crosses EXACTLY as drawn, and comes back as the same strokes', () => {
    const strokes = [stroke(300), stroke(2, 5), stroke(40, 9)];
    const placed = placedMarkOf({ kind: 'drawn', strokes });
    if (placed.kind !== 'drawn') throw new Error('a drawing came back as another look');
    expect(placed.starts).toStrictEqual([0, 300, 302]);
    expect(strokesOfPlaced(placed)).toStrictEqual(strokes);
    expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: placed }).success).toBe(true);
  });

  it('a drawing at the KEPT bound is thinned under the placed bound, keeping every stroke and both its ends', () => {
    const strokes = Array.from({ length: MAX_SIGNATURE_STROKES }, (_, at) => stroke(MAX_SIGNATURE_STROKE_POINTS, at));
    const placed = placedMarkOf({ kind: 'drawn', strokes });
    if (placed.kind !== 'drawn') throw new Error('a drawing came back as another look');
    expect(placed.points.length).toBeLessThanOrEqual(MAX_PLACED_SIGNATURE_POINTS);
    const back = strokesOfPlaced(placed);
    expect(back).toHaveLength(MAX_SIGNATURE_STROKES);
    back.forEach((each, at) => {
      expect(each[0]).toStrictEqual(strokes[at]?.[0]);
      expect(each.at(-1)).toStrictEqual(strokes[at]?.at(-1));
    });
    expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: placed }).success).toBe(true);
  });

  it('CONTROL: the placed bound bites — one point more than it is refused, the same drawing flattened by hand', () => {
    const points = stroke(MAX_PLACED_SIGNATURE_POINTS + 1);
    expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: { kind: 'drawn', points, starts: [0] } }).success).toBe(false);
    expect(
      placeSignatureMarkSchema.safeParse({ ...PLACING, mark: { kind: 'drawn', points: points.slice(1), starts: [0] } }).success,
    ).toBe(true);
  });

  it('refuses starts out of order, not at 0, or leaving a stroke of one point', () => {
    const points = stroke(6);
    for (const starts of [[1], [0, 4, 2], [0, 5], [0, 3, 4]]) {
      expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: { kind: 'drawn', points, starts } }).success, String(starts)).toBe(false);
    }
    expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: { kind: 'drawn', points, starts: [0, 2, 4] } }).success).toBe(true);
  });

  it('a typed name’s outline crosses unchanged', () => {
    const outlined = { kind: 'outlined', text: 'Ada', font: 'courier-prime', outline: SQUARE } as const;
    expect(placedMarkOf(outlined)).toStrictEqual(outlined);
    expect(placeSignatureMarkSchema.safeParse({ ...PLACING, mark: outlined }).success).toBe(true);
  });
});

/** A closed square with one curved side: a move, two lines, a quadratic and a close — 1 + 1 + 1 + 2 points. */
const SQUARE: SignatureOutline = {
  ops: outlineOpCodes('MLLQZ'),
  points: [0, 0, 100, 0, 100, 100, 50, 150, 0, 100],
  frame: [0, 0, 100, 120],
};

describe('the outline a typed name crosses as (ADR-0150)', () => {
  const placing = (outline: unknown): boolean =>
    placeSignatureMarkSchema.safeParse({ ...PLACING, mark: { kind: 'outlined', text: 'Ada', font: 'allura', outline } }).success;

  it('takes a path whose points are exactly the ones its operators take', () => {
    expect(outlinePointsOf(SQUARE.ops)).toBe(5);
    expect(placing(SQUARE)).toBe(true);
  });

  it('refuses points the operators do not take — one pair short, one pair over', () => {
    expect(placing({ ...SQUARE, points: SQUARE.points.slice(2) })).toBe(false);
    expect(placing({ ...SQUARE, points: [...SQUARE.points, 1, 1] })).toBe(false);
  });

  it('takes subpaths open or closed, one after another', () => {
    for (const letters of ['ML', 'MLZ', 'MLML', 'MLZML', 'MQCZMLZ']) {
      expect(outlineOpsArePath(outlineOpCodes(letters)), letters).toBe(true);
    }
  });

  it('refuses operators that are not a path: no move first, a move or close with nothing drawn, a code past the five', () => {
    for (const letters of ['', 'L', 'LLZ', 'MZ', 'MMLZ', 'MLZZ', 'MLZL', 'MLM']) {
      expect(outlineOpsArePath(outlineOpCodes(letters)), letters).toBe(false);
    }
    expect(placing({ ...SQUARE, ops: outlineOpCodes('LLLQZ') })).toBe(false);
    expect(placing({ ...SQUARE, ops: [0, 1, 1, 2, 5] })).toBe(false);
    expect(() => outlineOpCodes('MX')).toThrow(RangeError);
  });

  it('refuses a coordinate off the grid, and a frame with no area', () => {
    expect(placing({ ...SQUARE, points: [0, 0, 100, 0, 100, 100, 50, SIGNATURE_OUTLINE_GRID + 1, 0, 100] })).toBe(false);
    expect(placing({ ...SQUARE, points: [0, 0, 100, 0, 100, 100, 50, 0.5, 0, 100] })).toBe(false);
    expect(placing({ ...SQUARE, frame: [100, 0, 100, 120] })).toBe(false);
  });

  it('CONTROL: the bound bites — one point past it is refused, the bound itself is taken', () => {
    const lines = (count: number): SignatureOutline => ({
      ops: outlineOpCodes(`M${'L'.repeat(count - 1)}`),
      points: Array.from({ length: 2 * count }, (_, at) => at % SIGNATURE_OUTLINE_GRID),
      frame: [0, 0, 10, 10],
    });
    expect(placing(lines(MAX_SIGNATURE_OUTLINE_POINTS))).toBe(true);
    expect(placing(lines(MAX_SIGNATURE_OUTLINE_POINTS + 1))).toBe(false);
  });

  it('a placing command at the bound fits the engine host’s frame with a quarter to spare', () => {
    // THE LONGEST IT CAN ENCODE: every point a five-digit coordinate, and the most operators those points allow — the
    // shortest subpath a path may have, a move, a line and a close, so one and a half a point.
    const outline = {
      ops: outlineOpCodes('MLZ'.repeat(MAX_SIGNATURE_OUTLINE_POINTS / 2)),
      points: Array.from({ length: 2 * MAX_SIGNATURE_OUTLINE_POINTS }, () => SIGNATURE_OUTLINE_GRID),
      frame: [0, 0, SIGNATURE_OUTLINE_GRID, SIGNATURE_OUTLINE_GRID],
    };
    // AND THE LONGEST NAME: a control character is six bytes in JSON, the most any character of the name can be.
    const command = { ...PLACING, mark: { kind: 'outlined', text: '\u0001'.repeat(256), font: 'herr-von-muellerhoff', outline } };
    expect(placeSignatureMarkSchema.safeParse(command).success).toBe(true);
    // EVERY CHARACTER OF THAT ENCODING IS ASCII — the name's are escapes — so its length is its size in bytes.
    const encoded = JSON.stringify(command);
    expect(/^[\x20-\x7e]*$/u.test(encoded)).toBe(true);
    expect(encoded.length).toBeLessThan(0.75 * 262_144);
  });
});

describe('a kept typed signature in a face that is retired', () => {
  it('is read, and is shown and placed in the nearest face', () => {
    for (const [retired, current] of Object.entries(RETIRED_SIGNATURE_FONTS)) {
      const entry = { id: '7c8f2d1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', kind: 'signature', look: { kind: 'typed', text: 'Ada', font: retired } };
      expect(libraryEntrySchema.safeParse(entry).success, retired).toBe(true);
      expect(signatureFontOf(retired as keyof typeof RETIRED_SIGNATURE_FONTS)).toBe(current);
    }
    expect(signatureFontOf('great-vibes')).toBe('great-vibes');
  });

  it('CONTROL: a retired face is READ only — a new keep naming one is refused', () => {
    expect(keepableSignatureSchema.safeParse({ kind: 'typed', text: 'Ada', font: 'times-italic' }).success).toBe(false);
    expect(keepableSignatureSchema.safeParse({ kind: 'typed', text: 'Ada', font: 'garamond-italic' }).success).toBe(true);
  });
});
