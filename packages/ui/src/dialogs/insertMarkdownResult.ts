import { z } from 'zod';

/**
 * What the insert-from-Markdown dialog answers with — its own module for `deletePagesResult.ts`' reason: the entry imports the
 * body lazily and the body needs this type.
 *
 * `at` is **zero-based and in the TARGET's frame, already converted**: *at the start* is 0, *at the end* is the page count,
 * *after page 3* is 3. The body counts pages from 1 because a reader does, and the conversion happens once, here.
 */
export const INSERT_MARKDOWN_RESULT = z.object({ at: z.number().int().nonnegative() }).strict();

/** Where the converted pages land. */
export type InsertMarkdownAnswer = z.infer<typeof INSERT_MARKDOWN_RESULT>;
