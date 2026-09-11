import { lazy } from 'react';
import { z } from 'zod';

import { ENHANCE_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `enhanceScansCommand` opens when it has finished. */
export const ENHANCE_OUTCOME_DIALOG_ID = 'dialog.enhance-outcome';

/**
 * What levelling the scans did.
 *
 * ## Why a dialog, when the pages are visibly different
 *
 * For the one outcome that is not visible: a document with no image-only pages has
 * nothing to level, and a command that walked it and closed silently is
 * indistinguishable from one that is broken. `ocrOutcome.ts`' argument, one
 * operation along.
 *
 * ## IT CARRIES THE PAGE COUNT AND NOT THE SKIPPED ONE, deliberately
 *
 * `enhancePages` counts the images it could not round-trip and `document.execute`
 * does **not** carry that back — it answers a version and a byte length. A
 * `skipped` prop here would therefore be `null` on every call this build makes,
 * which is a field nothing reads and a branch no case can reach.
 *
 * The count is not lost: `pageEnhance.ts` returns it and `pageEnhance.test.ts`
 * asserts it, which is where the claim belongs until a surface has a way to ask.
 * Inventing a channel for one number would be a second answer to *what did that
 * command do* beside the document itself.
 */
export const ENHANCE_OUTCOME_DIALOG = declareDialog({
  id: ENHANCE_OUTCOME_DIALOG_ID,
  title: ENHANCE_OUTCOME_TITLE,
  props: z
    .object({
      /** How many pages were sent to be levelled. */
      pages: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./EnhanceOutcomeBody.js')),
});
