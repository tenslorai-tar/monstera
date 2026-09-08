import type { AnnotationRect } from '@monstera/contract';
import { type PageTransform, type ViewportPoint, pageTransform, toPdf, viewportPoint } from '@monstera/shared';

/**
 * The renderer's half of the annotation coordinate boundary — Stage 3's
 * *geometry adapter*, and the one place a drag becomes a document rectangle.
 *
 * ## What the boundary is
 *
 * A pointer event arrives in CSS pixels measured **down** from the top-left of
 * the page as it is drawn on screen. An annotation is stored in **PDF user
 * space**: y up, in the page's own units, in the frame the document is written
 * in ({@link AnnotationRect} says why that frame and not either of the two
 * beside it).
 *
 * Between them sit three things that all have to be right at once and none of
 * which is visible at a call site: the y-flip, the zoom, and `/Rotate`. An
 * inline flip assumes rotation 0 and a zero crop origin, which
 * `monstera/no-bare-y-flip` refuses precisely because it is right on the page
 * most people test with.
 *
 * ## Why this is a module and not two lines in the overlay
 *
 * The wired-tools rule's blind spot: a kernel proof and a UI test either side
 * of a boundary can both be green for ever while the unit changes between them.
 * Its remedy is *a third thing that states the correspondence once, and both
 * halves take it from there*. Page indices got `pageNumbering.ts`; this is the
 * coordinate space that rule said would come next.
 *
 * The two halves are `pageAnnotations.ts`, which converts PDF space into
 * MuPDF's, and this, which converts the viewport into PDF space. **They share
 * `PageTransform`**, which is invariant L3's one converter — so the affine
 * arithmetic exists once and neither side writes a flip.
 *
 * ## The two halves build their transform from different parsers, deliberately
 *
 * This one's box comes from PDF.js (`page.view`), because §3.2's rule cuts both
 * ways: PDF.js is never a source of truth about the *document*, and it is the
 * authority on *what it drew*, which is what an overlay sits on top of. The
 * kernel's comes from MuPDF, which is the writer.
 *
 * That is two answers to one question, and it is the arrangement B3a warns
 * about — so it is asserted rather than assumed at the one place they can
 * differ: `pageBoxes.test.ts` maps probe points through this repository's
 * transform and through MuPDF's own matrix and requires them equal, across
 * four rotations, cropped and uncropped. What that check cannot reach is PDF.js
 * disagreeing with both, and the honest statement of the gap is that a page
 * where the two parsers resolve different visible boxes would put the rectangle
 * somewhere the reader did not point. The rotation is not exposed to it —
 * `renderPage` draws at the **view model's** rotation, which is the kernel's own
 * answer, so that term has one source already.
 */

/** A page as the overlay finds it: the box drawn, at the zoom it is drawn at. */
export interface OverlayPage {
  /** The visible box in PDF user space, `[x0, y0, x1, y1]`, from `RasterisedPage`. */
  readonly crop: readonly [number, number, number, number];
  /** The rotation the bitmap under the overlay was drawn at, in degrees. */
  readonly rotation: number;
  /**
   * CSS pixels per PDF unit.
   *
   * The zoom, and **not** `devicePixelRatio × zoom`: the overlay is laid out in
   * CSS pixels and receives pointer events in them, so the bitmap's own
   * resolution is not part of this conversion. `PageTransform` keeps the device
   * ratio as a separate term for exactly that reason — a window moved between
   * displays changes one and not the other.
   */
  readonly zoom: number;
}

/** The transform for a page the overlay is drawn over. */
export function overlayTransform(page: OverlayPage): PageTransform {
  const [x0, y0, x1, y1] = page.crop;
  return pageTransform({ x0, y0, x1, y1 }, page.rotation, page.zoom);
}

/**
 * The same page at **scale 1**, for reading a coordinate the engine reported.
 *
 * ## Why a second transform rather than dividing by the zoom
 *
 * `document.pageTextLayer` answers with boxes in the page's display space at
 * scale 1 — `/Rotate` applied, no zoom — because deriving the crop box
 * main-side would be a second opinion about a question PDF.js owns (B3a, §3).
 * Turning one of those into a CSS position is therefore two conversions: display
 * to PDF at scale 1, then PDF to viewport at the current zoom.
 *
 * The alternative is to multiply the reported box by the zoom, which is correct
 * and is a **third** implementation of a conversion this module already owns —
 * and one whose rotation handling is invisible at rotation 0, which is exactly
 * how the substrate's own brand was wrong for weeks. Two named calls beat one
 * multiplication whose correctness has to be re-derived by every reader.
 */
export function unscaledTransform(page: OverlayPage): PageTransform {
  const [x0, y0, x1, y1] = page.crop;
  return pageTransform({ x0, y0, x1, y1 }, page.rotation, 1);
}

/**
 * Where a pointer is, relative to the page it is over.
 *
 * **Measured from the element's own box** rather than from the page, the
 * scroller or the window: the overlay is laid out exactly over the canvas, so
 * its client rectangle is the page's box on screen, and every other origin is
 * one scroll position away from being wrong.
 */
export function pointerOn(element: Element, clientX: number, clientY: number): ViewportPoint {
  const box = element.getBoundingClientRect();
  return viewportPoint(clientX - box.left, clientY - box.top);
}

/**
 * The rectangle a drag between two viewport points names, in PDF user space.
 *
 * Both corners are converted and **nothing is normalised here**: which corner
 * is smaller changes under rotation, and the kernel normalises where it is
 * already resolving the page against the document's own boxes. Normalising in
 * two places is how the two disagree about a degenerate drag.
 */
export function draggedRect(
  from: ViewportPoint,
  to: ViewportPoint,
  transform: PageTransform,
): AnnotationRect {
  const a = toPdf(from, transform);
  const b = toPdf(to, transform);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}
