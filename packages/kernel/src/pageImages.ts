import {
  MAX_JPEG_QUALITY,
  MAX_SNAPSHOT_SCALE,
  MIN_JPEG_QUALITY,
  MIN_SNAPSHOT_SCALE,
  type PageImageFormat,
} from '@monstera/contract';
import { ColorSpace, Matrix } from 'mupdf';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';
import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';

/**
 * A whole page rasterised to an image file — D10's *Pages → PNG / JPEG*.
 *
 * ## MuPDF, because §3 says so and nothing else here encodes
 *
 * `Print & export rasterisation | MuPDF`. The pixmap encodes both formats
 * itself, `asPNG` and `asJPEG(quality)`, so there is no encoder to choose.
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
  /** A JPEG's quality, 1–100. A PNG ignores it. */
  readonly quality: number;
}

/**
 * One page, encoded.
 *
 * @throws `RangeError` for a page this document does not have, a page that
 *   displays no region, a scale or quality outside its bounds, or an image past
 *   {@link MAX_SNAPSHOT_PIXELS}.
 */
export function rasterisePageImage(
  session: MupdfSession,
  request: PageImageRequest,
): Promise<ByteImage> {
  return withDocument(session, (document) => {
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
      request.quality < MIN_JPEG_QUALITY ||
      request.quality > MAX_JPEG_QUALITY
    ) {
      throw new RangeError(
        `a JPEG quality of ${String(request.quality)} is outside ` +
          `${String(MIN_JPEG_QUALITY)}–${String(MAX_JPEG_QUALITY)}`,
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
      return request.format === 'png'
        ? pixmap.asPNG()
        : // `false`: the CMYK inversion flag, which an RGB pixmap does not reach.
          pixmap.asJPEG(request.quality, false);
    } finally {
      // The large allocation, in the wasm heap the collector does not see.
      pixmap.destroy();
    }
  });
}
