import { PDFDocument } from '@cantoo/pdf-lib';

import { type PixelSize, pngPixelSize } from './imageDimensions.js';
import type { EmbeddableImageType } from './pageImage.js';

/**
 * A picked picture's size in pixels, for a picture attached to a question
 * ([ADR-0135](../../../docs/DECISIONS/0135-a-file-attached-to-an-ask-is-read-in-a-contained-process-inside-the-one-bound.md)).
 *
 * ## This runs in the COMPOSE HOST and nowhere else
 *
 * `imageCompose.ts`' reason: the bytes are a picked file's, and reading a JPEG's frame header is parsing one. Main
 * sends the bytes on unchanged when the size is inside the provider's limits, so this answer is the only thing about
 * the picture main ever reads.
 *
 * ## The same readers the image import uses
 *
 * A PNG's size from its IHDR, `pngPixelSize`, which decodes nothing. A JPEG's from pdf-lib's own embedder, which reads
 * the frame header and carries the bytes — `composeImages` reaches the same reader through `embedJpg` — so a picture
 * this answers for is one the import would have made a page of.
 *
 * @returns the size, or `null` for bytes the reader for that type cannot read
 */
export async function pictureSize(bytes: Uint8Array, mediaType: EmbeddableImageType): Promise<PixelSize | null> {
  if (mediaType === 'image/png') return pngPixelSize(bytes);
  try {
    const image = await (await PDFDocument.create()).embedJpg(bytes);
    // A ZERO IS NO PICTURE, for `pngPixelSize`'s reason: it would make any pixel bound pass.
    return image.width > 0 && image.height > 0 ? { width: image.width, height: image.height } : null;
  } catch {
    // pdf-lib throws a plain Error for a stream with no frame header; every throw here is the file's, since the only
    // input is its bytes.
    return null;
  }
}
