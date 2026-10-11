import { lazy } from 'react';
import { z } from 'zod';

import { FLATTEN_FORM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Flatten form* opens before it changes anything. */
export const FLATTEN_FORM_DIALOG_ID = 'dialog.flatten-form';

/**
 * The answer that lets the flatten go ahead: *Flatten form*, for the whole form or only the selected fields (ADR-0226
 * Decision 16). Keeping the form is the dismissal, so the platform's × and Escape are never the answer that removes it.
 */
export const FLATTEN_FORM_RESULT = z.object({ flatten: z.literal(true), scope: z.enum(['all', 'selected']) }).strict();

/**
 * Asked before a flatten, from the ribbon and from the Forms panel alike (the owner's F-F1). The undo is a checkpoint,
 * which the document drops when it closes, and the page looks the same afterwards: a person who pressed the control
 * without knowing what it does would not see what they had lost until they tried to type into a field.
 *
 * `selected` is how many fields are selected: with none, the whole form is the only choice and none is offered.
 */
export const FLATTEN_FORM_DIALOG = declareDialog({
  id: FLATTEN_FORM_DIALOG_ID,
  title: FLATTEN_FORM_TITLE,
  props: z.object({ selected: z.number().int().nonnegative() }).strict(),
  result: FLATTEN_FORM_RESULT,
  component: lazy(() => import('./FlattenFormBody.js')),
});
