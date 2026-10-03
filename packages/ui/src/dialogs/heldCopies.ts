import { lazy } from 'react';
import { z } from 'zod';

import { HELD_COPIES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a save opens when an older copy that still holds what was removed could not be deleted. */
export const HELD_COPIES_DIALOG_ID = 'dialog.held-copies';

/** The answer that asks main to try the delete again. Keeping the copies for now is the dismissal. */
export const HELD_COPIES_RESULT = z.object({ delete: z.literal(true) }).strict();

/**
 * Names each older copy of the document that still holds what a removal took out, because another program had it
 * open when the save went to delete it (CR-DOC-10, the owner's decision of 2026-10-03). The save itself succeeded, so
 * this is not a save problem: it says which copy, why, and offers to delete it now. `still` is the same notice after a
 * retry found the copy held again.
 *
 * A dialog and not a toast, for `dialog.kept-backups`' reason: it carries names, and it is the one thing about the
 * save the person has to act on.
 */
export const HELD_COPIES_DIALOG = declareDialog({
  id: HELD_COPIES_DIALOG_ID,
  title: HELD_COPIES_TITLE,
  props: z.object({ held: z.array(z.string().min(1)).min(1).readonly(), still: z.boolean() }).strict(),
  result: HELD_COPIES_RESULT,
  component: lazy(() => import('./HeldCopiesBody.js')),
});
