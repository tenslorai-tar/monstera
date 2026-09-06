import { lazy } from 'react';
import { z } from 'zod';

import { CALLOUT_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the callout tool opens once the box has been drawn. */
export const CALLOUT_DIALOG_ID = 'dialog.callout';

/**
 * What a callout says, asked for after the point and the box are settled.
 *
 * The third dialog sharing {@link ANNOTATION_TEXT_RESULT}: one non-empty line,
 * trimmed, bounded by the payload's own limit. What is not shared is the
 * wording — a dialog titled *Text box* asking for the words of a callout is a
 * control that says one thing and does another, which is what kept the sticky
 * note from reusing the text box's declaration.
 */
export const CALLOUT_DIALOG = declareDialog({
  id: CALLOUT_DIALOG_ID,
  title: CALLOUT_DIALOG_TITLE,
  props: z.object({}).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./CalloutBody.js')),
});
