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
const DPI = z.union([z.literal(150), z.literal(300), z.literal(600)]);

export const PRINT_RESULT = z.object({ dpi: DPI }).strict();

export type PrintAnswer = z.infer<typeof PRINT_RESULT>;

export const PRINT_DIALOG = declareDialog({
  id: PRINT_DIALOG_ID,
  title: PRINT_TITLE,
  // THE RESOLUTION IT STARTS ON — Settings › Rendering › *Print quality*, which the command reads.
  props: z.object({ dpi: DPI }).strict(),
  result: PRINT_RESULT,
  component: lazy(() => import('./PrintBody.js')),
});
