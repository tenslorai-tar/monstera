import { lazy } from 'react';
import { z } from 'zod';

import { SCAN_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `straightenScansCommand` opens when it has finished. */
export const SCAN_OUTCOME_DIALOG_ID = 'dialog.scan-outcome';

/**
 * What cropping photographed pages to the paper did, counted from each page's own read before the write
 * (`document.pageAdjustment`, the owner's N3) — so a page that held no sheet is not counted as cropped, which the
 * sentence this replaced could not tell apart.
 */
export const SCAN_OUTCOME_DIALOG = declareDialog({
  id: SCAN_OUTCOME_DIALOG_ID,
  title: SCAN_OUTCOME_TITLE,
  informs: 'message',
  props: z
    .object({
      /** How many photographed pages were looked at: pages whose only content is a picture. */
      scanned: z.number().int().nonnegative(),
      /** How many of them are now cropped to the sheet found in them. */
      cropped: z.number().int().nonnegative(),
      /** How many could not be read and were left as they were. */
      unreadable: z.number().int().nonnegative(),
      /** Whether the document is one page, so the sentence says *the page* rather than counting one. */
      onePage: z.boolean(),
    })
    .strict(),
  component: lazy(() => import('./ScanOutcomeBody.js')),
});
