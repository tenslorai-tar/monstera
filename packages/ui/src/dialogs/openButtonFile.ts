import { MAX_ACTION_FILE } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { OPEN_BUTTON_FILE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a push button's Open a file opens before anything is opened (ADR-0259). */
export const OPEN_BUTTON_FILE_DIALOG_ID = 'dialog.open-button-file';

/** The one answer that opens. Closing the dialog opens nothing. */
export const OPEN_BUTTON_FILE_RESULT = z.object({ open: z.literal(true) }).strict();

/** Asked before a push button opens a PDF beside the document: the file's name as the button's action holds it. */
export const OPEN_BUTTON_FILE_DIALOG = declareDialog({
  id: OPEN_BUTTON_FILE_DIALOG_ID,
  title: OPEN_BUTTON_FILE_TITLE,
  props: z.object({ file: z.string().max(MAX_ACTION_FILE) }).strict(),
  result: OPEN_BUTTON_FILE_RESULT,
  component: lazy(() => import('./OpenButtonFileBody.js')),
});
