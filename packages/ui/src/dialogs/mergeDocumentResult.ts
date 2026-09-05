import { z } from 'zod';

/**
 * What the merge dialog answers with — **its own module for
 * `deletePagesResult.ts`'s forced reason**: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * One field, because the dialog's only question is *which document*. Where the
 * pages land is not asked: a merge **appends**, which the row states and the
 * command's `at` carries as the target's page count. That is what separates
 * this row from *insert from PDF*, whose whole point is an index.
 *
 * `.min(1)` on the id mirrors `docIdSchema`. It is deliberately NOT branded
 * here: a dialog answer is renderer-side text until the command builds the
 * payload, and `mergeDocumentSchema` is what turns it into a `DocId` at the
 * boundary — one place performs that transform (B3a).
 */
export const MERGE_DOCUMENT_RESULT = z.object({ source: z.string().min(1) }).strict();

/** The document the reader chose to merge in. */
export type MergeDocumentAnswer = z.infer<typeof MERGE_DOCUMENT_RESULT>;
