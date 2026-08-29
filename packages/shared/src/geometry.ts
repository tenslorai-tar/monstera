import { type Brand, brandValue } from './brand.js';

/**
 * The five coordinate spaces, and the ONE thing permitted to convert between
 * them.
 *
 * `brand.ts` states the failure this exists to prevent: every space is
 * `{x, y}`, structural typing accepts any of them wherever another is expected,
 * *"and the resulting bug is invisible — a y-flip that silently assumes
 * rotation 0 and a zero CropBox origin renders correctly on the majority of
 * documents and wrongly on the rest."*
 *
 * ## Why a bare y-flip is banned rather than discouraged
 *
 * `height - y` is correct exactly when the page has no rotation and its CropBox
 * starts at the origin. Most pages do. **A conversion that is right on the easy
 * shape and wrong on the hard one is the worst kind**, because the first
 * hundred documents confirm it. {@link PageTransform} is the only thing that
 * may perform the flip, and it performs it with the rotation and the origin in
 * hand — so the illegal state is unrepresentable rather than checked (B5).
 *
 * ## The four numbers a transform needs, and where each comes from
 *
 * - the **CropBox**, which is the visible region and is NOT always at the
 *   origin, and which a page may inherit from an ancestor `Pages` node rather
 *   than declare;
 * - `/Rotate`, likewise inheritable, in degrees, normalised to one of four
 *   quarter turns;
 * - the **scale** the viewport is drawn at;
 * - nothing else. A transform that needed the document would be a transform
 *   that could not be tested.
 *
 * Inheritance is resolved before a transform is built, by whoever reads the
 * page tree. This module never walks a page tree: it is pure arithmetic, and
 * mixing the two would make every geometry case need a document.
 */

/** A point in PDF user space: y-up, origin at the CropBox's lower-left. */
export type PdfPoint = Brand<{ readonly x: number; readonly y: number }, 'PdfPoint'>;

/** A point in MuPDF's space: y-down, origin at the CropBox's upper-left. */
export type FitzPoint = Brand<{ readonly x: number; readonly y: number }, 'FitzPoint'>;

/** A point in CSS pixels within the rendered page box: y-down, scaled, rotated. */
export type ViewportPoint = Brand<{ readonly x: number; readonly y: number }, 'ViewportPoint'>;

/** A point inside a form XObject's own space, before its `/Matrix` is applied. */
export type XObjectPoint = Brand<{ readonly x: number; readonly y: number }, 'XObjectPoint'>;

/** A point in device pixels of a raster, including the device pixel ratio. */
export type RasterPoint = Brand<{ readonly x: number; readonly y: number }, 'RasterPoint'>;

export const pdfPoint = (x: number, y: number): PdfPoint =>
  brandValue<{ readonly x: number; readonly y: number }, 'PdfPoint'>({ x, y });
export const fitzPoint = (x: number, y: number): FitzPoint =>
  brandValue<{ readonly x: number; readonly y: number }, 'FitzPoint'>({ x, y });
export const viewportPoint = (x: number, y: number): ViewportPoint =>
  brandValue<{ readonly x: number; readonly y: number }, 'ViewportPoint'>({ x, y });
export const xObjectPoint = (x: number, y: number): XObjectPoint =>
  brandValue<{ readonly x: number; readonly y: number }, 'XObjectPoint'>({ x, y });
export const rasterPoint = (x: number, y: number): RasterPoint =>
  brandValue<{ readonly x: number; readonly y: number }, 'RasterPoint'>({ x, y });

/** The quarter turns `/Rotate` may take, after normalisation. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * A rectangle in PDF user space, as the four numbers a `/CropBox` array holds.
 *
 * Not normalised on construction, because a PDF's boxes are *"specified by any
 * two diagonally opposite corners"* — so a stored box may run right-to-left or
 * top-to-bottom, and normalising is {@link pageTransform}'s job rather than the
 * caller's. A caller that had to normalise first would be a caller
 * reimplementing the rule.
 */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Normalises `/Rotate` to a quarter turn.
 *
 * The specification allows any multiple of 90, positive or negative, and real
 * documents carry `-90` and `450`. **A value that is not a multiple of 90 is
 * treated as 0**, which is what a viewer must do: refusing to render a page
 * because its rotation is malformed is worse than rendering it upright, and
 * this is the one place in the pipeline that can make that choice once.
 */
export function normaliseRotation(degrees: number): Rotation {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return 0;
  const turn = (((degrees / 90) % 4) + 4) % 4;
  return ([0, 90, 180, 270] as const)[turn] ?? 0;
}

/**
 * Everything needed to move a point between spaces for ONE page at ONE zoom.
 *
 * Built by {@link pageTransform}, never by hand: the constructor normalises the
 * box and the rotation, and a hand-built transform would be a second place
 * those rules live.
 */
export interface PageTransform {
  /** The visible box, normalised so `x0 <= x1` and `y0 <= y1`. */
  readonly crop: Box;
  /** The quarter turn this page is displayed at. */
  readonly rotation: Rotation;
  /** CSS pixels per PDF unit. */
  readonly scale: number;
  /** Device pixels per CSS pixel. */
  readonly pixelRatio: number;
  /** The viewport's size in CSS pixels, after rotation and scale. */
  readonly viewport: { readonly width: number; readonly height: number };
}

/**
 * Builds a page's transform.
 *
 * @param crop the `/CropBox`, in the order it appears in the file — corners may
 *   be given diagonally either way round, and are normalised here
 * @param rotate `/Rotate` in degrees, already resolved through inheritance
 * @param scale CSS pixels per PDF unit
 * @param pixelRatio device pixels per CSS pixel; 1 unless a raster is involved
 */
export function pageTransform(
  crop: Box,
  rotate: number,
  scale: number,
  pixelRatio = 1,
): PageTransform {
  const normalised: Box = {
    x0: Math.min(crop.x0, crop.x1),
    y0: Math.min(crop.y0, crop.y1),
    x1: Math.max(crop.x0, crop.x1),
    y1: Math.max(crop.y0, crop.y1),
  };
  const rotation = normaliseRotation(rotate);
  const width = (normalised.x1 - normalised.x0) * scale;
  const height = (normalised.y1 - normalised.y0) * scale;
  // A quarter turn swaps the viewport's axes. This is the reason a "page size"
  // read straight from the CropBox is wrong for a rotated page — and it is
  // wrong in a way that looks like a layout bug rather than a geometry one.
  const swapped = rotation === 90 || rotation === 270;
  return {
    crop: normalised,
    rotation,
    scale,
    pixelRatio,
    viewport: swapped ? { width: height, height: width } : { width, height },
  };
}

/**
 * PDF user space to the viewport.
 *
 * The order is fixed and each step exists for a document that breaks without
 * it: translate by the CropBox origin (a page whose visible region does not
 * start at 0,0), flip y (the two spaces disagree about which way is up), scale,
 * then rotate within the viewport's own box.
 */
export function toViewport(point: PdfPoint, transform: PageTransform): ViewportPoint {
  const { crop, rotation, scale, viewport } = transform;
  const x = (point.x - crop.x0) * scale;
  // THE ONLY Y-FLIP IN THE APPLICATION. It subtracts from the CropBox's top
  // rather than from a page height, which is the whole difference between this
  // and the banned inline version.
  const y = (crop.y1 - point.y) * scale;

  switch (rotation) {
    case 0:
      return viewportPoint(x, y);
    case 90:
      return viewportPoint(viewport.width - y, x);
    case 180:
      return viewportPoint(viewport.width - x, viewport.height - y);
    case 270:
      return viewportPoint(y, viewport.height - x);
    default: {
      const unhandled: never = rotation;
      return unhandled;
    }
  }
}

/**
 * The viewport back to PDF user space — the inverse of {@link toViewport}.
 *
 * Present because every pointer event arrives in viewport space and every
 * annotation is stored in user space, so the round trip is the common path
 * rather than a convenience. Its cases assert the ROUND TRIP rather than
 * hand-computed numbers, which is what makes an error in both directions
 * impossible to write into the expectations.
 */
export function toPdf(point: ViewportPoint, transform: PageTransform): PdfPoint {
  const { crop, rotation, scale, viewport } = transform;

  let x: number;
  let y: number;
  switch (rotation) {
    case 0:
      x = point.x;
      y = point.y;
      break;
    case 90:
      x = point.y;
      y = viewport.width - point.x;
      break;
    case 180:
      x = viewport.width - point.x;
      y = viewport.height - point.y;
      break;
    case 270:
      x = viewport.height - point.y;
      y = point.x;
      break;
    default: {
      const unhandled: never = rotation;
      return unhandled;
    }
  }
  return pdfPoint(x / scale + crop.x0, crop.y1 - y / scale);
}

/**
 * PDF user space to MuPDF's space.
 *
 * Both are unscaled and unrotated; they differ only in which way y runs and
 * where the origin sits. Kept separate from {@link toViewport} because a
 * conversion that went through the viewport would pick up the zoom, and a
 * kernel-side coordinate that varied with the user's zoom is the defect this
 * separation prevents.
 */
export function toFitz(point: PdfPoint, transform: PageTransform): FitzPoint {
  return fitzPoint(point.x - transform.crop.x0, transform.crop.y1 - point.y);
}

/** MuPDF's space back to PDF user space. */
export function fromFitz(point: FitzPoint, transform: PageTransform): PdfPoint {
  return pdfPoint(point.x + transform.crop.x0, transform.crop.y1 - point.y);
}

/**
 * The viewport to a raster's device pixels.
 *
 * A separate space rather than a scale factor on the viewport, because the
 * device pixel ratio changes when a window moves between monitors while the
 * zoom does not — and a single number that both of them wrote is the one-writer
 * violation that produces a half-resolution page nobody can reproduce.
 */
export function toRaster(point: ViewportPoint, transform: PageTransform): RasterPoint {
  return rasterPoint(point.x * transform.pixelRatio, point.y * transform.pixelRatio);
}

/** A raster's device pixels back to the viewport. */
export function fromRaster(point: RasterPoint, transform: PageTransform): ViewportPoint {
  return viewportPoint(point.x / transform.pixelRatio, point.y / transform.pixelRatio);
}

/**
 * A form XObject's own space to the page's, through the XObject's `/Matrix`.
 *
 * The matrix is `[a b c d e f]` exactly as the file stores it, so nothing here
 * reorders it — a transposed matrix is the classic mistake, and it renders
 * *nearly* right for the common case where `b` and `c` are both zero.
 */
export function fromXObject(
  point: XObjectPoint,
  matrix: readonly [number, number, number, number, number, number],
): PdfPoint {
  const [a, b, c, d, e, f] = matrix;
  return pdfPoint(a * point.x + c * point.y + e, b * point.x + d * point.y + f);
}
