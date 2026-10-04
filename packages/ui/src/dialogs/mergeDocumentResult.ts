import { z } from 'zod';

import { chooseFileAnswer } from './sourceDocuments.js';

/**
 * What the merge dialog answers with — **its own module for `deletePagesResult.ts`'s forced reason**: the entry imports
 * the body lazily and the body needs this type, so declaring it beside the entry makes the two circular.
 *
 * `at` is zero-based in the TARGET's frame, converted once in the body: *at the start* is 0, *at the end* is the page
 * count, *after page p* is `p`.
 */

/** Where the merged pages go. */
export const MERGE_PLACEMENTS = ['start', 'end', 'after'] as const;

/** What the dialog reopens with after *Choose file…*: the place, and the page as typed. */
export const MERGE_DOCUMENT_DRAFT = z
  .object({ placement: z.enum(MERGE_PLACEMENTS), page: z.string().max(20) })
  .strict();

export const MERGE_DOCUMENT_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('merge'), source: z.string().min(1), at: z.number().int().nonnegative() }).strict(),
  chooseFileAnswer(MERGE_DOCUMENT_DRAFT),
]);

/** The document merged in and where its pages land — or a file to choose first. */
export type MergeDocumentAnswer = z.infer<typeof MERGE_DOCUMENT_RESULT>;
