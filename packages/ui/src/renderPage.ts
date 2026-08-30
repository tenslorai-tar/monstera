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
 * main's canonical image is never replaced, so the bytes this parser reads are
 * the ones the document was opened with — for the whole life of the document.
 * The page's own `/Rotate` is stale the moment anything rotates it.
 *
 * The view model carries the kernel's answer (`docs/ARCHITECTURE.md` §2), and
 * `page.getViewport({ rotation })` **replaces** the page's rotation rather than
 * adding to it — measured by `proof:viewportrotation` rather than read off the
 * declaration. That is §3.2 working as written rather than an exception to it:
 * *PDF.js is never a source of truth. It renders.*
 */

/** What a rasterised page came out as, in device pixels. */
export interface RasterisedPage {
  readonly width: number;
  readonly height: number;
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
 *   Omitted where the caller has no model, in which case the page's own
 *   `/Rotate` decides — see the note above on why that is not the same as `0`.
 */
export async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation?: number,
): Promise<RasterisedPage> {
  const page = await document.getPage(pageNumber);
  // OMITTED rather than defaulted to zero when the caller has no model. PDF.js
  // falls back to the page's own rotation, which is right for a document nothing
  // has rotated; passing `0` would flatten every document that arrives already
  // turned, and it would do it silently on the first render.
  const viewport = page.getViewport(rotation === undefined ? { scale } : { scale, rotation });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the page canvas has no 2d context to draw into');
  }

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { width: canvas.width, height: canvas.height };
}
