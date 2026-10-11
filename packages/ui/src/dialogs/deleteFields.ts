import { lazy } from 'react';
import { z } from 'zod';

import { DELETE_FIELDS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the field Delete opens when it is about to remove more than one field. */
export const DELETE_FIELDS_DIALOG_ID = 'dialog.delete-fields';

/** The answer: the person said yes. A dismissal answers nothing, and nothing is removed. */
export const DELETE_FIELDS_RESULT = z.object({ confirmed: z.literal(true) }).strict();

/**
 * Asked before SEVERAL form fields are removed at once (the owner's D2: *the Delete key deletes the selected fields; it
 * asks first if more than one*). One field is removed without a question, because Undo brings it back and the person
 * can see which one went; several selected by a marquee or a run may hold one nobody meant.
 */
export const DELETE_FIELDS_DIALOG = declareDialog({
  id: DELETE_FIELDS_DIALOG_ID,
  title: DELETE_FIELDS_TITLE,
  props: z.object({ count: z.number().int().min(2) }).strict(),
  result: DELETE_FIELDS_RESULT,
  component: lazy(() => import('./DeleteFieldsBody.js')),
});
