import type { ReactElement } from 'react';

import {
  ANNOTATION_REPLY_APPLY,
  ANNOTATION_REPLY_EMPTY,
  ANNOTATION_REPLY_LABEL,
  ANNOTATION_REPLY_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a reply says, collected after the mark being answered was selected.
 *
 * The same form as the note's and four different words, which is the whole of
 * the difference — `AnnotationNoteBody`'s sentence, one relationship along: a
 * note is a comment about the page and a reply is an answer to somebody's
 * comment, so *Reply* and *Add note* are not one control with a variable in it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AnnotationReplyBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={ANNOTATION_REPLY_APPLY}
      empty={ANNOTATION_REPLY_EMPTY}
      label={ANNOTATION_REPLY_LABEL}
      resolve={resolve}
      tooLong={ANNOTATION_REPLY_TOO_LONG}
    />
  );
}
