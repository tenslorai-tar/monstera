import { lazy } from 'react';
import { z } from 'zod';

import { STAMP_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { STAMP_PICTURE, STAMP_RESULT } from './stampResult.js';

/** The id the stamp tool opens to ask which stamp goes in the box. */
export const STAMP_DIALOG_ID = 'dialog.stamp';

/**
 * The stamp library's chooser, opened by the stamp tool after its box is drawn — the text box's order and its reason:
 * the person has said WHERE, and is asked only WHICH, and a dismissal leaves nothing behind.
 */
export const STAMP_DIALOG = declareDialog({
  id: STAMP_DIALOG_ID,
  title: STAMP_DIALOG_TITLE,
  // THE KEPT PICTURES, each with a `blob:` address the opener made and lets go of when the chooser closes: a dialog
  // body reaches no channel, so the pictures arrive as props.
  props: z.object({ pictures: z.array(STAMP_PICTURE).readonly() }).strict(),
  result: STAMP_RESULT,
  component: lazy(() => import('./StampBody.js')),
});
