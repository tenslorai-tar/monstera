import { lazy } from 'react';
import { z } from 'zod';

import { PRINT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PRINT_DIALOG_ID = 'dialog.print';

/**
 * What the print dialog answers: the resolution each page is rasterised at, and the pages the operating system's
 * dialog opens on (ADR-0161). The printer and copies are that dialog's, which main opens next (ADR-0074), and the
 * pages chosen there are the ones printed. The same three resolutions `document.print` takes.
 */
const DPI = z.union([z.literal(150), z.literal(300), z.literal(600)]);

export const PRINT_RESULT = z.object({ dpi: DPI, pages: z.array(z.number().int().nonnegative()).min(1) }).strict();

export type PrintAnswer = z.infer<typeof PRINT_RESULT>;

export const PRINT_DIALOG = declareDialog({
  id: PRINT_DIALOG_ID,
  title: PRINT_TITLE,
  // THE RESOLUTION IT STARTS ON — Settings › Rendering › *Print quality*, which the command reads — and the page count
  // the page row builds *every page* from and checks a typed page against.
  props: z.object({ dpi: DPI, pageCount: z.number().int().positive() }).strict(),
  result: PRINT_RESULT,
  component: lazy(() => import('./PrintBody.js')),
});
