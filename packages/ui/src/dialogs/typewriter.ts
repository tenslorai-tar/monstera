import { lazy } from 'react';
import { z } from 'zod';

import { TYPEWRITER_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the typewriter opens once its region is drawn. */
export const TYPEWRITER_DIALOG_ID = 'dialog.typewriter';

/**
 * What the typewriter types, asked for after the region is drawn.
 *
 * The fourth dialog sharing {@link ANNOTATION_TEXT_RESULT} and the fourth with
 * its own words. A dialog titled *Text box* collecting what somebody is typing
 * onto a form is a control that says one thing and does another — the argument
 * that kept the sticky note from reusing the text box's declaration, on the
 * pair that is closest to being one control.
 */
export const TYPEWRITER_DIALOG = declareDialog({
  id: TYPEWRITER_DIALOG_ID,
  title: TYPEWRITER_DIALOG_TITLE,
  props: z.object({}).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./TypewriterBody.js')),
});
