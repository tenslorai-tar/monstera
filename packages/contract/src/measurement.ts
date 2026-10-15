import { z } from 'zod';

import type { AnnotationPoint, MeasureScale } from './commands.js';

/**
 * A measurement's reading: the ONE arithmetic for what a distance, an area or a perimeter says (the owner's O8).
 *
 * The kernel writes it into `/Contents` when a measurement is drawn and again whenever its geometry changes, and the
 * renderer shows it while one is being drawn. Two statements of one number, one function: a preview that computed its
 * own would agree with the file on every case anybody tried and come apart on the first rounding nobody did (B3a).
 *
 * Points are in any frame where x and y share a scale — PDF user space, or the page as the engine displays it at scale
 * 1 — since a length and an area are unchanged by turning and moving the page.
 */

/** The three measurement kinds, as a schema so the listing that carries one names them from here. */
export const measuredKindSchema = z.enum(['measure-distance', 'measure-area', 'measure-perimeter']);

/** See {@link measuredKindSchema}. */
export type MeasuredKind = z.infer<typeof measuredKindSchema>;

/**
 * How many decimal places a measurement's label carries.
 *
 * One, because the number is a reading off a drawing rather than a computation: a drag places a point to within a pixel,
 * and a label with three decimals claims a precision the gesture does not have. `/Measure`'s own `/D` carries the same
 * figure so the two agree.
 */
export const MEASURE_PLACES = 1;

/**
 * The length of a run of points, segment by segment: a perimeter and a line's length with the same code, a line having
 * one segment.
 */
export function pathLength(points: readonly AnnotationPoint[]): number {
  let total = 0;
  for (let at = 1; at < points.length; at += 1) {
    const from = points[at - 1];
    const to = points[at];
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/**
 * The area a closed run of points encloses: the shoelace formula, its absolute value so the direction the person drew in
 * does not make the area negative.
 */
export function shoelaceArea(points: readonly AnnotationPoint[]): number {
  let twice = 0;
  for (let at = 0; at < points.length; at += 1) {
    const here = points[at];
    const next = points[(at + 1) % points.length];
    if (here === undefined || next === undefined) continue;
    twice += here.x * next.y - next.x * here.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * A measurement's label, the text a reader sees on it. **An area is squared in both the number and the unit**: scaling an
 * area by the length ratio rather than its square is off by that ratio, and the label still reads like a measurement.
 */
export function measureLabel(kind: MeasuredKind, points: readonly AnnotationPoint[], scale: MeasureScale): string {
  const { perPoint, unit } = scale;
  if (kind === 'measure-area') {
    return `${(shoelaceArea(points) * perPoint * perPoint).toFixed(MEASURE_PLACES)} ${unit}²`;
  }
  return `${(pathLength(points) * perPoint).toFixed(MEASURE_PLACES)} ${unit}`;
}
