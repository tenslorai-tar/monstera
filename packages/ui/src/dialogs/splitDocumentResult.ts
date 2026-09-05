import { z } from 'zod';

/**
 * What the split dialog answers with — **its own module for
 * `deletePagesResult.ts`'s forced reason**: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * **Groups, already built**, rather than a mode and an expression. The dialog
 * offers *one file per page* and *these ranges*, and both produce the same
 * thing — a list of page lists — so the mode does not travel. A `mode` field
 * would be a second way to say what the groups already say, and the command
 * would then have to agree with the dialog about what each mode means.
 *
 * Zero-based, as `parsePageRanges` produced them and as every page index
 * crossing a boundary here is.
 */
export const SPLIT_DOCUMENT_RESULT = z
  .object({
    groups: z.array(z.array(z.number().int().nonnegative()).min(1)).min(1),
  })
  .strict();

/** The outputs, each a non-empty list of zero-based page indices. */
export type SplitDocumentAnswer = z.infer<typeof SPLIT_DOCUMENT_RESULT>;
