import type { ReactElement } from 'react';

import {
  ANNOTATION_NOTE_APPLY,
  ANNOTATION_NOTE_EMPTY,
  ANNOTATION_NOTE_LABEL,
  ANNOTATION_NOTE_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a sticky note says, collected after the point has been clicked.
 *
 * The same form as the text box's and four different words, which is the whole
 * of the difference: a text box's words are drawn ON the page and a note's are
 * a comment ABOUT it, so *Add note* and *Add text box* are not one control with
 * a variable in it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AnnotationNoteBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={ANNOTATION_NOTE_APPLY}
      empty={ANNOTATION_NOTE_EMPTY}
      label={ANNOTATION_NOTE_LABEL}
      resolve={resolve}
      tooLong={ANNOTATION_NOTE_TOO_LONG}
    />
  );
}
