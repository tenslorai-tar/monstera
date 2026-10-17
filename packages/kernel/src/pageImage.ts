import type { PDFDocument } from '@cantoo/pdf-lib';

import { type EmbeddableImageType, MAX_PAGE_COORDINATE } from '@monstera/contract/host';

import { ImageDecodeRefused, checkPngPixels } from './imageDimensions.js';

/** The image encodings a page can be made from: the contract's list, never a copy (`embeddableImageTypeSchema`). */
export type { EmbeddableImageType };

/**
 * A page made from an image.
 *
 * ## Content composition, and §3's matrix names this row by name
 *
 * `docs/ARCHITECTURE.md:381` puts *"new document generation (markdown/CSV/TOC/**image-to-PDF**)"*
 * on `@cantoo/pdf-lib`, so the engine is assigned rather than chosen. MuPDF
 * would have to be given a decoder and an encoder for whatever the image is;
 * pdf-lib embeds JPEG and PNG directly, which is the one thing this operation
 * needs.
 *
 * ## THE PAGE IS THE IMAGE'S SIZE, not the document's
 *
 * A scan is a sheet, and the page it becomes is that sheet. Sizing the new page
 * to match its neighbours would either letterbox the scan or crop it, and both
 * are decisions this function has no basis for — the pages of one document need
 * not agree in the first place (`cropPages` says so about margins for the same
 * reason). A user who wants it to match reaches for `resizePages`, which exists
 * and does exactly that, with a uniform fit and a stated centring rule.
 *
 * At 72 dpi one image pixel is one point, which is what `image.width` answers.
 * That is the same convention every viewer applies to an image with no explicit
 * density, so a 2480×3508 scan arrives as a page a reader recognises as A4.
 *
 * **With one exception, the format's own:** a side past `MAX_PAGE_COORDINATE`
 * (PDF 32000-1 Annex C.2, 14,400 points) would make a page no conforming reader need
 * open, so an image more than 14,400 pixels on a side is scaled down until its longer
 * side is exactly that, keeping its shape. Every smaller image is its own size.
 */

/**
 * Embeds one image and inserts the page it makes, at the image's own size — scaled
 * down only past the format's page limit, per the header above.
 *
 * **ONE FUNCTION FOR EVERY ROUTE that makes a page from a picked image**: *Insert pictures
 * as pages* and *New PDF from images* both compose in the compose host through it, so
 * a page's size and where the picture sits on it have one opinion (B3a).
 *
 * TWO CALLS AND NOT ONE, because pdf-lib offers two and the choice is the caller's. A
 * sniffer here would be a second opinion about a question the media type already
 * answers — and the decoder refusing is what validates the bytes, which is where a
 * validation belongs.
 *
 * **`insertPage` and not `addPage`**, because a page appended to the end is a different
 * document from a page inserted at 3. An index past the end is clamped to the end rather
 * than refused: the only value past the end a caller can name is the position after the
 * last page, which is a real request (`insertBlankPage` reads it the same way).
 *
 * @param at where the page goes; clamped to the end
 * @throws ImageDecodeRefused for bytes the decoder refuses as the named type
 * @throws PngPixelsRefused for a PNG past the per-image pixel bound, before any decoder runs
 */
export async function addImagePage(
  document: PDFDocument,
  bytes: Uint8Array,
  mediaType: EmbeddableImageType,
  at: number,
): Promise<void> {
  // A PNG'S PIXELS ARE HELD BEFORE ITS DECODER RUNS, on every route: `embedPng`
  // decodes every pixel. A JPEG is not decoded by `embedJpg`, which reads its header
  // and carries the bytes.
  if (mediaType === 'image/png') checkPngPixels(bytes);
  let embedded: Awaited<ReturnType<PDFDocument['embedPng']>>;
  try {
    embedded = mediaType === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  } catch (cause) {
    // AROUND THE DECODE ALONE, so a failure after it is never reported as the picture's.
    throw new ImageDecodeRefused(`the ${mediaType} decoder refused these bytes`, cause);
  }

  // NEVER PAST THE FORMAT'S PAGE LIMIT. One pixel is one point, and PDF 32000-1 Annex
  // C.2 bounds a page side at `MAX_PAGE_COORDINATE`, so an image more than 14,400 pixels
  // on a side would make a page no conforming reader need open. It is scaled down to
  // fit, both sides by one factor so the picture keeps its shape; nothing smaller moves.
  const scale = Math.min(1, MAX_PAGE_COORDINATE / Math.max(embedded.width, embedded.height));
  const width = embedded.width * scale;
  const height = embedded.height * scale;

  const page = document.insertPage(Math.min(at, document.getPageCount()), [width, height]);
  // AT THE ORIGIN AND AT FULL SIZE. The page was made to these dimensions one line
  // up, so any inset here would be a margin nobody asked for.
  page.drawImage(embedded, { x: 0, y: 0, width, height });
}
