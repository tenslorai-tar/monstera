import {
  MAX_IMAGE_QUALITY,
  MAX_SNAPSHOT_SCALE,
  MIN_IMAGE_QUALITY,
  MIN_SNAPSHOT_SCALE,
  type PageImageFormat,
} from '@monstera/contract';
import { ColorSpace, Matrix, type Pixmap } from 'mupdf';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';
import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';
import { encodeWebp } from './webpEncoder.js';

/**
 * A whole page rasterised to an image file — D10's *Pages → PNG / JPEG / WebP*.
 *
 * ## MuPDF rasterises all three; WebP alone is encoded by something else
 *
 * `Print & export rasterisation | MuPDF`. The pixmap encodes PNG and JPEG
 * itself, `asPNG` and `asJPEG(quality)`. It has no WebP writer, so §3's
 * *Page image → WebP encoding* row takes the same pixmap's pixels to libwebp
 * ([ADR-0070](../../../docs/DECISIONS/0070-a-page-image-is-encoded-as-webp-by-libwebps-wasm-in-the-engine-host.md))
 * — one rasteriser for every format, so a WebP cannot differ from a PNG of the
 * same page in anything but its encoding.
 *
 * ## `showExtras` IS `true`, and that was measured
 *
 * An export is a picture of how the page looks, and a person's highlight is
 * part of that — `pageSnapshot.ts`'s reason for `run` over `runPageContents`.
 * Measured 2026-09-14 on MuPDF 1.28.0: on a page with a red Square annotation,
 * `toPixmap(…, showExtras=true)` drew 4096 red pixels, `false` drew none, and
 * the snapshot's own `run` route drew the same 4096. The blue content square
 * read 3600 in all three, so the difference is the annotation.
 *
 * ## The pixel bound is checked BEFORE the pixmap exists
 *
 * `toPixmap` allocates as it is called, so a bound checked on its answer has
 * already paid for what it refuses. The size is computed from the page's
 * rotated bounds and rounded UP, which can refuse a page a pixel over the
 * rasteriser's own rounding and never admits one past it.
 *
 * ## Nothing crosses the pipe
 *
 * The bytes are written into the granted output directory by the host, as a
 * snapshot's and an extract's are.
 */

/** What one page's export is asked for. */
export interface PageImageRequest {
  /** Zero-based. */
  readonly page: number;
  readonly format: PageImageFormat;
  /** Device pixels per PDF point — the dialog's DPI over 72. */
  readonly scale: number;
  /** A JPEG's or a WebP's quality, 1–100. A PNG ignores it. */
  readonly quality: number;
}

/**
 * One page, encoded.
 *
 * @throws `RangeError` for a page this document does not have, a page that
 *   displays no region, a scale or quality outside its bounds, or an image past
 *   {@link MAX_SNAPSHOT_PIXELS}.
 */
export async function rasterisePageImage(
  session: MupdfSession,
  request: PageImageRequest,
): Promise<ByteImage> {
  const drawn = await withDocument(session, (document): ByteImage | RgbaImage => {
    const total = document.countPages();
    if (!Number.isInteger(request.page) || request.page < 0 || request.page >= total) {
      throw new RangeError(
        `Page ${String(request.page)} is outside this document, which has ${String(total)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
    if (
      !Number.isFinite(request.scale) ||
      request.scale < MIN_SNAPSHOT_SCALE ||
      request.scale > MAX_SNAPSHOT_SCALE
    ) {
      throw new RangeError(
        `a page image scale of ${String(request.scale)} is outside ` +
          `${String(MIN_SNAPSHOT_SCALE)}–${String(MAX_SNAPSHOT_SCALE)} device pixels per point`,
      );
    }
    if (
      !Number.isInteger(request.quality) ||
      request.quality < MIN_IMAGE_QUALITY ||
      request.quality > MAX_IMAGE_QUALITY
    ) {
      throw new RangeError(
        `an image quality of ${String(request.quality)} is outside ` +
          `${String(MIN_IMAGE_QUALITY)}–${String(MAX_IMAGE_QUALITY)}`,
      );
    }

    const page = document.loadPage(request.page);
    // `recognisePage`'s refusal and its reason: MuPDF falls back to US Letter for
    // a page with no usable box, which would export a blank sheet the document
    // does not have.
    if (displayedBox(page.getObject()) === null) {
      throw new RangeError(
        `page ${String(request.page)} displays no region, so there is nothing to export — it ` +
          'has no /MediaBox of four numbers, or its /CropBox and /MediaBox do not overlap',
      );
    }

    const [x0, y0, x1, y1] = page.getBounds();
    const width = Math.ceil((x1 - x0) * request.scale);
    const height = Math.ceil((y1 - y0) * request.scale);
    if (width * height > MAX_SNAPSHOT_PIXELS) {
      throw new RangeError(
        `page ${String(request.page)} at this resolution is ${String(width)}×${String(height)}, ` +
          `${String(width * height)} pixels, past the ${String(MAX_SNAPSHOT_PIXELS)} allowed`,
      );
    }

    const pixmap = page.toPixmap(
      Matrix.scale(request.scale, request.scale),
      ColorSpace.DeviceRGB,
      // NO ALPHA, for the snapshot's reason: a page is paper, and a transparent
      // background is a hole in an image most people paste onto something white.
      false,
      true,
    );
    try {
      switch (request.format) {
        case 'png':
          return pixmap.asPNG();
        case 'jpeg':
          // `false`: the CMYK inversion flag, which an RGB pixmap does not reach.
          return pixmap.asJPEG(request.quality, false);
        case 'webp':
          return rgbaOf(pixmap);
      }
    } finally {
      // The large allocation, in the wasm heap the collector does not see.
      pixmap.destroy();
    }
  });
  if (drawn instanceof Uint8Array) return drawn;
  return await encodeWebp(drawn.rgba, drawn.width, drawn.height, request.quality);
}

/** A page's pixels in the layout libwebp takes: four bytes a pixel, opaque. */
interface RgbaImage {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * The pixmap's RGB widened to RGBA, COPIED out of the engine's heap.
 *
 * `getPixels` answers a view into MuPDF's WASM memory, which `destroy` frees in
 * the `finally` above — so the copy is made here, before that runs, and the
 * encoder never reads memory the engine may reuse. The pixmap was drawn with no
 * alpha for the snapshot's reason (a page is paper), so every alpha is 255.
 */
function rgbaOf(pixmap: Pixmap): RgbaImage {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const components = pixmap.getNumberOfComponents();
  // BOTH ARE READ, NOT ASSUMED: the loop below walks three bytes a pixel with no
  // row padding, and a pixmap that had either would be encoded as a sheared image.
  if (components !== 3 || pixmap.getStride() !== width * 3) {
    throw new Error(
      `a page pixmap for WebP has ${String(components)} components and a stride of ` +
        `${String(pixmap.getStride())}; an opaque RGB page ${String(width)} wide has 3 and ${String(width * 3)}`,
    );
  }
  const pixels = pixmap.getPixels();
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let from = 0, to = 0; to < rgba.length; from += 3, to += 4) {
    rgba[to] = pixels[from] ?? 0;
    rgba[to + 1] = pixels[from + 1] ?? 0;
    rgba[to + 2] = pixels[from + 2] ?? 0;
    rgba[to + 3] = 255;
  }
  return { rgba, width, height };
}
