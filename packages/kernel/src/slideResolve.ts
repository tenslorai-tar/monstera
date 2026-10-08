import { pageTransform, pdfPoint, toViewport } from '@monstera/shared';

import type { EmbeddedSource, ResolvedSlide } from './editableSlide.js';
import type { ContentBounds, ContentFrame } from './presentationContent.js';
import { encodePng } from './pageContentAssemble.js';
import type { EditableSlide, SlideObject } from './slideModel.js';

/**
 * The pictures of an editable slide that are not bytes yet, made into bytes
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)
 * Decisions 6 and 7).
 *
 * `slideModel.ts` says WHERE a picture comes from and cannot make it: a cut is a rectangle of the page rendered with no text,
 * and the page behind a scan is the page as drawn. Those need an engine, so the caller supplies them as functions and this
 * walks the slide once. A slide whose picture cannot be made is not half written: a resolver that throws fails the page,
 * which the caller writes as Exact look.
 */

/** How the two kinds of unresolved picture are made. */
export interface PictureResolvers {
  /** A rectangle of the page, in page space, from a render with no text in it. */
  readonly cut: (region: ContentBounds) => Promise<EmbeddedSource>;
  /** The whole page as it is drawn: the picture under a scan's recognised text. */
  readonly page: () => Promise<EmbeddedSource>;
}

/** Every picture of `slide` as bytes, in the same order. */
export async function resolveSlide(slide: EditableSlide, resolvers: PictureResolvers): Promise<ResolvedSlide> {
  const objects: SlideObject<EmbeddedSource>[] = [];
  for (const object of slide.objects) {
    if (object.kind !== 'picture') {
      objects.push(object);
      continue;
    }
    const { source } = object;
    const resolved =
      source.kind === 'embedded' ? source : source.kind === 'cut' ? await resolvers.cut(source.region) : await resolvers.page();
    objects.push({ ...object, source: resolved });
  }
  return { objects };
}

/** A render as the engine hands it: BGRA, row after row. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly bgra: Uint8Array;
}

/**
 * A region of a page, cut out of a render of that whole page, as a PNG.
 *
 * The region is in PAGE space and the render is of the page as DISPLAYED, so the corners go through `toViewport` (the CropBox
 * origin and the quarter turn) and are then scaled by the render's own ratio to the viewport. The pixel box is rounded
 * OUTWARD, so a thin line is never cut to nothing, and clamped to the render.
 *
 * @throws when the region lies outside the render altogether, which is a page the caller should write as Exact look
 */
export function cutFromRaster(raster: Raster, frame: ContentFrame, region: ContentBounds): EmbeddedSource {
  const transform = pageTransform(frame.crop, frame.rotation, 1);
  const sx = raster.width / transform.viewport.width;
  const sy = raster.height / transform.viewport.height;
  const corners = [
    toViewport(pdfPoint(region.left, region.bottom), transform),
    toViewport(pdfPoint(region.right, region.bottom), transform),
    toViewport(pdfPoint(region.left, region.top), transform),
    toViewport(pdfPoint(region.right, region.top), transform),
  ];
  const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) * sx));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) * sy));
  const right = Math.min(raster.width, Math.ceil(Math.max(...corners.map((c) => c.x)) * sx));
  const bottom = Math.min(raster.height, Math.ceil(Math.max(...corners.map((c) => c.y)) * sy));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error('the region to cut lies outside the page render');
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((top + row) * raster.width + left) * 4;
    out.set(raster.bgra.subarray(from, from + width * 4), row * width * 4);
  }
  return { kind: 'embedded', extension: 'png', bytes: encodePng(width, height, out) };
}
