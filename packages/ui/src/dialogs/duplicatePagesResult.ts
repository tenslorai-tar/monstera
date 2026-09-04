import { z } from 'zod';

/**
 * What the duplicate-pages dialog answers with.
 *
 * Its own module for `deletePagesResult.ts`'s reason — the entry imports its
 * body lazily and the body needs this type.
 *
 * **A page list and not a scope**, unlike the crop dialog's: what is removed is
 * *the extra copies*, which is a specific set the dialog computed from what it
 * was shown, and a word like `'duplicates'` would make the command re-derive it
 * from a report it does not hold. The list is bounded by the report that
 * produced it, which the channel already bounds.
 */
export const DUPLICATE_PAGES_RESULT = z
  .object({ pages: z.array(z.number().int().nonnegative()).min(1) })
  .strict();

/** Zero-based indices of the extra copies, as the dialog computed them. */
export type DuplicatePagesAnswer = z.infer<typeof DUPLICATE_PAGES_RESULT>;
