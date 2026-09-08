import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_FORM_DATA_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the import commands open when a picked file did not fill the form. */
export const IMPORT_FORM_DATA_PROBLEM_DIALOG_ID = 'dialog.import-form-data-problem';

/**
 * What the user is told when the data file they picked changed nothing.
 *
 * ## `insertImageProblem.ts`' shape and every one of its arguments
 *
 * Not `dialog.command-problem`, whose props are a union of **failure codes**:
 * the channel answered `ok` here, and what it reported is that the *file* was
 * the problem. A dismissal opens nothing, because the user did that on purpose.
 * `too-large` carries the limit, because *too large* without a number is
 * something nobody can act on. And it answers nothing, which `declareDialog`
 * gives by default.
 *
 * ## The unreadable message names THREE causes, and that is not vagueness
 *
 * A file may not be form data, may name no field this document has, or may hold
 * a value one of those fields refuses. All three are the apply refusing, inside
 * the engine host, and an apply's refusal reason does not cross that boundary —
 * it arrives as `internal` with the diagnostic withheld, by design. So the
 * message lists the three rather than picking one, because picking one would be
 * a guess the reader would act on.
 */
export const IMPORT_FORM_DATA_PROBLEM_DIALOG = declareDialog({
  id: IMPORT_FORM_DATA_PROBLEM_DIALOG_ID,
  title: IMPORT_FORM_DATA_PROBLEM_TITLE,
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }),
  ]),
  component: lazy(() => import('./ImportFormDataProblemBody.js')),
});
