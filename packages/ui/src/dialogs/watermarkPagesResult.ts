import { z } from 'zod';

/**
 * What the watermark dialog answers with.
 *
 * Its own module for `cropPagesResult.ts`'s reason, and it is a property of the
 * lazy seam rather than of this feature: the entry imports its body with
 * `lazy(() => import(…))` and the body needs the answer's type, so a schema
 * declared beside the entry makes the two files circular.
 *
 * ## The bounds are the COMMAND's, restated
 *
 * Every field here carries the same bound `watermarkPagesSchema` does, and that
 * is a copy rather than an import on purpose: `packages/ui` may not import the
 * kernel, and the contract's schema describes a **command** where this
 * describes a **dialog answer**. The two are the same today and need not stay
 * so — a dialog may one day collect something the command derives.
 *
 * What makes the copy safe is that it cannot drift silently in the direction
 * that matters. A bound loosened here produces a value `resolve` accepts and
 * the boundary refuses, which is a thrown `DialogResultRejected` in front of
 * the user rather than a bad command — loud, and at the moment of the mistake.
 */
export const WATERMARK_PAGES_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    text: z.string().min(1).max(200),
    opacity: z.number().min(0).max(1),
    rotationDegrees: z.number().min(-360).max(360),
    fontSize: z.number().positive().max(1000),
  })
  .strict();

/** The watermark's text, appearance and scope, as the dialog produced them. */
export type WatermarkPagesAnswer = z.infer<typeof WATERMARK_PAGES_RESULT>;
