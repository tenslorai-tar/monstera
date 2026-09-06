import { lazy } from 'react';
import { z } from 'zod';

import { ANNOTATION_NOTE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { ANNOTATION_TEXT_RESULT } from './annotationTextResult.js';

/** The id the sticky-note tool opens to collect the comment. */
export const ANNOTATION_NOTE_DIALOG_ID = 'dialog.annotation-note';

/**
 * What a sticky note says, asked for after the point has been clicked.
 *
 * ## Its own declaration, sharing the text box's RESULT
 *
 * The answer is the same shape and the same rules — one non-empty line, trimmed,
 * bounded by the payload's `MAX_ANNOTATION_TEXT` — so
 * {@link ANNOTATION_TEXT_RESULT} is imported rather than restated. A second
 * schema saying the same thing is the second opinion B3a spends its time on,
 * and this one would be about the bound the contract owns.
 *
 * What is NOT shared is the wording. A dialog titled *Text box* asking a person
 * to write a note is a control that says what it will do and then does
 * something else, which B9 makes a defect rather than a nicety. The body is
 * `AnnotationTextForm` with this dialog's own four keys.
 *
 * ## Clicked first, then asked
 *
 * `annotationText.ts`' order and its argument, one gesture simpler: the person
 * has already said *where*, so the dialog asks only *what*, and a dismissal
 * leaves nothing behind because the command is built from the answer rather
 * than amended by it.
 *
 * ## No props
 *
 * Nothing about the document decides whether an answer is valid, and
 * `.strict()` on an empty object is the declaration rather than an omission —
 * it refuses a caller that passes something, which is how a props shape drifts.
 */
export const ANNOTATION_NOTE_DIALOG = declareDialog({
  id: ANNOTATION_NOTE_DIALOG_ID,
  title: ANNOTATION_NOTE_TITLE,
  props: z.object({}).strict(),
  result: ANNOTATION_TEXT_RESULT,
  component: lazy(() => import('./AnnotationNoteBody.js')),
});
