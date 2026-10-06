import { z } from 'zod';

import { PAGE_RANGE_START, SOURCE_PAGES_ANSWER, chooseFileAnswer } from './sourceDocuments.js';

/**
 * What the insert-from-PDF dialog answers with — **its own module for `deletePagesResult.ts`'s forced reason**: the
 * entry imports the body lazily and the body needs this type, so declaring it beside the entry makes the two circular.
 *
 * `at` is **zero-based and in the TARGET's frame**, already converted: *before page 3* is 2 and *after page 3* is 3.
 * The body shows 1-based pages because that is what a reader counts in, and `pageNumbering.ts`' rule is that the
 * conversion happens once, at the surface holding the text, so no command repeats it.
 */

/** What the dialog reopens with after *Choose file…*: the source pages, before or after, and the page as typed. */
export const INSERT_FROM_PDF_DRAFT = z
  .object({
    sourcePages: PAGE_RANGE_START,
    placement: z.enum(['before', 'after']),
    page: z.string().max(20),
  })
  .strict();

export const INSERT_FROM_PDF_RESULT = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('insert'),
      source: z.string().min(1),
      sourcePages: SOURCE_PAGES_ANSWER,
      at: z.number().int().nonnegative(),
    })
    .strict(),
  chooseFileAnswer(INSERT_FROM_PDF_DRAFT),
]);

/** The source document, which of its pages, and where they land — or a file to choose first. */
export type InsertFromPdfAnswer = z.infer<typeof INSERT_FROM_PDF_RESULT>;
