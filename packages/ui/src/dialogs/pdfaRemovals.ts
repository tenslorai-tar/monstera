import { MAX_PDFA_REMOVAL_CHARS, MAX_PDFA_REMOVALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PDFA_REMOVALS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PDFA_REMOVALS_DIALOG_ID = 'dialog.pdfa-removals';

/**
 * What a PDF/A-2b export removed to conform, after the file was written (ADR-0075).
 *
 * Opened only when something was removed: Ghostscript's exit code does not say, so the
 * lines it printed are the one honest report, shown in its own words. Informational — it
 * answers nothing.
 */
export const PDFA_REMOVALS_DIALOG = declareDialog({
  id: PDFA_REMOVALS_DIALOG_ID,
  title: PDFA_REMOVALS_TITLE,
  props: z
    .object({
      removed: z.array(z.string().max(MAX_PDFA_REMOVAL_CHARS)).min(1).max(MAX_PDFA_REMOVALS).readonly(),
    })
    .strict(),
  component: lazy(() => import('./PdfaRemovalsBody.js')),
});
