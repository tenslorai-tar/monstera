import type { PDFDocument } from '@cantoo/pdf-lib';

import { type CommandOfKind, MAX_PAGE_COORDINATE } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import { openForWriting } from './pdfLibSession.js';

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
 * are decisions this command has no basis for — the pages of one document need
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
 *
 * ## Non-invertible, for `watermarkPages`' reason arriving at a page boundary
 *
 * The prior state of *this page did not exist* is the whole document minus a
 * page, which is `deletePages`' argument in the other direction: an insert's
 * inverse is a delete, and a delete's prior state is the page and everything it
 * reaches. So this is a checkpoint command, and `CommandPrior` types it `never`
 * — `CaptureResult<never>` has no constructible success, so the capture cannot
 * report one even by mistake.
 *
 * The checkpoint is free beyond what this already does
 * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)):
 * the bytes serialised for it are the bytes this `apply` consumes.
 */

/**
 * The image encodings a page can be made from — the contract's list, never a copy.
 *
 * Taken from `insertImagePage`'s own `mediaType`, so a format the contract adds is a
 * format this function must handle, rather than one a second spelling here forgets.
 */
export type EmbeddableImageType = CommandOfKind<'insertImagePage'>['mediaType'];

/**
 * Embeds one image and inserts the page it makes, at the image's own size — scaled
 * down only past the format's page limit, per the header above.
 *
 * **ONE FUNCTION FOR EVERY ROUTE that makes a page from a picked image** — the
 * insert-image command below, in `main`, and the image import composed in the compose
 * host. The two would otherwise hold two opinions about a page's size and where the
 * picture sits on it (B3a).
 *
 * TWO CALLS AND NOT ONE, because pdf-lib offers two and the choice is the caller's. A
 * sniffer here would be a second opinion about a question the media type already
 * answers — and the decoder refusing is what validates the bytes, which is where a
 * validation belongs.
 *
 * @param at where the page goes; clamped to the end, per {@link applyInsertImagePage}
 * @throws whatever pdf-lib's decoder throws for bytes that are not the named type
 */
export async function addImagePage(
  document: PDFDocument,
  bytes: Uint8Array,
  mediaType: EmbeddableImageType,
  at: number,
): Promise<void> {
  const embedded =
    mediaType === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);

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

/**
 * Embeds the image and inserts the page it makes.
 *
 * **`insertPage` and not `addPage`**, because the command names an index and a
 * page appended to the end is a different document from a page inserted at 3 —
 * one that renders and that nobody asked for.
 *
 * An index past the end is **clamped to the end rather than refused**, and that
 * is the one clamp in this file. `at` comes from the renderer as *where the new
 * page goes*, and the only value past the end it can name is the position after
 * the last page, which is a real request — `insertBlankPage` reads it the same
 * way. A refusal there would make *insert at the end* an error on a document
 * whose length the renderer knows only from a version it may already have lost.
 */
export const applyInsertImagePage: Apply<'pdf-lib', 'insertImagePage'> = async (
  image: ByteImage,
  command: CommandOfKind<'insertImagePage'>,
): Promise<ByteImage> => {
  const document = await openForWriting(image);
  await addImagePage(document, command.bytes, command.mediaType, command.at);
  return document.save();
};

/**
 * Reports that prior state cannot be recorded, always.
 *
 * Not a throw: ADR-0009's 2026-08-19 decision makes *this command is not
 * invertible* an outcome the bus answers with a checkpoint, where a throw is a
 * caller error. The reason is returned rather than assumed because the bus puts
 * it in the log entry, and a checkpoint whose reason reads *"unknown"* is one
 * nobody can audit later.
 */
export const captureInsertImagePage = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'inserting a page has no recordable prior state: undoing it means removing the page and ' +
      'everything it reaches, which is the argument deletePages makes in the other direction',
  });

/**
 * Unreachable, and it exists because the seam's shape requires it.
 *
 * `CommandPrior['insertImagePage']` is `never`, so no value of the parameter
 * type can be constructed and nothing can call this. Returning the image
 * unchanged is the only honest body: it says *this did nothing*, where a throw
 * would claim a failure state that cannot occur.
 */
export const invertInsertImagePage: Invert<'pdf-lib', 'insertImagePage'> = (
  image: ByteImage,
): Promise<ByteImage> => Promise.resolve(image);
