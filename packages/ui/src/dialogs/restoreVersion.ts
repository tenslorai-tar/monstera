import { MAX_BACKUP_COPIES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { RESTORE_VERSION_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { KEPT_VERSION, RESTORE_VERSION_RESULT } from './restoreVersionResult.js';

/** The id `restoreVersionCommand` opens to choose which earlier version to restore. */
export const RESTORE_VERSION_DIALOG_ID = 'dialog.restore-version';

/**
 * The earlier versions of the open document Monstera kept, newest first, with the date and time each was saved over
 * ([ADR-0198](../../../../docs/DECISIONS/0198-backups-live-in-monsteras-own-data-folder-keyed-by-the-files-canonical-path-and-nothing-is-written-beside-the-file.md)).
 * One answers: the version to write out as a COPY. The version itself is never opened, so saving cannot overwrite it.
 */
export const RESTORE_VERSION_DIALOG = declareDialog({
  id: RESTORE_VERSION_DIALOG_ID,
  title: RESTORE_VERSION_TITLE,
  // THE COUNT A PERSON KEEPS, and the copy-aside where a rotation was refused.
  props: z.object({ versions: z.array(KEPT_VERSION).min(1).max(MAX_BACKUP_COPIES + 1) }).strict(),
  result: RESTORE_VERSION_RESULT,
  component: lazy(() => import('./RestoreVersionBody.js')),
});
