import { annotationColourSchema, annotationFamilySchema } from '@monstera/contract';
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

/** The settings without the pages, as the dialog collects them and the engine records them (`WATERMARK_SETTINGS`' note). */
export const HEADER_FOOTER_SETTINGS = z.object({
  header: slots,
  footer: slots,
  family: annotationFamilySchema,
  fontSize: z.number().positive().max(1000),
  marginPoints: z.number().nonnegative().max(500),
  /** Left out, the black headers and footers were before ADR-0246. */
  colour: annotationColourSchema.optional(),
});

/** See {@link HEADER_FOOTER_SETTINGS}. */
export type HeaderFooterSettings = z.infer<typeof HEADER_FOOTER_SETTINGS>;

export const HEADER_FOOTER_RESULT = HEADER_FOOTER_SETTINGS.extend({
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
}).strict();

/** The six slots, the font, the type size, the margin, the colour and the scope. */
export type HeaderFooterAnswer = z.infer<typeof HEADER_FOOTER_RESULT>;
