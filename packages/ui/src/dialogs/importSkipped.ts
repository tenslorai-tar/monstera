import { MAX_COMPOSE_SKIPS, importSkippedPartSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_SKIPPED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id an import opens when it composed the file and left some of it out. */
export const IMPORT_SKIPPED_DIALOG_ID = 'dialog.import-skipped';

/**
 * What an import left out, each part with its reason (Codex's importer audit): a CSV record by its line, a picked image
 * by its file's name. It opens after the document does, beside it, as the boxed characters' list does. Nothing here asks
 * a question: the document is open with every other part in it.
 */
export const IMPORT_SKIPPED_DIALOG = declareDialog({
  id: IMPORT_SKIPPED_DIALOG_ID,
  title: IMPORT_SKIPPED_TITLE,
  informs: 'message',
  props: z
    .object({
      skipped: z.array(importSkippedPartSchema).min(1).max(MAX_COMPOSE_SKIPS),
      more: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./ImportSkippedBody.js')),
});
