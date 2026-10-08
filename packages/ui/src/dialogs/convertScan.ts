import { lazy } from 'react';
import { z } from 'zod';

import { CONVERT_SCAN_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { CONVERT_SCAN_RESULT } from './convertScanResult.js';

/** The id `convertScanCommand` opens to explain the three things a scan can become. */
export const CONVERT_SCAN_DIALOG_ID = 'dialog.convert-scan';

/**
 * One place that says, in plain words, what a scanned or handwritten document can be turned into, and goes to the right
 * command: a searchable PDF, a Word file, or an Excel workbook. **It takes no props and holds no logic of its own** — the
 * three controls it offers are commands that already exist, so the explanation can never describe something the application
 * does not do.
 */
export const CONVERT_SCAN_DIALOG = declareDialog({
  id: CONVERT_SCAN_DIALOG_ID,
  title: CONVERT_SCAN_TITLE,
  props: z.object({}).strict(),
  result: CONVERT_SCAN_RESULT,
  component: lazy(() => import('./ConvertScanBody.js')),
});
