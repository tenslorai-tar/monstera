import { lazy } from 'react';
import { z } from 'zod';

import { OCR_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the OCR command opens when its walk has finished. */
export const OCR_OUTCOME_DIALOG_ID = 'dialog.ocr-outcome';

/**
 * What a recognition did, once it has finished.
 *
 * ## Why a dialog AT ALL, when the document itself is the answer
 *
 * Because one outcome cannot be seen: a document whose every page already carries
 * text has nothing to recognise, and a command that walked it and closed silently
 * is indistinguishable from one that is broken. §10.5's empty state, and the
 * numbers are what make the ordinary case worth reading too — *every page already
 * had text* is the sentence a reader needs when nothing appears to have happened.
 *
 * ## A CANCELLED RUN IS REPORTED, which is the opposite of the spell check's rule
 *
 * `checkSpelling` publishes nothing when cancelled, because a partial list of
 * misspellings reads exactly like the document's whole answer. The asymmetry is
 * deliberate and the reason is the noun: a recognised page is **correct work on
 * the document**, so a cancelled run has left real text behind and saying so is
 * the honest report rather than a misleading one.
 *
 * It answers nothing — `declareDialog` gives an entry no result unless it declares
 * one (ADR-0038), so this is informational by construction.
 */
export const OCR_OUTCOME_DIALOG = declareDialog({
  id: OCR_OUTCOME_DIALOG_ID,
  title: OCR_OUTCOME_TITLE,
  props: z
    .object({
      /** How many pages gained a text layer. */
      recognised: z.number().int().nonnegative(),
      /** How many were left alone because they already carried text. */
      skipped: z.number().int().nonnegative(),
      /** Whether the reader stopped it. */
      stopped: z.boolean(),
    })
    .strict(),
  component: lazy(() => import('./OcrOutcomeBody.js')),
});
