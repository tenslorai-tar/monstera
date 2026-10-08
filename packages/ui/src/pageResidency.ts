import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/**
 * Which pages of a document something on screen still needs PDF.js to keep decoded — and the release of every other
 * page's resources (the owner's review of 0.1.9.0, item D.a).
 *
 * ## The mechanism this exists for
 *
 * PDF.js keeps a page's decoded images in that page's `objs` — as `ImageBitmap`s, which with an accelerated 2D canvas
 * live in the GPU process — until `PDFPageProxy.cleanup()` clears them and closes each bitmap. Nothing here called it,
 * so every page ever drawn kept its images: measured on the installed build at about 8.2 MiB a page of a scan, 1.7 GiB in
 * the GPU process for a 212-page read (`docs/JOURNAL.md`, 2026-10-02, *The GPU process's 9×*). PDF.js' own viewer
 * cleans a page when it leaves its buffer; this is that, counted.
 *
 * ## COUNTED, because three things draw from one document
 *
 * The reading list, the thumbnail strip and Compare all draw through `renderPage` from the same `PDFDocumentProxy`, so
 * one of them finishing with a page says nothing about the others. Each holds a page while it needs it and releases it
 * after; the page is cleaned when the last holder lets go. `renderPage` holds for the length of every draw, so a caller
 * cannot draw without being counted, and a page slot holds for as long as its canvas is mounted, so a zoom's redraw of a
 * page on screen does not decode it again.
 *
 * ## Only a DRAWN page is cleaned
 *
 * `renderPage` records the page it drew ({@link residentPage}); a page nothing drew has decoded nothing, so its last
 * release has nothing to clean and asks PDF.js for nothing. `cleanup()` is safe to call at any time: PDF.js refuses it
 * while a render of the page is running and runs it when that render ends, so a release racing another draw loses
 * nothing.
 */
const held = new WeakMap<PDFDocumentProxy, Map<number, { count: number; page: PDFPageProxy | undefined }>>();

/**
 * Holds `pageNumber` (PDF.js' 1-based number) of `document` decoded, and answers the release. Releasing twice is one
 * release: the answer is spent on its first call.
 */
export function holdPage(document: PDFDocumentProxy, pageNumber: number): () => void {
  let pages = held.get(document);
  if (pages === undefined) {
    pages = new Map();
    held.set(document, pages);
  }
  const entry = pages.get(pageNumber) ?? { count: 0, page: undefined };
  entry.count += 1;
  console.warn(`TRACE hold p${String(pageNumber)} -> ${String(entry.count)} @${String(Math.round(performance.now()))}`);
  pages.set(pageNumber, entry);
  let spent = false;
  return () => {
    if (spent) return;
    spent = true;
    entry.count -= 1;
    console.warn(`TRACE release p${String(pageNumber)} -> ${String(entry.count)} @${String(Math.round(performance.now()))}`);
    if (entry.count > 0) return;
    pages.delete(pageNumber);
    console.warn(`TRACE cleanup p${String(pageNumber)} page=${String(entry.page !== undefined)} @${String(Math.round(performance.now()))}`);
    entry.page?.cleanup();
  };
}

/** Records the page proxy a draw of a HELD page used, which is what its last release cleans. */
export function residentPage(document: PDFDocumentProxy, pageNumber: number, page: PDFPageProxy): void {
  const entry = held.get(document)?.get(pageNumber);
  if (entry !== undefined) entry.page = page;
}

/** How many pages of `document` something holds. */
export function pagesHeld(document: PDFDocumentProxy): number {
  return held.get(document)?.size ?? 0;
}
