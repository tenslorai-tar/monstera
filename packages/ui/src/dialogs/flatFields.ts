import { lazy } from 'react';
import { z } from 'zod';

import { FLAT_FIELDS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { FLAT_FIELDS_RESULT } from './flatFieldsResult.js';

/** The id `detectFlatFieldsCommand` opens to review a page's candidates. */
export const FLAT_FIELDS_DIALOG_ID = 'dialog.flat-fields';

/**
 * The review a detected field has to pass before it exists.
 *
 * ## THE REVIEW IS THE FEATURE, and that is the measurement rather than caution
 *
 * Measured 2026-09-08 (`scripts/research/flatFieldDetection.mjs`): **a field and
 * an empty table cell are the same rectangle.** A filled cell is not a field
 * because it holds a value already; an empty ruled box beside a label is a
 * place to write, which is what a field is — so on a blank timesheet the two
 * are indistinguishable, and the best rule tested still calls six of its cells
 * fields.
 *
 * Chasing that number is the wrong move, because on a blank timesheet the cells
 * genuinely are places to write. What the measurement says is that the
 * distinction is not a property of the page, so the honest surface is a
 * proposal a person accepts — and the accept is ONE `createFormField` carrying
 * everything ticked, which is one decision, one log entry and one undo.
 *
 * ## It opens even when nothing was found, which is `duplicatePages`' rule
 *
 * A command that silently did nothing on a page with no candidates is one a
 * person presses twice. The empty case is reported in words with the accept
 * disabled — *found nothing* said out loud is the difference between a
 * measurement and a control that appears broken.
 *
 * ## `truncated` rides in for the duplicate report's reason
 *
 * A person offered *accept them all* against a clipped list would accept some
 * and be told it had finished.
 *
 * ## A line or a wide box becomes a text field, a small square becomes a tick box, and each row says which
 *
 * This said every candidate became a text field until 2026-10-07, because the detector measured nothing about what
 * separates a tick box from a rule. The owner's form-test.pdf is full of small squares with their words on the right,
 * and a text field over each was the wrong field. A square 6 to 26 points each way and about as wide as high is a tick
 * box (`flatFields.ts`' `tickSized`); the row names the kind, so a person can untick a guess.
 *
 * ## The places that already hold a field are COUNTED, not listed
 *
 * They are not proposals: a box with a field in it is one, and proposing it again made a second field beside the
 * first. Saying how many were left out is the difference between a detector that found nothing and one that found the
 * form is already fillable.
 */
export const FLAT_FIELDS_DIALOG = declareDialog({
  id: FLAT_FIELDS_DIALOG_ID,
  title: FLAT_FIELDS_TITLE,
  props: z
    .object({
      candidates: z.array(z.object({ name: z.string(), label: z.string(), kind: z.enum(['text', 'checkbox']) })),
      truncated: z.boolean(),
      /** Places that look like a field and already hold one, left out of the list so none is made twice. */
      alreadyFields: z.number().int().nonnegative(),
    })
    .strict(),
  result: FLAT_FIELDS_RESULT,
  component: lazy(() => import('./FlatFieldsBody.js')),
});
