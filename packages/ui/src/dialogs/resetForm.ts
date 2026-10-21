import { lazy } from 'react';
import { z } from 'zod';

import { RESET_FORM_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Reset form* opens before it clears anything. */
export const RESET_FORM_DIALOG_ID = 'dialog.reset-form';

/** The answer: the person said yes. A dismissal answers nothing, and nothing is cleared. */
export const RESET_FORM_RESULT = z.object({ confirmed: z.literal(true) }).strict();

/**
 * Asked before the whole form is cleared (the owner's R23): one press would otherwise take away everything a person has
 * typed, and a person who pressed it by mistake would learn so only by looking at every field.
 */
export const RESET_FORM_DIALOG = declareDialog({
  id: RESET_FORM_DIALOG_ID,
  title: RESET_FORM_DIALOG_TITLE,
  props: z.object({}).strict(),
  result: RESET_FORM_RESULT,
  component: lazy(() => import('./ResetFormBody.js')),
});
