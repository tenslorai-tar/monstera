import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_WORD_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_WORD_DIALOG_ID = 'dialog.export-word';

/**
 * What the Word export dialog answers: the mode, and the pages (ADR-0161).
 *
 * The same three mode names `document.exportWord` takes, so the dialog's answer is the channel's field and nothing
 * translates between them. The pages are already parsed, for the page-image export's reason: *every page* and *these
 * pages* both produce a list, so the row's option does not travel.
 */
export const EXPORT_WORD_RESULT = z
  .object({ mode: z.enum(['text', 'layout', 'rich']), pages: z.array(z.number().int().nonnegative()).min(1) })
  .strict();

export type ExportWordAnswer = z.infer<typeof EXPORT_WORD_RESULT>;

export const EXPORT_WORD_DIALOG = declareDialog({
  id: EXPORT_WORD_DIALOG_ID,
  title: EXPORT_WORD_TITLE,
  // THE PAGE COUNT GOES IN, the page-image dialog's reason: *every page* builds the list from it, and *Select pages*
  // refuses a page the document lacks.
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: EXPORT_WORD_RESULT,
  component: lazy(() => import('./ExportWordBody.js')),
});
