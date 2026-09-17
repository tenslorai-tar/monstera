import { lazy } from 'react';
import { z } from 'zod';

import { PRINT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PRINT_DIALOG_ID = 'dialog.print';

/**
 * What the print dialog answers: the resolution each page is rasterised at. The
 * printer, pages and copies are the operating system's dialog's, which main opens
 * next (ADR-0074). The same three values `document.print` takes.
 */
export const PRINT_RESULT = z.object({ dpi: z.union([z.literal(150), z.literal(300), z.literal(600)]) }).strict();

export type PrintAnswer = z.infer<typeof PRINT_RESULT>;

export const PRINT_DIALOG = declareDialog({
  id: PRINT_DIALOG_ID,
  title: PRINT_TITLE,
  props: z.object({}).strict(),
  result: PRINT_RESULT,
  component: lazy(() => import('./PrintBody.js')),
});
