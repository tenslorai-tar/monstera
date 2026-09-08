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
 * ## Every candidate becomes a TEXT field, and the dialog says so
 *
 * The detector proposes places, not kinds — it measured nothing about what
 * separates a tick box from a rule, and a build that guessed would be inventing
 * a classification the row has no reading for. A ruled line beside a label is
 * overwhelmingly somewhere to write words, and the five drawing tools exist for
 * the rest.
 */
export const FLAT_FIELDS_DIALOG = declareDialog({
  id: FLAT_FIELDS_DIALOG_ID,
  title: FLAT_FIELDS_TITLE,
  props: z
    .object({
      candidates: z.array(z.object({ name: z.string(), label: z.string() })),
      truncated: z.boolean(),
    })
    .strict(),
  result: FLAT_FIELDS_RESULT,
  component: lazy(() => import('./FlatFieldsBody.js')),
});
