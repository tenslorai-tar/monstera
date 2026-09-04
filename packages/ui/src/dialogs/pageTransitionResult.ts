import { z } from 'zod';

/**
 * What the transition dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason, and the bounds are
 * `setPageTransitionSchema`'s restated — see `watermarkPagesResult.ts` for why
 * a copy is safe here and what makes a drift loud rather than quiet.
 */
export const PAGE_TRANSITION_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    style: z.enum(['replace', 'dissolve', 'fade', 'box', 'blinds']),
    durationSeconds: z.number().min(0).max(60),
  })
  .strict();

/** The style, the duration and the scope. */
export type PageTransitionAnswer = z.infer<typeof PAGE_TRANSITION_RESULT>;
