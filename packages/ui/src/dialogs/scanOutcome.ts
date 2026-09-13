import { lazy } from 'react';
import { z } from 'zod';

import { SCAN_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `straightenScansCommand` opens when it has finished. */
export const SCAN_OUTCOME_DIALOG_ID = 'dialog.scan-outcome';

/**
 * What straightening the scans did.
 *
 * `enhanceOutcome.ts`' shape and its note, one operation along: the page COUNT and not
 * which of them held a sheet, because `document.execute` answers a version and a byte
 * length, and a per-page answer would be a field this build could never fill. The kernel
 * answers it — `pageScan.ts` names each page's outcome and `pageScan.test.ts` asserts it.
 */
export const SCAN_OUTCOME_DIALOG = declareDialog({
  id: SCAN_OUTCOME_DIALOG_ID,
  title: SCAN_OUTCOME_TITLE,
  props: z
    .object({
      /** How many scanned pages were looked at. */
      pages: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./ScanOutcomeBody.js')),
});
