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
