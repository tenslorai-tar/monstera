import { lazy } from 'react';
import { z } from 'zod';

import { KEPT_BACKUPS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a removal's save opens when it kept a file named like a backup that Monstera did not make. */
export const KEPT_BACKUPS_DIALOG_ID = 'dialog.kept-backups';

/**
 * A removal's save deletes, unasked, the older copies Monstera made
 * ([ADR-0139](../../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)), and keeps any
 * file beside the document named like a backup that Monstera did not make. This names each one, because it may still
 * hold what was removed and only the person can decide about a file Monstera did not make.
 *
 * A dialog and not a toast: a toast carries no names and leaves in four seconds, and this is the one thing about the
 * save the person has to act on.
 */
export const KEPT_BACKUPS_DIALOG = declareDialog({
  id: KEPT_BACKUPS_DIALOG_ID,
  title: KEPT_BACKUPS_TITLE,
  informs: 'message',
  props: z.object({ kept: z.array(z.string().min(1)).min(1).readonly() }).strict(),
  component: lazy(() => import('./KeptBackupsBody.js')),
});
