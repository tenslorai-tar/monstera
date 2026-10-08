import { MAX_BACKUP_COPIES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { LEGACY_BACKUPS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { LEGACY_BACKUPS_RESULT } from './legacyBackupsResult.js';

/** The id the offer to move old `.bak` files opens, once per folder (ADR-0198 Decision 5). */
export const LEGACY_BACKUPS_DIALOG_ID = 'dialog.legacy-backups';

/**
 * Asks whether to move the old `.bak` files beside a document that Monstera made into its own folder. **How many it can
 * prove it made** is `proven`; `unproven` counts the files with a backup's name it did not make, which stay where they
 * are and which the dialog says. The answer is *move* or *leave them*; a dismissal is *leave them*, and either is remembered
 * by main so the folder is asked about once.
 */
export const LEGACY_BACKUPS_DIALOG = declareDialog({
  id: LEGACY_BACKUPS_DIALOG_ID,
  title: LEGACY_BACKUPS_TITLE,
  props: z
    .object({
      proven: z.number().int().positive().max(MAX_BACKUP_COPIES),
      unproven: z.number().int().nonnegative().max(MAX_BACKUP_COPIES),
    })
    .strict(),
  result: LEGACY_BACKUPS_RESULT,
  component: lazy(() => import('./LegacyBackupsBody.js')),
});
