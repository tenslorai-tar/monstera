import { lazy } from 'react';
import { z } from 'zod';

import { STALE_COPIES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a removal's save opens when it left older copies that may hold what was removed. */
export const STALE_COPIES_DIALOG_ID = 'dialog.stale-copies';

/**
 * The answer that deletes them. One member: *Delete permanently*. Keeping them is the dismissal, so the platform's ×
 * and Escape are never the destructive answer.
 */
export const STALE_COPIES_RESULT = z.object({ delete: z.literal(true) }).strict();

/**
 * Item 6 of the 29 September list: a save after a redaction or Sanitize writes no backup, and this lists every older
 * copy that may still hold what was removed — each backup beside the file by name, and Monstera's own undo copies by
 * count — before anything is deleted. Deleting is permanent: not the recycle bin, which would keep them.
 */
export const STALE_COPIES_DIALOG = declareDialog({
  id: STALE_COPIES_DIALOG_ID,
  title: STALE_COPIES_TITLE,
  props: z
    .object({
      backups: z.array(z.string().min(1)).readonly(),
      undoCopies: z.number().int().nonnegative(),
    })
    .strict(),
  result: STALE_COPIES_RESULT,
  component: lazy(() => import('./StaleCopiesBody.js')),
});
