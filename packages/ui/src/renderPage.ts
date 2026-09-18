import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Rasterises one page onto a canvas.
 *
 * ## The viewport comes from PDF.js, and that is B3a rather than laziness
 *
 * A page's rendering box is decided by its `/MediaBox`, its `/CropBox`, an
 * inherited `/Rotate` and the intersection rules between them — and PDF.js
 * already implements that, in `page.getViewport`. Computing a width and height
 * here from the page's boxes would be a second opinion about a question the
 * parser owns, agreeing with it most of the time, which is the shape B3a names
 * as dangerous.
 *
 * This is **not** the branded-coordinate seam and must not grow into one.
 * `PageTransform` in `@monstera/shared` converts between the five spaces for
 * everything the application computes — an annotation's corner, a hit test — and
 * its job is that nothing performs a bare y-flip. Rasterising a page performs no
 * conversion at all: the viewport goes in and pixels come out.
 *
 * ## The ROTATION is the one thing the parser is overruled about
 *
 * Everything above takes the parser's answer as given. The rotation does not,
 * and finding OOOOO-1 is why: a command's effect lands in the engine session,
 * and a rotate — the one command declared `'view-model'` (ADR-0084) — replaces
 * no image, so the bytes this parser reads keep the `/Rotate` they were opened
 * or last refreshed with. Every other command makes the session's bytes main's
 * image, which is why only this one value is overruled.
 *
 * The view model carries the kernel's answer (`docs/ARCHITECTURE.md` §2), and
 * `page.getViewport({ rotation })` **replaces** the page's rotation rather than
 * adding to it — measured by `proof:viewportrotation` rather than read off the
 * declaration. That is §3.2 working as written rather than an exception to it:
 * *PDF.js is never a source of truth. It renders.*
 */

/** What a rasterised page came out as, in device pixels. */
/**
 * Draws a page with the OTHER engine, or answers `null` to let PDF.js draw it.
 *
 * ## `null` is the load-bearing half
 *
 * §6.1's setting can be on while the second engine is not available: a build
 * with no `pdfium.dll` is a state the Store ships, and a page too large to
 * raster at the current zoom is a refusal a person meets by zooming out. Both
 * must leave a drawn page rather than a blank one, so this answers `null` and
 * the caller falls back — which is why the fallback lives here, in the one
 * function that draws, rather than at each call site deciding for itself.
 *
 * ## An `ImageBitmap`, decoded by the CALLER
 *
 * The channel answers PNG bytes and `createImageBitmap` is Chromium's own
 * decoder. Handing this function a decoded bitmap rather than bytes keeps the
 * decode — which is asynchronous and can fail on its own — outside the function
 * whose failure mode is *the page did not draw*.
 *
 * @param pageNumber 1-based, as PDF.js numbers them and as the caller holds it
 * @param width the canvas's device width, which the raster must match exactly
 * @param height the canvas's device height
 */
export type SecondRasteriser = (
  pageNumber: number,
  width: number,
  height: number,
) => Promise<ImageBitmap | null>;

export interface RasterisedPage {
  readonly width: number;
  readonly height: number;
  /**
   * The page's visible box in PDF user space, as `[x0, y0, x1, y1]`.
   *
   * **Reported rather than computed by the caller**, and it is the same B3a
   * argument the note above makes about the viewport: `page.view` is PDF.js'
   * answer to *what region does this page display*, with the `/MediaBox`,
   * `/CropBox` and their intersection already applied. An overlay that read the
   * boxes itself would be a second opinion agreeing on every ordinary document.
   *
   * It comes out of here rather than from a second `getPage` because this
   * function has already parsed the page, and a caller asking again would be
   * asking a question whose answer it was standing next to.
   */
  readonly crop: readonly [number, number, number, number];
  /**
   * The rotation this page was actually drawn at, in degrees.
   *
   * The caller's `rotation` when it supplied one and the page's own `/Rotate`
   * when it did not — which is the point: an overlay placing a shape has to use
   * the rotation the bitmap underneath it was drawn at, and *what the caller
   * passed* is not that whenever the caller passed nothing.
   */
  readonly rotation: number;
}

/**
 * A draw that was superseded before it finished — its `signal` aborted.
 *
 * Not a failure, and named so a caller can tell the two apart: a page whose draw was replaced
 * by a newer one is being drawn, and marking it failed would put a broken-page marker on a page
 * that is about to appear.
 */
export class RenderCancelledError extends Error {
  constructor(pageNumber: number) {
    super(`the draw of page ${String(pageNumber)} was superseded before it finished`);
    this.name = 'RenderCancelledError';
  }
}

/**
 * Draws page `pageNumber` (1-based, as PDF.js numbers them) at `scale`.
 *
 * The canvas is sized to the viewport before drawing. Sizing it afterwards
 * would clear it — setting `width` or `height` resets the drawing surface —
 * which renders a blank page and looks exactly like a parse that produced
 * nothing.
 *
 * @param rotation the page's ABSOLUTE rotation from the view model, in degrees.
 *   `undefined` where the model has not answered for this version, in which
 *   case the page's own `/Rotate` decides — see the note above on why that is
 *   not the same as `0`.
 *
 *   **REQUIRED, and `undefined` must be written.** It was optional, and two of
 *   the three surfaces that draw a page — the thumbnail strip and the loupe —
 *   omitted it. Both compiled, both drew the rotation the file OPENED at, and
 *   every case on both was green because each asserted the page and the scale.
 *   A parameter that may be left out is one a caller can forget in silence;
 *   one that must be named makes the forgetting a compile error (B5, the shape
 *   ADR-0069 gave the writer seam for the same reason).
 * @param signal aborted when this draw is superseded — a caller's effect cleanup.
 *   **REQUIRED, for `rotation`'s reason.** PDF.js refuses a second render on a
 *   canvas a first one still holds (*"Cannot use the same canvas during multiple
 *   render() operations"*), and every caller's cleanup used to set a flag and
 *   leave the first task running. So a redraw — a new view after a command, a
 *   rotation arriving — was refused, and the empty catch in the thumbnail strip
 *   dropped the refusal: measured over the debugging port 2026-09-18, the strip
 *   left thumbnails at the full page size the interrupted first pass had set.
 *   Aborting cancels the task, which releases the canvas synchronously, and a
 *   draw that sees the abort before touching the canvas never resizes it.
 * @throws {@link RenderCancelledError} when `signal` aborted, and nothing else
 *   for that case, so a caller can ignore exactly the superseded draws.
 */
export async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number | { readonly fitWidth: number },
  rotation: number | undefined,
  signal: AbortSignal,
  raster?: SecondRasteriser,
): Promise<RasterisedPage> {
  // READ THROUGH A CALL, because the answer changes across every `await` below and a property
  // read is narrowed by the compiler as if it could not: after one `if (signal.aborted)` it
  // types every later read as `false`, and the checks that matter most would read as dead.
  const superseded = (): boolean => signal.aborted;
  const page = await document.getPage(pageNumber);
  // BEFORE THE CANVAS IS TOUCHED: sizing it clears it, so a superseded draw that got this far
  // would wipe the newer one's pixels.
  if (superseded()) throw new RenderCancelledError(pageNumber);
  // OMITTED rather than defaulted to zero when the caller has no model. PDF.js
  // falls back to the page's own rotation, which is right for a document nothing
  // has rotated; passing `0` would flatten every document that arrives already
  // turned, and it would do it silently on the first render.
  const at = (factor: number): ReturnType<typeof page.getViewport> =>
    page.getViewport(rotation === undefined ? { scale: factor } : { scale: factor, rotation });
  // A WIDTH TO FIT is answered from PDF.js' own viewport at scale 1, which sizes the page without
  // drawing it. The thumbnail strip drew the whole page at full size to learn this, and that
  // first pass is what a superseded draw left on its canvas (2026-09-18).
  const viewport = typeof scale === 'number' ? at(scale) : at(scale.fitWidth / at(1).width);

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the page canvas has no 2d context to draw into');
  }

  // THE SECOND ENGINE FIRST WHERE THERE IS ONE, and PDF.js when it answers
  // nothing. See {@link SecondRasteriser}: the fallback is what keeps a machine
  // with no `pdfium.dll` drawing pages, and it is the same canvas either way, so
  // everything below this line is unchanged by which engine drew.
  const drawn = raster === undefined ? null : await raster(pageNumber, canvas.width, canvas.height);
  if (superseded()) {
    drawn?.close();
    throw new RenderCancelledError(pageNumber);
  }
  if (drawn === null) {
    const task = page.render({ canvas, canvasContext: context, viewport });
    const cancel = (): void => {
      task.cancel();
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await task.promise;
    } catch (error) {
      // THE CANCELLATION IS OURS, so it is reported as ours; anything else is the page's.
      if (superseded()) throw new RenderCancelledError(pageNumber);
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  } else {
    // `drawImage` AT 0,0 WITH NO SCALE. The raster was asked for at exactly this
    // canvas's device size, so any scaling here would be resampling a bitmap
    // that is already the right size — the blur E1's whole render clause exists
    // to prevent, arriving through the path that was supposed to sharpen it.
    context.drawImage(drawn, 0, 0);
    drawn.close();
  }
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
  return {
    width: canvas.width,
    height: canvas.height,
    crop: [x0, y0, x1, y1],
    // THE VIEWPORT'S, not the parameter's. They differ exactly when the caller
    // passed nothing and PDF.js fell back to the page's own `/Rotate`, which is
    // the case an overlay must not get wrong.
    rotation: viewport.rotation,
  };
}
