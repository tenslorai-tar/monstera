import { z } from 'zod';

/** The answer to the offer: move the backups Monstera made, or leave them where they are. Its own module for the lazy body's reason. */
export const LEGACY_BACKUPS_RESULT = z.object({ move: z.boolean() }).strict();

export type LegacyBackupsAnswer = z.infer<typeof LEGACY_BACKUPS_RESULT>;
