import { z } from 'zod';

/**
 * What the extract dialog answers with — **its own module for
 * `deletePagesResult.ts`'s forced reason**: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * Already-validated **zero-based** indices, as `parsePageRanges` produced them.
 * The command performs no arithmetic on what it receives — `pageNumbering.ts`'
 * rule that the 1-based-to-0-based conversion happens once.
 *
 * `.min(1)` mirrors the kernel: `extractPages` refuses an empty list because it
 * would write a document nothing can open. A dialog that could answer with none
 * would put that refusal in front of the user as an internal error.
 */
export const EXTRACT_PAGES_RESULT = z
  .object({ pages: z.array(z.number().int().nonnegative()).min(1) })
  .strict();

/** Zero-based page indices, as the dialog produced them. */
export type ExtractPagesAnswer = z.infer<typeof EXTRACT_PAGES_RESULT>;
