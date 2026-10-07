import { MAX_MERGE_DOCUMENTS, MAX_MERGE_PART_ENTRIES, pageSetOfAtMost } from '@monstera/contract';
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

/**
 * The documents merged in, in the order the person set (ADR-0152): each an open document's id, one to the merge's
 * bound, and the same one allowed twice.
 */
const MERGE_DOCUMENT_PARTS = z
  .array(
    z
      .object({
        docId: z.string().min(1),
        /** `'all'`, or the pages chosen of this document, zero-based and in the order they land (ADR-0195). */
        pages: z.union([z.literal('all'), pageSetOfAtMost(MAX_MERGE_PART_ENTRIES)]),
      })
      .strict(),
  )
  .min(1)
  .max(MAX_MERGE_DOCUMENTS);

/**
 * What the dialog reopens with after *Choose file…*: the place, the page as typed, and the documents already listed —
 * which may be none, since *Choose file…* is the way to a first document when no other is open.
 */
export const MERGE_DOCUMENT_DRAFT = z
  .object({
    placement: z.enum(MERGE_PLACEMENTS),
    page: z.string().max(20),
    /** Each listed document and the page range as typed ('' is every page). */
    documents: z
      .array(z.object({ docId: z.string().min(1), pages: z.string().max(200) }).strict())
      .max(MAX_MERGE_DOCUMENTS),
  })
  .strict();

export const MERGE_DOCUMENT_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('merge'), documents: MERGE_DOCUMENT_PARTS, at: z.number().int().nonnegative() }).strict(),
  chooseFileAnswer(MERGE_DOCUMENT_DRAFT),
]);

/** The documents merged in, in order, and where their pages land — or a file to choose first. */
export type MergeDocumentAnswer = z.infer<typeof MERGE_DOCUMENT_RESULT>;
