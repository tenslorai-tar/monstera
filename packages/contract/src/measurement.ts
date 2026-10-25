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

/**
 * The size a reading is set in, in points: the size MuPDF sets a distance's caption in (`pdf_write_line_caption`, MuPDF
 * 1.28.0), so the three kinds are one family on the page, and so the reading a drag shows is the reading the page draws.
 */
export const MEASURE_LABEL_SIZE = 12;

/**
 * Helvetica's advance widths, in thousandths of the size, for the characters a reading is made of (the format's original publisher's
 * `Helvetica.afm`). Any other character takes a digit's width, which is the widest a reading's characters run.
 */
const HELVETICA_WIDTHS: Readonly<Record<string, number>> = {
  ' ': 278, '.': 278, ',': 278, '-': 333, '²': 333,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  c: 500, f: 278, i: 222, m: 833, n: 556, p: 556, t: 278,
};

/** How wide `text` is in Helvetica at {@link MEASURE_LABEL_SIZE}, in points. By code point, as one WinAnsi byte is. */
export function measureLabelWidth(text: string): number {
  let advance = 0;
  for (const character of text) advance += HELVETICA_WIDTHS[character] ?? 556;
  return (MEASURE_LABEL_SIZE / 1000) * advance;
}

/** Where a reading is set: its baseline's start, its turn in degrees counter-clockwise, its size and width, in points. */
export interface MeasureCaption {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly size: number;
  readonly width: number;
}

/**
 * WHERE A READING IS SET, in the same space as `points` (PDF user space): the ONE rule the page's own labels and the
 * reading a drag shows both take (the owner's review of 0.1.16.0, R7: the live reading sat beside the pointer, upright
 * and in another size, and jumped onto the line on release).
 *
 * - **A distance** is MuPDF's caption (`pdf_write_line_caption`, MuPDF 1.28.0), which this states rather than owns: set
 *   along the line, centred on its middle, its baseline 0.3 of the size below the line — or, where it would not fit
 *   between the ends, 0.2 above. `pageAnnotations.test.ts` reads MuPDF's appearance and holds the two equal, so a MuPDF
 *   that moves its caption reddens a case rather than parting the drag from the page.
 * - **An area** is centred on the shape's centroid, and **a perimeter** sits beside the middle of its longest side, on
 *   the outer normal, clear of the line; both upright, their baseline a third of the size below the anchor. The kernel
 *   writes these two into the appearance (`relabel`), from here.
 */
export function measureCaption(kind: MeasuredKind, points: readonly AnnotationPoint[], text: string): MeasureCaption | undefined {
  const size = MEASURE_LABEL_SIZE;
  const width = measureLabelWidth(text);
  if (kind === 'measure-distance') {
    const [a, b] = points;
    if (a === undefined || b === undefined) return undefined;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return undefined;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const above = width + size > length;
    const x = (a.x + b.x) / 2 - dx * (width / 2) + (above ? -dy * size * 0.2 : dy * size * 0.3);
    const y = (a.y + b.y) / 2 - dy * (width / 2) + (above ? dx * size * 0.2 : -dx * size * 0.3);
    return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI, size, width };
  }
  if (points.length < 2) return undefined;
  const anchor = kind === 'measure-area' ? centroidOf(points) : besideLongestSide(points, width);
  return { x: anchor.x - width / 2, y: anchor.y - size / 3, angle: 0, size, width };
}

/** A polygon's centroid; the mean of its corners where it has no area (every corner on one line). */
function centroidOf(points: readonly AnnotationPoint[]): AnnotationPoint {
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (const [at, here] of points.entries()) {
    const next = points[(at + 1) % points.length] ?? here;
    const cross = here.x * next.y - next.x * here.y;
    twice += cross;
    cx += (here.x + next.x) * cross;
    cy += (here.y + next.y) * cross;
  }
  if (Math.abs(twice) < 1e-9) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  return { x: cx / (3 * twice), y: cy / (3 * twice) };
}

/** Beside the middle of a polyline's longest side, on the normal pointing up (or right), clear of the line by a quarter size. */
function besideLongestSide(points: readonly AnnotationPoint[], width: number): AnnotationPoint {
  const first = points[0] ?? { x: 0, y: 0 };
  let best = { x: first.x, y: first.y, dx: 1, dy: 0, length: -1 };
  for (let at = 1; at < points.length; at += 1) {
    const from = points[at - 1] ?? first;
    const to = points[at] ?? first;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > best.length && length > 0) {
      best = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, dx: (to.x - from.x) / length, dy: (to.y - from.y) / length, length };
    }
  }
  let normal = { x: -best.dy, y: best.dx };
  if (normal.y < 0 || (normal.y === 0 && normal.x > 0)) normal = { x: -normal.x, y: -normal.y };
  // THE BOX'S REACH along the normal is half its width times the normal's x and half its height times its y, plus a gap.
  const clearance = (Math.abs(normal.x) * width) / 2 + (Math.abs(normal.y) * MEASURE_LABEL_SIZE) / 2 + MEASURE_LABEL_SIZE / 4;
  return { x: best.x + normal.x * clearance, y: best.y + normal.y * clearance };
}
