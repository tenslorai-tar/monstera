import { z } from 'zod';

/**
 * What the reimport confirmation answers with — **its own module for
 * `replacePageResult.ts`' forced reason**: the entry imports the body lazily and the body
 * needs this type, so declaring it beside the entry makes the two circular.
 *
 * One field, and not aliased to any other dialog's shape, for that module's reason. A
 * dismissal answers `undefined`, which is *not now*: the page stays out and watched.
 */
export const REIMPORT_EXTERNAL_EDIT_RESULT = z.object({ reimport: z.literal(true) }).strict();

/** The person's yes to putting the edited page back. */
export type ReimportExternalEditAnswer = z.infer<typeof REIMPORT_EXTERNAL_EDIT_RESULT>;
