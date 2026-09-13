import { PDFDocument } from '@cantoo/pdf-lib';

import { MAX_IMPORT_IMAGE_PIXELS, MAX_IMPORT_PNG_PIXELS } from '@monstera/contract';

import { ComposeRefused } from './composeLayout.js';
import { pngPixelSize } from './imageDimensions.js';
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
 * first, and a set that breaks either pixel bound is refused before any decoder runs:
 * a refusal found after twenty seconds of decoding the images before it would be the
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

/**
 * Makes a new PDF with one page per image, in the order given, answering its bytes.
 *
 * @throws ComposeRefused `image-unreadable` for a PNG whose header states no size or an
 *   image the decoder refuses, and `too-many-pixels` for a PNG past either pixel bound —
 *   each naming the image's one-based position
 */
export async function composeImages(images: readonly ImportImage[]): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new ComposeRefused('nothing-to-draw', null, 'no image was given to compose');
  }

  // THE FIRST PASS: every PNG's size, from its header, and both bounds held.
  let pngPixels = 0;
  for (const [index, image] of images.entries()) {
    if (image.mediaType !== 'image/png') continue;
    const item = index + 1;
    // A READ THAT FAILS IS NOT CAUGHT HERE, in either pass: the bytes not arriving is
    // the transport's fault, not the picture's, and the handler answers it as one.
    const size = pngPixelSize(await image.read());
    if (size === null) {
      throw new ComposeRefused('image-unreadable', null, `image ${String(item)} has no readable PNG header`, item);
    }
    const pixels = size.width * size.height;
    pngPixels += pixels;
    if (pixels > MAX_IMPORT_IMAGE_PIXELS || pngPixels > MAX_IMPORT_PNG_PIXELS) {
      throw new ComposeRefused(
        'too-many-pixels',
        null,
        `image ${String(item)} is ${String(size.width)} × ${String(size.height)}, which passes a pixel bound`,
        item,
      );
    }
  }

  // PINNED, for `markdownCompose.ts`' reason: a composition that differed on every
  // run could not be compared with itself.
  const document = await PDFDocument.create({ updateMetadata: false });

  // THE SECOND PASS: the pages.
  for (const [index, image] of images.entries()) {
    const item = index + 1;
    const bytes = await image.read();
    try {
      await addImagePage(document, bytes, image.mediaType, document.getPageCount());
    } catch (error) {
      // THE DECODER REFUSING IS THE ANSWER, and it is the only call inside this try.
      // `insertImage`'s rule one process along: pdf-lib names no error class for bytes
      // that are not the type they were routed as, so what this try can catch is
      // exactly the decode and the page it makes.
      throw new ComposeRefused(
        'image-unreadable',
        null,
        `image ${String(item)} was refused by its decoder: ${error instanceof Error ? error.message : String(error)}`,
        item,
      );
    }
  }

  return document.save();
}
