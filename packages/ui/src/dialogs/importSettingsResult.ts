import { lazy } from 'react';
import { z } from 'zod';

import { SETTINGS_IMPORT_RESULT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { SKIPPED_SETTING_REASONS } from '../settingsStore.js';

/** The id Import settings opens when a file named values this build left out. */
export const IMPORT_SETTINGS_RESULT_DIALOG_ID = 'dialog.import-settings-result';

/** The most left-out values the dialog names one by one; the rest are counted. */
export const MAX_NAMED_SETTINGS = 50;

/**
 * What a settings import left out, each value by name with its reason (Codex's importer audit): it counted them, which
 * tells a person something was dropped and not what. A setting this build has is named by its title; one it does not
 * have is named by the id the file gave, as written. Nothing here asks a question: it informs and is closed.
 */
export const IMPORT_SETTINGS_RESULT_DIALOG = declareDialog({
  id: IMPORT_SETTINGS_RESULT_DIALOG_ID,
  title: SETTINGS_IMPORT_RESULT_TITLE,
  informs: 'message',
  props: z
    .object({
      applied: z.number().int().nonnegative(),
      skipped: z
        .array(
          z
            .object({
              id: z.string().max(256),
              title: z.string().max(256).optional(),
              reason: z.enum(SKIPPED_SETTING_REASONS),
            })
            .strict(),
        )
        .max(MAX_NAMED_SETTINGS),
      more: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./ImportSettingsResultBody.js')),
});
