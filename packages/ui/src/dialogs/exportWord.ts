import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_WORD_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_WORD_DIALOG_ID = 'dialog.export-word';

/**
 * What the Word export dialog answers: the one choice a Word export has.
 *
 * The same three names `document.exportWord` takes, so the dialog's answer is the
 * channel's field and nothing translates between them.
 */
export const EXPORT_WORD_RESULT = z.object({ mode: z.enum(['text', 'layout', 'rich']) }).strict();

export type ExportWordAnswer = z.infer<typeof EXPORT_WORD_RESULT>;

export const EXPORT_WORD_DIALOG = declareDialog({
  id: EXPORT_WORD_DIALOG_ID,
  title: EXPORT_WORD_TITLE,
  props: z.object({}).strict(),
  result: EXPORT_WORD_RESULT,
  component: lazy(() => import('./ExportWordBody.js')),
});
