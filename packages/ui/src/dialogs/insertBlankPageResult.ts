import { MAX_BLANK_PAGES } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the blank page dialog answers — its own module for `deletePagesResult.ts`' reason: the entry imports the body
 * lazily and the body needs this type.
 *
 * `at` is zero-based in the target's frame, converted once by `placementAt`; `count` is `insertBlankPage`'s own bound,
 * so an answer the dialog accepts is one the command takes.
 */
export const INSERT_BLANK_PAGE_RESULT = z
  .object({ at: z.number().int().nonnegative(), count: z.number().int().min(1).max(MAX_BLANK_PAGES) })
  .strict();

/** Where the blank pages go, and how many. */
export type InsertBlankPageAnswer = z.infer<typeof INSERT_BLANK_PAGE_RESULT>;
