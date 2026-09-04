import { z } from 'zod';

/**
 * What the header-and-footer dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason: the entry imports its body
 * with `lazy(() => import(…))` and the body needs the answer's type, so a schema
 * declared beside the entry makes the two files circular.
 *
 * The bounds are `headerFooterPagesSchema`'s, restated — see
 * `watermarkPagesResult.ts` for why a copy is safe here and what makes it fail
 * loudly rather than quietly if it drifts.
 */
const slots = z
  .object({
    left: z.string().max(200),
    centre: z.string().max(200),
    right: z.string().max(200),
  })
  .strict();

export const HEADER_FOOTER_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    header: slots,
    footer: slots,
    fontSize: z.number().positive().max(1000),
    marginPoints: z.number().nonnegative().max(500),
  })
  .strict();

/** The six slots, the type size, the margin and the scope. */
export type HeaderFooterAnswer = z.infer<typeof HEADER_FOOTER_RESULT>;
