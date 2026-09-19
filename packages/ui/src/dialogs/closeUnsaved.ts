import { lazy } from 'react';
import { z } from 'zod';

import { CLOSE_UNSAVED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const CLOSE_UNSAVED_DIALOG_ID = 'dialog.close-unsaved';

/** The three answers. A dismissed dialog answers nothing, which the close path reads as `cancel`. */
export const CLOSE_UNSAVED_RESULT = z.enum(['save', 'discard', 'cancel']);

export type CloseUnsavedAnswer = z.infer<typeof CLOSE_UNSAVED_RESULT>;

export const CLOSE_UNSAVED_DIALOG = declareDialog({
  id: CLOSE_UNSAVED_DIALOG_ID,
  title: CLOSE_UNSAVED_TITLE,
  props: z.object({
    /** The document's name as its tab shows it — the renderer holds no path (invariant 2). */
    name: z.string().min(1),
  }),
  result: CLOSE_UNSAVED_RESULT,
  component: lazy(() => import('./CloseUnsavedBody.js')),
});
