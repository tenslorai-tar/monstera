import { describe, expect, it } from 'vitest';

import {
  type KeepableSignature,
  MAX_PLACED_SIGNATURE_POINTS,
  MAX_SIGNATURE_STROKE_POINTS,
  MAX_SIGNATURE_STROKES,
  placeSignatureMarkSchema,
  placedMarkOf,
  strokesOfPlaced,
} from './commands.js';

/**
 * A drawing fitted to the placing command (finding BBBBBBB-1): within the bound it crosses exactly as drawn, past it it
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

  it('a typed look crosses unchanged', () => {
    const typed = { kind: 'typed', text: 'Ada Lovelace', font: 'courier' } as const;
    expect(placedMarkOf(typed)).toStrictEqual(typed);
  });
});
