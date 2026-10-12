import { PDFDocument } from '@cantoo/pdf-lib';

import type { ComposeSkip } from '@monstera/contract';
import { MAX_IMPORT_PNG_PIXELS } from '@monstera/contract/host';

import { ComposeRefused } from './composeOutcome.js';
import { ImageDecodeRefused, type PixelSize, PngPixelsRefused, checkPngPixels } from './imageDimensions.js';
import { type EmbeddableImageType, addImagePage } from './pageImage.js';

/**
 * Picked images, made into a new PDF with one page each
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## This module runs in the COMPOSE HOST and nowhere else
 *
 * `markdownCompose.ts`' reason: the bytes are picked files', and decoding a PNG is
 * parsing one. The page each image becomes is `pageImage.ts`' `addImagePage`, the same
 * function inserting one image uses, so the two routes cannot disagree about a page.
 *
 * ## Two passes, and the first decodes nothing
 *
 * `embedPng` decodes every pixel, and its cost follows pixels rather than bytes — the
 * table on `MAX_IMPORT_IMAGE_PIXELS` is the measurement. So every PNG's header is read
 * first, and an image that breaks either pixel bound is left out before any decoder
 * runs: found after twenty seconds of decoding the images before it, it would be the
 * same answer, paid for. A JPEG is not decoded by `embedJpg`, which reads its header
 * and carries the bytes, so main's byte bound is the one that bounds it.
 *
 * ## One image's bytes at a time, in both passes
 *
 * Each read is dropped before the next, so this process holds the document so far and
 * one picked file — never every picked file at once. The first pass reads each file in
 * full to see a header, which costs a read of at most the set's byte bound and no
 * memory beyond one file.
 */

/** One picked image: which decoder it goes to, and how to read it. */
export interface ImportImage {
  readonly mediaType: EmbeddableImageType;
  /** The image's bytes. Called once per pass, so it must answer the same bytes twice. */
  readonly read: () => Promise<Uint8Array>;
}

/** What a set of images makes: the PDF, and each picked image left out with why, by its one-based place. */
export interface ComposedImages {
  readonly pdf: Uint8Array;
  readonly skipped: readonly ComposeSkip[];
}

/**
 * Makes a new PDF with one page per image, in the order given, answering its bytes and the images it left out.
 *
 * **One image the decoder refuses, or one past a pixel bound, is LEFT OUT AND NAMED, never the whole set refused**
 * (Codex's importer audit, the owner's *a user is never refused because of their document*): every other picked image
 * is a page, in the order picked. The set's own pixel bound leaves out the image that would cross it, so the images
 * before it are kept and a smaller one after it still fits.
 *
 * @throws ComposeRefused `nothing-to-draw` for no image given, and the first left-out image's own reason where every
 *   image was left out, naming its one-based position
 */
export async function composeImages(images: readonly ImportImage[]): Promise<ComposedImages> {
  if (images.length === 0) {
    throw new ComposeRefused('nothing-to-draw', null, 'no image was given to compose');
  }
  /** An image's two reasons only, which are both a skip and, where every image is one, the refusal. */
  type ImageSkip = ComposeSkip & { readonly reason: 'image-unreadable' | 'too-many-pixels'; readonly item: number };
  const skipped: ImageSkip[] = [];
  const left = new Set<number>();
  const leaveOut = (item: number, reason: ImageSkip['reason']): void => {
    skipped.push({ reason, line: null, item });
    left.add(item);
  };

  // THE FIRST PASS: every PNG's size, from its header, and both bounds held.
  let pngPixels = 0;
  for (const [index, image] of images.entries()) {
    if (image.mediaType !== 'image/png') continue;
    const item = index + 1;
    // A READ THAT FAILS IS NOT CAUGHT HERE, in either pass: the bytes not arriving is
    // the transport's fault, not the picture's, and the handler answers it as one.
    let size: PixelSize;
    try {
      // THE PER-IMAGE RULE IS `checkPngPixels`', the one Insert image calls too.
      size = checkPngPixels(await image.read());
    } catch (error) {
      if (!(error instanceof PngPixelsRefused)) throw error;
      leaveOut(item, error.reason === 'no-header' ? 'image-unreadable' : 'too-many-pixels');
      continue;
    }
    // THE SET'S TOTAL is this import's own bound, and no other route has a set: the image that would cross it is left
    // out and does not count towards it. AN IMAGE COUNTED HERE STAYS COUNTED if its decode then fails in the second
    // pass, because the bound is DECODING TIME (`MAX_IMPORT_PNG_PIXELS`: about 22 s) and that image's decoder ran: a
    // refusal can come at its last row as well as its first, so a refund would let the set's decode cost pass the bound
    // by as much as the refunded pictures took.
    if (pngPixels + size.width * size.height > MAX_IMPORT_PNG_PIXELS) {
      leaveOut(item, 'too-many-pixels');
      continue;
    }
    pngPixels += size.width * size.height;
  }

  // PINNED, for `markdownCompose.ts`' reason: a composition that differed on every
  // run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });

  // THE SECOND PASS: the pages.
  for (const [index, image] of images.entries()) {
    const item = index + 1;
    if (left.has(item)) continue;
    const bytes = await image.read();
    try {
      await addImagePage(document, bytes, image.mediaType, document.getPageCount());
    } catch (error) {
      // THE DECODER REFUSING IS THE ANSWER, and only that: `ImageDecodeRefused` is thrown around the decode call alone,
      // so a failure after it (making the page, drawing on it) is not reported as the picture's. No page is left behind
      // for a refusal: `addImagePage` inserts the page only after the image has embedded.
      if (!(error instanceof ImageDecodeRefused)) throw error;
      leaveOut(item, 'image-unreadable');
    }
  }

  // IN THE ORDER PICKED: the first pass names a pixel bound before the second names a decode, whatever their places.
  const inOrder = [...skipped].sort((a, b) => a.item - b.item);
  const first = inOrder[0];
  if (document.getPageCount() === 0 && first !== undefined) {
    throw new ComposeRefused(first.reason, null, `image ${String(first.item)} could not be made a page, and no other was picked`, first.item);
  }
  return { pdf: await document.save(), skipped: inOrder };
}
