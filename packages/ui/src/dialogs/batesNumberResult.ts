import { annotationFamilySchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the Bates dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason, and the bounds are
 * `batesNumberPagesSchema`'s restated — see `watermarkPagesResult.ts` for why a
 * copy is safe here and what makes a drift loud rather than quiet.
 */
/** The settings without the pages, as the dialog collects them and the engine records them (`WATERMARK_SETTINGS`' note). */
export const BATES_NUMBER_SETTINGS = z.object({
  prefix: z.string().max(100),
  suffix: z.string().max(100),
  start: z.number().int().nonnegative().max(999_999_999),
  digits: z.number().int().min(1).max(12),
  edge: z.enum(['header', 'footer']),
  slot: z.enum(['left', 'centre', 'right']),
  family: annotationFamilySchema,
  fontSize: z.number().positive().max(1000),
  marginPoints: z.number().nonnegative().max(500),
});

/** See {@link BATES_NUMBER_SETTINGS}. */
export type BatesNumberSettings = z.infer<typeof BATES_NUMBER_SETTINGS>;

export const BATES_NUMBER_RESULT = BATES_NUMBER_SETTINGS.extend({
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
}).strict();

/** The identifier's parts, its placement and the scope. */
export type BatesNumberAnswer = z.infer<typeof BATES_NUMBER_RESULT>;
