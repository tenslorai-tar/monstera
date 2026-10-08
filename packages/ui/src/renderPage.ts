import type { PDFDocumentProxy } from 'pdfjs-dist';

import { holdPage, residentPage } from './pageResidency.js';

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
 * The page is drawn on a canvas nobody sees, sized to the viewport before
 * drawing, and copied onto `canvas` only when whole ({@link present}). Sizing
 * either one after drawing would clear it — setting `width` or `height` resets
 * the drawing surface — which renders a blank page and looks exactly like a
 * parse that produced nothing.
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
  // HELD FOR THE DRAW, and released after it whatever happened (`pageResidency.ts`): the page's decoded images are
  // cleaned once nothing else holds it, so a page drawn once does not keep them for the life of the document.
  const release = holdPage(document, pageNumber);
  try {
    return await drawPage(document, pageNumber, canvas, scale, rotation, signal, raster);
  } finally {
    release();
  }
}

async function drawPage(
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
  residentPage(document, pageNumber, page);
  // BEFORE THE CANVAS IS TOUCHED: sizing it clears it, so a superseded draw that got this far
  // would wipe the newer one's pixels.
  if (superseded()) throw new RenderCancelledError(pageNumber);
  // A WIDTH TO FIT is answered from PDF.js' own viewport at scale 1, which sizes the page without
  // drawing it. The thumbnail strip drew the whole page at full size to learn this, and that first
  // pass is what a superseded draw left on its canvas (2026-09-18).
  const viewport =
    typeof scale === 'number'
      ? viewportOf(page, scale, rotation)
      : viewportOf(page, scale.fitWidth / viewportOf(page, 1, rotation).width, rotation);
  const size = { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
  // ASKED BEFORE ANY DRAWING, so a canvas nobody can draw on refuses the page rather than after a
  // render has been paid for.
  const shown = contextOf(canvas);

  // THE SECOND ENGINE FIRST WHERE THERE IS ONE, and PDF.js when it answers
  // nothing. See {@link SecondRasteriser}: the fallback is what keeps a machine
  // with no `pdfium.dll` drawing pages. Either way the drawing is finished
  // before the canvas on screen is touched — see {@link present}.
  const drawn = raster === undefined ? null : await raster(pageNumber, size.width, size.height);
  if (superseded()) {
    drawn?.close();
    throw new RenderCancelledError(pageNumber);
  }
  if (drawn === null) {
    const scratch = scratchFor(canvas, size);
    try {
      await drawWithPdfjs(page, scratch, contextOf(scratch), viewport, undefined, signal, pageNumber);
      present(canvas, shown, scratch, signal, pageNumber);
    } finally {
      release(scratch);
    }
  } else {
    // AT 0,0 WITH NO SCALE, inside `present`. The raster was asked for at exactly
    // this size, so any scaling would be resampling a bitmap that is already the
    // right size — the blur E1's whole render clause exists to prevent, arriving
    // through the path that was supposed to sharpen it.
    try {
      present(canvas, shown, drawn, signal, pageNumber);
    } finally {
      drawn.close();
    }
  }
  return geometryOf(page, viewport, size);
}

/**
 * Puts a FINISHED drawing on the canvas on screen, in one synchronous step.
 *
 * ## Why every draw goes through here
 *
 * Sizing a canvas clears it, and PDF.js paints across several tasks. Drawing
 * straight onto the canvas on screen therefore showed a page cleared, then
 * painted white, then whole, and the browser composites whichever of those
 * stands at each frame. That is the blank-then-redraw a person saw on every
 * edit, on every thumbnail, and on every zoom that settled (the owner's review
 * of 0.1.6.0, 2026-10-01).
 *
 * So the drawing happens on a canvas nobody sees and arrives here whole. The
 * resize and the copy run in the same task, and a frame is painted only between
 * tasks, so no frame can show the cleared canvas between them: until this runs
 * the previous drawing stays on screen, which E1 already permits while a zoom
 * settles. A superseded draw is refused here too, so it never replaces the
 * pixels of the draw that superseded it.
 *
 * The cost is one page's bitmap twice for the length of a draw (computed, not
 * measured: a Letter page at 1.5 device pixels and 100% is 918 × 1188 × 4 bytes,
 * about 4.4 MB), released as
 * soon as the copy is made. A page past the tile threshold is drawn in tiles, so
 * that figure is bounded by the tile size, not by the zoom.
 */
function present(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  drawing: HTMLCanvasElement | ImageBitmap,
  signal: AbortSignal,
  pageNumber: number,
): void {
  if (signal.aborted) {
    console.warn(`TRACE present refused (aborted) p${String(pageNumber)}`);
    throw new RenderCancelledError(pageNumber);
  }
  canvas.width = drawing.width;
  canvas.height = drawing.height;
  context.drawImage(drawing, 0, 0);
  try {
    let inked = 0;
    for (let gy = 1; gy < 9; gy += 1) {
      for (let gx = 1; gx < 9; gx += 1) {
        const px = context.getImageData(Math.floor((canvas.width * gx) / 9), Math.floor((canvas.height * gy) / 9), 1, 1).data;
        if (px[0] !== 255 || px[1] !== 255 || px[2] !== 255) inked += 1;
      }
    }
    console.warn(`TRACE present p${String(pageNumber)} ${String(drawing.width)}x${String(drawing.height)} shown ink ${String(inked)}/64 @${String(Math.round(performance.now()))}`);
  } catch (probeError) {
    console.warn(`TRACE present probe failed ${String(probeError)}`);
  }
}

/** A canvas nobody sees, at `size`, from the document the canvas on screen lives in. */
function scratchFor(canvas: HTMLCanvasElement, size: { readonly width: number; readonly height: number }): HTMLCanvasElement {
  const scratch = canvas.ownerDocument.createElement('canvas');
  scratch.width = size.width;
  scratch.height = size.height;
  return scratch;
}

/**
 * Drops a scratch canvas's backing store now rather than at collection: a detached canvas holds a page-sized
 * bitmap until the collector reaches it, and a scroll starts many draws in a row.
 */
function release(scratch: HTMLCanvasElement): void {
  scratch.width = 0;
  scratch.height = 0;
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the page canvas has no 2d context to draw into');
  }
  return context;
}

type PdfPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;

/**
 * The page's viewport at `scale`: the caller's rotation, or the page's own.
 *
 * OMITTED rather than defaulted to zero when the caller has no model. PDF.js falls back to the page's own rotation,
 * which is right for a document nothing has rotated; passing `0` would flatten every document that arrives already
 * turned, and it would do it silently on the first render. ONE place builds it, so a whole page, a tile and a size
 * asked for without drawing cannot disagree about the box.
 */
function viewportOf(page: PdfPage, scale: number, rotation: number | undefined): Viewport {
  return page.getViewport(rotation === undefined ? { scale } : { scale, rotation });
}

/** What a page came out as: its device size at the viewport's scale, its visible box and the rotation drawn. */
function geometryOf(page: PdfPage, viewport: Viewport, size: { width: number; height: number }): RasterisedPage {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
  return {
    width: size.width,
    height: size.height,
    crop: [x0, y0, x1, y1],
    // THE VIEWPORT'S, not the parameter's. They differ exactly when the caller
    // passed nothing and PDF.js fell back to the page's own `/Rotate`, which is
    // the case an overlay must not get wrong.
    rotation: viewport.rotation,
  };
}

/**
 * PDF.js draws the page into `canvas`, cancelled by `signal`. `transform` is PDF.js' own extra matrix, applied BEFORE
 * the viewport's — a translation by a region's corner moves that corner to the canvas origin, which is how a tile is
 * drawn by the same viewport a whole page is.
 */
async function drawWithPdfjs(
  page: PdfPage,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  transform: [number, number, number, number, number, number] | undefined,
  signal: AbortSignal,
  pageNumber: number,
): Promise<void> {
  console.warn(`TRACE render start p${String(pageNumber)} ${String(canvas.width)}x${String(canvas.height)} @${String(Math.round(performance.now()))}`);
  const task = page.render({ canvas, canvasContext: context, viewport, ...(transform === undefined ? {} : { transform }) });
  const cancel = (): void => {
    console.warn(`TRACE render cancel p${String(pageNumber)} @${String(Math.round(performance.now()))}`);
    task.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
    try {
      // WHAT PDF.JS LEFT ON THE SCRATCH, sampled on a coarse grid: ink is any pixel that is not opaque white.
      const probe = canvas.getContext('2d', { willReadFrequently: true });
      let inked = 0;
      let sampled = 0;
      if (probe !== null && canvas.width > 0 && canvas.height > 0) {
        for (let gy = 1; gy < 9; gy += 1) {
          for (let gx = 1; gx < 9; gx += 1) {
            const px = probe.getImageData(Math.floor((canvas.width * gx) / 9), Math.floor((canvas.height * gy) / 9), 1, 1).data;
            sampled += 1;
            if (px[0] !== 255 || px[1] !== 255 || px[2] !== 255) inked += 1;
          }
        }
      }
      console.warn(`TRACE render done p${String(pageNumber)} scratch ink ${String(inked)}/${String(sampled)} aborted=${String(signal.aborted)} @${String(Math.round(performance.now()))}`);
      // WHAT THE PAGE HOLDS DECODED, and the operator list it drew from: whether the image object was there and whole.
      const held: string[] = [];
      for (const [objId, data] of page.objs as unknown as Iterable<[string, Record<string, unknown> | null]>) {
        const bitmap = (data?.['bitmap'] ?? null) as { width: number; height: number } | null;
        const pixels = (data?.['data'] ?? null) as { length: number; [index: number]: number } | null;
        held.push(
          `${objId}:${String(data?.['width'])}x${String(data?.['height'])} bitmap=${bitmap === null ? 'none' : `${String(bitmap.width)}x${String(bitmap.height)}`} data=${pixels === null ? 'none' : `${String(pixels.length)}b first=${String(pixels[0])},${String(pixels[1])},${String(pixels[2])},${String(pixels[3])}`}`,
        );
      }
      let ops = 'n/a';
      try {
        const list = await page.getOperatorList();
        ops = Array.from(list.fnArray).join(',');
      } catch (error) {
        ops = `threw ${String(error)}`;
      }
      console.warn(`TRACE objs ${held.join(' | ')} ops=${ops}`.slice(0, 280));
    } catch (probeError) {
      console.warn(`TRACE probe failed ${String(probeError)}`);
    }
  } catch (error) {
    console.warn(`TRACE render threw p${String(pageNumber)} aborted=${String(signal.aborted)} ${String(error)} @${String(Math.round(performance.now()))}`);
    // THE CANCELLATION IS OURS, so it is reported as ours; anything else is the page's.
    if (signal.aborted) throw new RenderCancelledError(pageNumber);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * A page's size, box and rotation at `scale`, drawing nothing — what a page drawn in tiles is laid out from, since no
 * one canvas holds the whole of it. The size is the device size a whole-page canvas would have: `ceil` of the
 * viewport's, as `renderPage` sizes one.
 */
export async function pageGeometry(
  document: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  rotation: number | undefined,
): Promise<RasterisedPage> {
  const page = await document.getPage(pageNumber);
  const viewport = viewportOf(page, scale, rotation);
  return geometryOf(page, viewport, { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
}

/**
 * A page's box at scale 1 in CSS pixels, turned by `rotation` as `renderPage` would turn it — exact, not `ceil`ed,
 * because it is the other half of a FIT, and a fit computed from a rounded box is off by up to a pixel per page.
 * Parses the one page asked for and draws nothing: what lets the first page be drawn at the fit it will be shown at,
 * where waiting for a first drawing to learn its size drew it at 100% and then again.
 */
export async function pageBoxAtOne(
  document: PDFDocumentProxy,
  pageNumber: number,
  rotation: number | undefined,
): Promise<{ readonly width: number; readonly height: number }> {
  const viewport = viewportOf(await document.getPage(pageNumber), 1, rotation);
  return { width: viewport.width, height: viewport.height };
}

/**
 * Draws one REGION of page `pageNumber` at `scale` into `canvas`, sized to the region — a tile (`tiles.ts`) or the
 * loupe's window. The region is in the page's device pixels at `scale`, origin top-left, as the canvas counts.
 *
 * PDF.js only: the second rasteriser answers whole pages, and a page drawn in pieces is one too large to ask it for.
 *
 * @throws {@link RenderCancelledError} when `signal` aborted, `renderPage`'s rule.
 */
export async function renderRegion(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number | undefined,
  region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  signal: AbortSignal,
): Promise<void> {
  // HELD FOR THE DRAW, `renderPage`'s reason: a tile decodes the page's images as a whole page does.
  const release = holdPage(document, pageNumber);
  try {
    await drawRegion(document, pageNumber, canvas, scale, rotation, region, signal);
  } finally {
    release();
  }
}

async function drawRegion(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number | undefined,
  region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  signal: AbortSignal,
): Promise<void> {
  const page = await document.getPage(pageNumber);
  residentPage(document, pageNumber, page);
  // BEFORE THE CANVAS IS TOUCHED, `renderPage`'s reason.
  if (signal.aborted) throw new RenderCancelledError(pageNumber);
  const viewport = viewportOf(page, scale, rotation);
  // OFF SCREEN AND THEN PRESENTED WHOLE, `present`'s reason: a tile or the loupe drawn in place shows
  // a cleared, then white, then finished square.
  const shown = contextOf(canvas);
  const scratch = scratchFor(canvas, region);
  try {
    await drawWithPdfjs(page, scratch, contextOf(scratch), viewport, [1, 0, 0, 1, -region.x, -region.y], signal, pageNumber);
    present(canvas, shown, scratch, signal, pageNumber);
  } finally {
    release(scratch);
  }
}
