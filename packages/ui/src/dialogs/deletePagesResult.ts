import { z } from 'zod';

/**
 * What the delete-pages dialog answers with — **its own module, and that is
 * forced rather than tidy**.
 *
 * `deletePages.ts` imports the body lazily and the body needs the answer's
 * type, so declaring the schema beside the entry makes the two files reference
 * each other and TypeScript reports the body's own props as circular. Splitting
 * the schema out breaks the cycle without either side restating the shape,
 * which is the point: a hand-written `{ readonly pages: readonly number[] }` in
 * the body did not compile, and the compiler was right — zod infers `number[]`,
 * `resolve` is contravariant in its argument, and a readonly array cannot be
 * handed to something expecting a mutable one. One writer for the shape (B3).
 *
 * `.min(1)` mirrors the command's own schema: a dialog that could answer with
 * an empty list would put a command in the log that deletes nothing.
 */
export const DELETE_PAGES_RESULT = z
  .object({ pages: z.array(z.number().int().nonnegative()).min(1) })
  .strict();

/** Zero-based page indices, as the dialog produced them. */
export type DeletePagesAnswer = z.infer<typeof DELETE_PAGES_RESULT>;
