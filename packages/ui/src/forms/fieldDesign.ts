import type { AnnotationRect } from '@monstera/contract';
import { type PageTransform, pdfPoint, toPdf, toViewport, viewportPoint } from '@monstera/shared';

/**
 * The geometry of *Edit fields* (ADR-0226 Decision 7): where a field's box is drawn, where a drag moves it, where a
 * handle resizes it to, and which boxes a marquee takes. Pure, so the layer that draws them holds no arithmetic and the
 * cases here need no DOM.
 *
 * ## Two frames, one converter
 *
 * A field's `rect` is PDF user space and a pointer is the overlay's CSS pixels. Every conversion goes through the page's
 * one `PageTransform` (`toViewport`, `toPdf`), so a turned page or a CropBox with an origin is the transform's business
 * and nothing here flips a y.
 */

/** A box in the overlay's CSS pixels, corners ordered. */
export interface Pixels {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Where a PDF box lands on the drawn page, its corners ordered. */
export function pixelsOf(rect: AnnotationRect, transform: PageTransform): Pixels {
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** A pixel box back in PDF user space, its corners ordered. */
export function rectOfPixels(box: Pixels, transform: PageTransform): AnnotationRect {
  const p = toPdf(viewportPoint(box.x0, box.y0), transform);
  const q = toPdf(viewportPoint(box.x1, box.y1), transform);
  return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
}

/** The eight handles: four corners and four edge midpoints, each named by the compass direction it pulls. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** Where a handle sits on a box. */
export function handleAt(box: Pixels, handle: Handle): readonly [number, number] {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const x = handle.includes('w') ? box.x0 : handle.includes('e') ? box.x1 : cx;
  const y = handle.includes('n') ? box.y0 : handle.includes('s') ? box.y1 : cy;
  return [x, y];
}

/**
 * The box a handle drag leaves: the edges the handle names follow the pointer, the others stay. An edge dragged past its
 * opposite stops a `least` short of it rather than turning the box inside out, so a resize never makes a field nobody
 * can press.
 */
export function resized(box: Pixels, handle: Handle, to: readonly [number, number], least: number): Pixels {
  let { x0, y0, x1, y1 } = box;
  if (handle.includes('w')) x0 = Math.min(to[0], x1 - least);
  if (handle.includes('e')) x1 = Math.max(to[0], x0 + least);
  if (handle.includes('n')) y0 = Math.min(to[1], y1 - least);
  if (handle.includes('s')) y1 = Math.max(to[1], y0 + least);
  return { x0, y0, x1, y1 };
}

/** A box moved by a pixel delta. */
export function moved(box: Pixels, dx: number, dy: number): Pixels {
  return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
}

/**
 * A PDF rect moved by the pointer's travel, the delta taken IN PDF SPACE from two converted points (`selectTool`'s
 * reason): on a turned page a pixel to the right is not a point to the right.
 */
export function movedRect(
  rect: AnnotationRect,
  from: readonly [number, number],
  to: readonly [number, number],
  transform: PageTransform,
): AnnotationRect {
  const a = toPdf(viewportPoint(from[0], from[1]), transform);
  const b = toPdf(viewportPoint(to[0], to[1]), transform);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
}

/** How far a pasted or duplicated field lands from its original, in points: clear of it, and plainly its copy. */
const COPY_OFFSET = 12;

/**
 * Where a paste or a duplicate puts a copy: right of and below the original, in the PAGE's own axes. A command reaches
 * no page transform (`nudgeSelectionCommand`'s stated limit), so on a turned page *below* is the page's below.
 */
export function besideRect(rect: AnnotationRect): AnnotationRect {
  return { x0: rect.x0 + COPY_OFFSET, y0: rect.y0 - COPY_OFFSET, x1: rect.x1 + COPY_OFFSET, y1: rect.y1 - COPY_OFFSET };
}

/** The box two corners of a marquee make, corners ordered. */
export function marqueeOf(from: readonly [number, number], to: readonly [number, number]): Pixels {
  return {
    x0: Math.min(from[0], to[0]),
    y0: Math.min(from[1], to[1]),
    x1: Math.max(from[0], to[0]),
    y1: Math.max(from[1], to[1]),
  };
}

/**
 * The fields a marquee takes: those it overlaps at all, `selectTool`'s rule for marks and for its reason — a field's box
 * is often larger than the region a person sweeps over its label.
 */
export function marqueeTakes(
  marquee: Pixels,
  boxes: readonly { readonly index: number; readonly box: Pixels }[],
): readonly number[] {
  return boxes
    .filter(({ box }) => box.x0 < marquee.x1 && marquee.x0 < box.x1 && box.y0 < marquee.y1 && marquee.y0 < box.y1)
    .map(({ index }) => index);
}

/** How near, in CSS pixels, an edge has to come to another field's before it snaps to it. */
export const SNAP_REACH = 5;

/** A guide line a snap draws: a vertical one at `x`, or a horizontal one at `y`, across the page. */
export interface Guide {
  readonly axis: 'x' | 'y';
  readonly at: number;
}

/**
 * The nearest of `lines` to any of `ours`, within `reach`: how far to shift so they meet, and where. `undefined` when
 * none is near enough, which is no snap on that axis.
 */
function nearest(ours: readonly number[], lines: readonly number[], reach: number): { readonly shift: number; readonly at: number } | undefined {
  let best: { shift: number; at: number } | undefined;
  for (const own of ours) {
    for (const line of lines) {
      const shift = line - own;
      if (Math.abs(shift) <= reach && (best === undefined || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: line };
    }
  }
  return best;
}

/** Each box's left, centre and right, or top, middle and bottom: the lines a field lines up on. */
function linesOf(boxes: readonly Pixels[], axis: 'x' | 'y'): number[] {
  return boxes.flatMap((box) => (axis === 'x' ? [box.x0, (box.x0 + box.x1) / 2, box.x1] : [box.y0, (box.y0 + box.y1) / 2, box.y1]));
}

/**
 * A move snapped to the other fields (the owner's B2, as a widely used PDF editor does): the travel adjusted so the moving selection's
 * left, centre or right meets another field's, and its top, middle or bottom, each axis on its own and only within
 * {@link SNAP_REACH}, with a guide line where it met.
 */
export function snappedMove(
  moving: Pixels,
  others: readonly Pixels[],
  travel: readonly [number, number],
  reach = SNAP_REACH,
): { readonly travel: readonly [number, number]; readonly guides: readonly Guide[] } {
  const at = moved(moving, travel[0], travel[1]);
  const x = nearest(linesOf([at], 'x'), linesOf(others, 'x'), reach);
  const y = nearest(linesOf([at], 'y'), linesOf(others, 'y'), reach);
  return {
    travel: [travel[0] + (x?.shift ?? 0), travel[1] + (y?.shift ?? 0)],
    guides: [...(x === undefined ? [] : [{ axis: 'x' as const, at: x.at }]), ...(y === undefined ? [] : [{ axis: 'y' as const, at: y.at }])],
  };
}

/**
 * A handle's point snapped to the other fields' edges and centres, on the axes the handle moves: a side handle moves one,
 * a corner two. The same reach and the same guides as {@link snappedMove}.
 */
export function snappedHandle(
  point: readonly [number, number],
  handle: Handle,
  others: readonly Pixels[],
  reach = SNAP_REACH,
): { readonly point: readonly [number, number]; readonly guides: readonly Guide[] } {
  const x = handle.includes('e') || handle.includes('w') ? nearest([point[0]], linesOf(others, 'x'), reach) : undefined;
  const y = handle.includes('n') || handle.includes('s') ? nearest([point[1]], linesOf(others, 'y'), reach) : undefined;
  return {
    point: [point[0] + (x?.shift ?? 0), point[1] + (y?.shift ?? 0)],
    guides: [...(x === undefined ? [] : [{ axis: 'x' as const, at: x.at }]), ...(y === undefined ? [] : [{ axis: 'y' as const, at: y.at }])],
  };
}

/** The box around several: what a move of a selection lines up as one. */
export function around(boxes: readonly Pixels[]): Pixels | undefined {
  if (boxes.length === 0) return undefined;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}
