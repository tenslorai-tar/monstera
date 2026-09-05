import { z } from 'zod';

/**
 * What the insert-from-PDF dialog answers with — **its own module for
 * `deletePagesResult.ts`'s forced reason**: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * Two fields, because this dialog asks the two questions merge does not: which
 * document, and **where**. Merge answers the second itself — it appends — so
 * its result carries only the id.
 *
 * `at` is **zero-based and in the TARGET's frame**, already converted. The body
 * shows a 1-based position because that is what a reader counts in, and
 * `pageNumbering.ts`' rule is that the conversion happens once, at the surface
 * holding the text, so no command repeats it.
 */
export const INSERT_FROM_PDF_RESULT = z
  .object({
    source: z.string().min(1),
    at: z.number().int().nonnegative(),
  })
  .strict();

/** The source document and where its pages land. */
export type InsertFromPdfAnswer = z.infer<typeof INSERT_FROM_PDF_RESULT>;
