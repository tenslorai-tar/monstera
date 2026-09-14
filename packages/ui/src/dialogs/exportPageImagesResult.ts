import {
  MAX_JPEG_QUALITY,
  MAX_PAGE_IMAGE_DPI,
  MIN_JPEG_QUALITY,
  MIN_PAGE_IMAGE_DPI,
  PAGE_IMAGE_FORMATS,
} from '@monstera/contract';
import { z } from 'zod';

/**
 * What the page-image export dialog answers with — its own module for
 * `splitDocumentResult.ts`' forced reason: the entry imports the body lazily and
 * the body needs this type.
 *
 * **Pages, already parsed**, for the split's reason: *every page* and *these
 * pages* both produce a list, so the mode does not travel. The bounds are the
 * contract's, so a dialog answer the channel would refuse is refused here first.
 */
export const EXPORT_PAGE_IMAGES_RESULT = z
  .object({
    pages: z.array(z.number().int().nonnegative()).min(1),
    format: z.enum(PAGE_IMAGE_FORMATS),
    dpi: z.number().int().min(MIN_PAGE_IMAGE_DPI).max(MAX_PAGE_IMAGE_DPI),
    quality: z.number().int().min(MIN_JPEG_QUALITY).max(MAX_JPEG_QUALITY),
  })
  .strict();

/** The pages, zero-based, and how to encode them. */
export type ExportPageImagesAnswer = z.infer<typeof EXPORT_PAGE_IMAGES_RESULT>;
