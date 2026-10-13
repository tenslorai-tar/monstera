import { listedFontFamiliesSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { NEW_FROM_TEXT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { NEW_FROM_TEXT_RESULT } from './newFromTextResult.js';

/** The id `newFromMarkdownCommand` and `newFromCsvCommand` open before main's picker. */
export const NEW_FROM_TEXT_DIALOG_ID = 'dialog.new-from-text';

/**
 * The font a new PDF from a Markdown or CSV file is set in (the owner's L4): Insert from Markdown's font row, without the
 * position, since a new document has no pages to place among.
 *
 * ## It answers a font, and nothing else
 *
 * The file is picked, read and composed in `main` after this answer (`document.newFromMarkdown`, `document.newFromCsv`), so
 * the dialog names no file. Closed unanswered is a change of mind, and nothing is picked or written.
 */
export const NEW_FROM_TEXT_DIALOG = declareDialog({
  id: NEW_FROM_TEXT_DIALOG_ID,
  title: NEW_FROM_TEXT_TITLE,
  props: z
    .object({
      /** The fonts `app.fontFamilies` answered when the dialog opened; absent where the read failed. */
      fonts: listedFontFamiliesSchema.optional(),
    })
    .strict(),
  result: NEW_FROM_TEXT_RESULT,
  component: lazy(() => import('./NewFromTextBody.js')),
});
