import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_EXCEL_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_EXCEL_DIALOG_ID = 'dialog.export-excel';

/**
 * What the Excel export dialog answers: where the tables go — D10's
 * *combine-pages option*.
 *
 * The same two names `document.exportExcel` takes, so the dialog's answer is the
 * channel's field and nothing translates between them.
 */
export const EXPORT_EXCEL_RESULT = z.object({ layout: z.enum(['sheet-per-page', 'one-sheet']) }).strict();

export type ExportExcelAnswer = z.infer<typeof EXPORT_EXCEL_RESULT>;

export const EXPORT_EXCEL_DIALOG = declareDialog({
  id: EXPORT_EXCEL_DIALOG_ID,
  title: EXPORT_EXCEL_TITLE,
  props: z.object({}).strict(),
  result: EXPORT_EXCEL_RESULT,
  component: lazy(() => import('./ExportExcelBody.js')),
});
