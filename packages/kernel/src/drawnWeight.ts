import type { OutlineCommand } from './textShaping.js';
import { type DrawnObject, drawnObjects } from './textOperators.js';

/**
 * The weight letters LOOK, measured from their stems ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)'s
 * corrections of 2026-10-26, the owner's L2).
 *
 * A font whose letters are drawn (`/Type3`) states its weight only in its descriptor, and a producer writes what it likes
 * there: the owner's document 2 draws its title in a variable serif at 550 and says 600, and a new word matched on that
 * number was set in a full bold. So the weight a new word is matched on is measured: how thick a vertical stem of the
 * drawn letters is, per em, against the same letters in the stand-in family at its weights, and the weight whose stem
 * matches is the one asked.
 *
 * The STEM and not the ink: ink per em of advance compares two families' designs as well as two weights, and measured on
 * document 2 it read the page's regular body text as 561 against Tinos (scratch `l2Measure.mjs`, 2026-10-26).
 */

type Point = readonly [number, number];
type Contours = readonly (readonly Point[])[];

/** How many straight steps a curve is flattened into: a stem read across its middle is then within a part in a thousand. */
const STEPS = 12;

/** The letters that stand on one vertical stem at their middle, where a line across it enters and leaves that stem. */
export const STEM_LETTERS: ReadonlySet<string> = new Set(['l', 'I', 'i', 'n', 'm', 'h', 'u', 'r']);

/** The fewest stem letters a weight is read from: fewer is a guess from one or two shapes. */
export const FEWEST_LETTERS = 4;

/** Points along a cubic from `p0` to `p3`, `p0` itself left out. */
function cubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  return Array.from({ length: STEPS }, (_, step) => {
    const t = (step + 1) / STEPS;
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ] as const;
  });
}

/** Points along a quadratic from `p0` to `p2`, `p0` itself left out. */
function quadratic(p0: Point, p1: Point, p2: Point): Point[] {
  return Array.from({ length: STEPS }, (_, step) => {
    const t = (step + 1) / STEPS;
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]] as const;
  });
}

/** A face's glyph outline as HarfBuzz states it, in font units, as contours of points. */
export function contoursOfOutline(commands: readonly OutlineCommand[]): Point[][] {
  const contours: Point[][] = [];
  let open: Point[] = [];
  const at = (): Point => open.at(-1) ?? [0, 0];
  for (const { type, values: v } of commands) {
    if (type === 'M') {
      if (open.length > 0) contours.push(open);
      open = [[v[0] ?? 0, v[1] ?? 0]];
    } else if (type === 'L') open.push([v[0] ?? 0, v[1] ?? 0]);
    else if (type === 'Q') open.push(...quadratic(at(), [v[0] ?? 0, v[1] ?? 0], [v[2] ?? 0, v[3] ?? 0]));
    else if (type === 'C') open.push(...cubic(at(), [v[0] ?? 0, v[1] ?? 0], [v[2] ?? 0, v[3] ?? 0], [v[4] ?? 0, v[5] ?? 0]));
    else if (open.length > 0) {
      contours.push(open);
      open = [];
    }
  }
  if (open.length > 0) contours.push(open);
  return contours;
}

/** The paints that FILL a path: a stroke's thickness is its line width, which no outline states. */
const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);

/** A drawn path's contours in the space its CTM maps to, from its segments as written. */
function contoursOfPath(object: DrawnObject): Point[][] {
  const [a, b, c, d, e, f] = object.ctm;
  const map = ([x, y]: Point): Point => [x * a + y * c + e, x * b + y * d + f];
  const contours: Point[][] = [];
  let open: Point[] = [];
  let pen: Point = [0, 0];
  const close = (): void => {
    if (open.length > 0) contours.push(open);
    open = [];
  };
  for (const { op, values: v } of object.segments) {
    const n = (k: number): number => v[k] ?? 0;
    if (op === 'm') {
      close();
      pen = [n(0), n(1)];
      open = [pen];
    } else if (op === 'l') {
      pen = [n(0), n(1)];
      open.push(pen);
    } else if (op === 'c') {
      open.push(...cubic(pen, [n(0), n(1)], [n(2), n(3)], [n(4), n(5)]));
      pen = [n(4), n(5)];
    } else if (op === 'v') {
      open.push(...cubic(pen, pen, [n(0), n(1)], [n(2), n(3)]));
      pen = [n(2), n(3)];
    } else if (op === 'y') {
      open.push(...cubic(pen, [n(0), n(1)], [n(2), n(3)], [n(2), n(3)]));
      pen = [n(2), n(3)];
    } else if (op === 're') {
      close();
      contours.push([
        [n(0), n(1)],
        [n(0) + n(2), n(1)],
        [n(0) + n(2), n(1) + n(3)],
        [n(0), n(1) + n(3)],
      ]);
    } else close();
  }
  close();
  return contours.map((contour) => contour.map(map));
}

/**
 * A Type 3 glyph procedure's filled contours in its glyph space, or `null` where it draws anything that is not a filled
 * path — a picture, a stroke, a form — whose stem no outline states.
 */
export function glyphProcedureContours(content: Uint8Array): Point[][] | null {
  const contours: Point[][] = [];
  for (const object of drawnObjects(content, () => 'image')) {
    if (object.kind !== 'path' || object.paint === undefined || !FILLS.has(object.paint.op)) return null;
    contours.push(...contoursOfPath(object));
  }
  return contours;
}

/**
 * How thick the first vertical stroke of a glyph is: where a line across the middle of its ink first enters and leaves
 * it. For a {@link STEM_LETTERS} letter that is its stem, which is what a weight makes thicker.
 */
export function stemOf(contours: Contours): number | undefined {
  const ys = contours.flat().map(([, y]) => y);
  if (ys.length === 0) return undefined;
  const middle = (Math.min(...ys) + Math.max(...ys)) / 2;
  const crossings: number[] = [];
  for (const contour of contours) {
    for (let at = 0; at < contour.length; at += 1) {
      const [x0, y0] = contour[at] ?? [0, 0];
      const [x1, y1] = contour[(at + 1) % contour.length] ?? [0, 0];
      if ((y0 <= middle && y1 > middle) || (y1 <= middle && y0 > middle)) crossings.push(x0 + ((middle - y0) / (y1 - y0)) * (x1 - x0));
    }
  }
  crossings.sort((left, right) => left - right);
  const [enter, leave] = crossings;
  return enter === undefined || leave === undefined ? undefined : leave - enter;
}

/** The mean of stems, `undefined` for none. */
export function meanStem(stems: readonly number[]): number | undefined {
  return stems.length === 0 ? undefined : stems.reduce((sum, stem) => sum + stem, 0) / stems.length;
}

/** A face at one weight, and its mean stem over the measured letters, in em. */
export interface WeightedStem {
  readonly weight: number;
  readonly stem: number;
}

/**
 * The weight whose stem matches `stem`, read off the family's own weights: between the two that bracket it, by their
 * straight line; the end weight past either end. `undefined` with fewer than two weights of different stems, where
 * nothing can be told apart.
 */
export function weightMatching(stem: number, family: readonly WeightedStem[]): number | undefined {
  const points = [...family].sort((left, right) => left.stem - right.stem);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || last.stem - first.stem <= 0) return undefined;
  if (stem <= first.stem) return first.weight;
  if (stem >= last.stem) return last.weight;
  for (let at = 1; at < points.length; at += 1) {
    const low = points[at - 1];
    const high = points[at];
    if (low === undefined || high === undefined || stem > high.stem) continue;
    const share = high.stem === low.stem ? 0 : (stem - low.stem) / (high.stem - low.stem);
    return Math.round(low.weight + share * (high.weight - low.weight));
  }
  return last.weight;
}
