import type { AnnotationRect } from '@monstera/contract';
import { ColorSpace, DrawDevice, Matrix, Pixmap } from 'mupdf';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { frameOf, placedRect } from './pageAnnotations.js';

/**
 * Rasterising a REGION of a page to a PNG — D3's *snapshot region to PNG*.
 *
 * ## `toPixmap`'s `box` is a page-box NAME, and that is what shapes this module
 *
 * The obvious call is `page.toPixmap(matrix, colorspace, alpha, extras, usage,
 * box)`, and its last parameter reads like a rectangle. It is not: measured
 * 2026-09-07, `box` takes one of `MediaBox`, `CropBox`, `BleedBox`, `TrimBox`
 * or `ArtBox`, so it selects which of the page's five declared boxes to render
 * and cannot express an arbitrary region.
 *
 * What can is a {@link Pixmap} constructed **at the region's own bounds** with a
 * {@link DrawDevice} over it: MuPDF clips drawing to the pixmap's box and the
 * pixmap carries its origin, so running the page into one produces exactly the
 * region and nothing else. Measured the same day on a page whose four quadrants
 * are four colours — a pixmap at `[0, 0, 100, 150]` comes back 100×150 with
 * blue in both corners, one at `[100, 150, 200, 300]` comes back with green,
 * and a pixmap one pixel narrower comes back 99 wide.
 *
 * ## The region arrives in PDF user space, like every other payload
 *
 * A drag becomes a rectangle through the one adapter, so the command carries
 * PDF user space and this converts. It converts through `placedRect` and
 * `frameOf` rather than repeating the arithmetic, which is the point: those two
 * are what `applyPlaceAnnotation` maps a placement out of, and a second opinion
 * about *where on the page is this rectangle* would put a snapshot and an
 * annotation drawn from the same drag in different places (B3a).
 *
 * ## Nothing crosses the pipe
 *
 * The PNG is built in the engine host and written into the granted output
 * directory, exactly as an extract's bytes are — invariant L11's *no raster
 * crosses* is not a bound to state here, it is a route not taken.
 */

/**
 * The largest snapshot that may be rasterised, in pixels.
 *
 * A bound rather than trust, and on the PIXEL COUNT rather than on either
 * dimension: a region is a rectangle a person drags and a scale is a number,
 * and the product is what allocates. Four bytes a pixel makes this 128 MB of
 * pixmap, which is a large image and not a hostile one — an A4 page at 600 dpi
 * is about 35 megapixels, so the bound is well clear of the biggest thing a
 * reader would ask for and well short of a number that ends the host.
 *
 * The refusal names the count, because *too large* with no figure leaves the
 * reader unable to tell a slip from a limit.
 */
export const MAX_SNAPSHOT_PIXELS = 32_000_000;

/**
 * How many device pixels one PDF point becomes.
 *
 * Bounded on both sides for two different reasons. Below 1 the snapshot is
 * coarser than the page's own points, which is a picture of a picture and not
 * what anybody drags a region for; above 8 the pixel bound above is reached by
 * quite ordinary regions, and a refusal at that end reads as the feature being
 * broken rather than as a scale being silly. Eight is 576 dpi.
 */
export const MIN_SNAPSHOT_SCALE = 1;
export const MAX_SNAPSHOT_SCALE = 8;

/**
 * What a snapshot is asked for.
 *
 * **`RegionRequest` AND NOT `SnapshotRequest`**, which is not fussiness: this
 * repository already uses *snapshot* for the canonical byte image a session is
 * opened from — `snapshotDirectory`, `snapshotName`, `SnapshotWrite` — and the
 * two would sit in the same import block. The user's word for this feature is
 * *snapshot* and the founding record's is too, so it is kept where a person
 * reads it and paired with *region* everywhere a reader might take the other
 * meaning.
 */
export interface RegionRequest {
  readonly page: number;
  /** The region, in PDF user space, as the drag produced it — need not be ordered. */
  readonly rect: AnnotationRect;
  /** Device pixels per PDF point. */
  readonly scale: number;
}

/**
 * The region's bounds in device space, as a pixmap takes them.
 *
 * Rounded OUTWARD, so a region whose edges fall between pixels includes every
 * pixel it touches rather than clipping the last row. The alternative — round
 * to nearest — loses a column on one edge and gains one on the other depending
 * on where the drag happened to land, which is a snapshot whose size moves for
 * reasons the person cannot see.
 */
function deviceBox(
  displayed: readonly [number, number, number, number],
  scale: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = displayed;
  return [
    Math.floor(x0 * scale),
    Math.floor(y0 * scale),
    Math.ceil(x1 * scale),
    Math.ceil(y1 * scale),
  ];
}

/**
 * A region of a page, as PNG bytes.
 *
 * @throws `RangeError` for a page this document does not have, a page that
 *   displays no region, a scale outside the bounds, a region with no extent, or
 *   a snapshot past {@link MAX_SNAPSHOT_PIXELS}.
 */
export function snapshotRegion(
  session: MupdfSession,
  request: RegionRequest,
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
        `a snapshot scale of ${String(request.scale)} is outside ` +
          `${String(MIN_SNAPSHOT_SCALE)}–${String(MAX_SNAPSHOT_SCALE)} device pixels per point`,
      );
    }

    const loaded = document.loadPage(request.page);
    const frame = frameOf(loaded);
    if (frame === null) {
      throw new RangeError(
        'this page displays no region — it has no /MediaBox of four numbers, or its /CropBox ' +
          'and /MediaBox do not overlap — so there is nothing to snapshot',
      );
    }

    const box = deviceBox(placedRect(request.rect, frame), request.scale);
    const [x0, y0, x1, y1] = box;
    const width = x1 - x0;
    const height = y1 - y0;
    // A DRAG THAT DID NOT TRAVEL, and it is refused rather than answered with a
    // zero-pixel PNG: `new Pixmap` accepts an empty box and `asPNG` produces a
    // file no viewer will open, which is a snapshot that succeeded and shows
    // nothing.
    if (width <= 0 || height <= 0) {
      throw new RangeError('a region with no width or no height has nothing to snapshot');
    }
    if (width * height > MAX_SNAPSHOT_PIXELS) {
      throw new RangeError(
        `a snapshot of ${String(width)}×${String(height)} is ` +
          `${String(width * height)} pixels, past the ${String(MAX_SNAPSHOT_PIXELS)} allowed`,
      );
    }

    const pixmap = new Pixmap(ColorSpace.DeviceRGB, box, false);
    try {
      // WHITE, not transparent and not black. A PDF page is paper, and the
      // parts of a region no content covers are the paper showing through — a
      // zeroed pixmap would put black there, and an alpha channel would put a
      // hole in a snapshot most people paste into something opaque.
      pixmap.clear(255);
      const device = new DrawDevice(Matrix.identity, pixmap);
      try {
        // `run` AND NOT `runPageContents`, which is the difference between a
        // snapshot and a print of the page's content stream: a person dragging
        // a region over their own highlight expects the highlight in it.
        loaded.run(device, [request.scale, 0, 0, request.scale, 0, 0]);
      } finally {
        device.close();
        device.destroy();
      }
      return pixmap.asPNG();
    } finally {
      // THE PIXMAP IS THE LARGE ALLOCATION HERE — up to MAX_SNAPSHOT_PIXELS
      // times four bytes in the wasm heap, which the garbage collector does not
      // see. `copiedOut`'s reason, on a different object.
      pixmap.destroy();
    }
  });
}
