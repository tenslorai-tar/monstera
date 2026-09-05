import { z } from 'zod';

/**
 * What the resize dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason, and the bounds are
 * `resizePagesSchema`'s restated — see `watermarkPagesResult.ts` for why a copy
 * is safe here and what makes a drift loud rather than quiet. The upper bound
 * is PDF 32000-1's own 14,400 user-space units, not a number chosen here.
 */
export const RESIZE_PAGES_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    widthPoints: z.number().gt(0).max(14_400),
    heightPoints: z.number().gt(0).max(14_400),
  })
  .strict();

/** The target size and the scope. */
export type ResizePagesAnswer = z.infer<typeof RESIZE_PAGES_RESULT>;
