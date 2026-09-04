import { z } from 'zod';

/**
 * What the crop dialog answers with.
 *
 * Its own module for `deletePagesResult.ts`'s reason, and it is a property of
 * the lazy seam rather than of this feature: the entry imports its body with
 * `lazy(() => import(…))` and the body needs the answer's type, so a schema
 * declared beside the entry makes the two files circular.
 *
 * ## The SCOPE crosses, not a page list
 *
 * `'all'` is the ordinary crop and a list for it is one integer per page, which
 * invariant L11 rules out. The dialog answers with the same union the command
 * carries rather than expanding it — expanding here would put the payload back
 * and give the kernel a second opinion about what *all* means (B3a).
 */
export const CROP_PAGES_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    margins: z
      .object({
        top: z.number().nonnegative(),
        right: z.number().nonnegative(),
        bottom: z.number().nonnegative(),
        left: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** The scope and the margins, as the dialog produced them. */
export type CropPagesAnswer = z.infer<typeof CROP_PAGES_RESULT>;
