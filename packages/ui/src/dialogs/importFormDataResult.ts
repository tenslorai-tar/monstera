import { MAX_IMPORT_SKIPS, importSkippedSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_RESULT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the import commands open when a file filled the form and left some fields alone. */
export const IMPORT_FORM_DATA_RESULT_DIALOG_ID = 'dialog.import-form-data-result';

/**
 * What an import did, said when it left something alone.
 *
 * ## The report is the plan the fill followed
 *
 * A form data file rarely matches a form field for field, and a person who imports one is owed which fields it filled
 * and which it did not, with the reason each time: a locked field, a name the form lacks, a value the field will not
 * take. The application's own export imports with nothing left alone, so this does not open for it. Nothing here asks a
 * question: it informs and is closed.
 */
export const IMPORT_FORM_DATA_RESULT_DIALOG = declareDialog({
  id: IMPORT_FORM_DATA_RESULT_DIALOG_ID,
  title: IMPORT_RESULT_TITLE,
  informs: 'message',
  props: z
    .object({
      filled: z.number().int().nonnegative(),
      skipped: z.array(importSkippedSchema).max(MAX_IMPORT_SKIPS),
      more: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./ImportFormDataResultBody.js')),
});
