import { z } from 'zod';

/**
 * What the insert-images dialog answers — its own module for `deletePagesResult.ts`' reason. `at` is zero-based in the
 * target's frame, converted once by `placementAt`. The pictures are picked in `main` after this answer, so the dialog
 * names none.
 */
export const INSERT_IMAGES_RESULT = z.object({ at: z.number().int().nonnegative() }).strict();

/** Where the pictures' pages go. */
export type InsertImagesAnswer = z.infer<typeof INSERT_IMAGES_RESULT>;
