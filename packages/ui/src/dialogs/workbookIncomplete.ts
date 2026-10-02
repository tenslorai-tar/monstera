import { MAX_OFFICE_MISSING_BLOCKS, MAX_WORKBOOK_ROW, MAX_WORKBOOK_SHEET_NAME } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { WORKBOOK_INCOMPLETE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const WORKBOOK_INCOMPLETE_DIALOG_ID = 'dialog.workbook-incomplete';

/**
 * A workbook that OPENED with rows the converter could not convert (ADR-0120 decision C): each block named by sheet and
 * rows, because "some rows are missing" is the silence the owner ruled out, and past the channel's bound the rest
 * counted.
 *
 * Its own dialog and not a reason of the import problem's, whose title says the import did not finish: this one did,
 * and the document is open beside it.
 */
export const workbookIncompleteSchema = z
  .object({
    missing: z
      .array(
        z
          .object({
            sheet: z.string().max(MAX_WORKBOOK_SHEET_NAME),
            from: z.number().int().min(1).max(MAX_WORKBOOK_ROW),
            to: z.number().int().min(1).max(MAX_WORKBOOK_ROW),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_OFFICE_MISSING_BLOCKS),
    more: z.number().int().min(0),
  })
  .strict();

export type WorkbookIncomplete = z.infer<typeof workbookIncompleteSchema>;

export const WORKBOOK_INCOMPLETE_DIALOG = declareDialog({
  id: WORKBOOK_INCOMPLETE_DIALOG_ID,
  title: WORKBOOK_INCOMPLETE_TITLE,
  informs: 'message',
  props: workbookIncompleteSchema,
  component: lazy(() => import('./WorkbookIncompleteBody.js')),
});
