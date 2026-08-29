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
 */
export async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<RasterisedPage> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the page canvas has no 2d context to draw into');
  }

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { width: canvas.width, height: canvas.height };
}
