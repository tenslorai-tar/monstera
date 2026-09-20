import type { ReactElement } from 'react';

import {
  ANNOTATION_EDIT_APPLY,
  ANNOTATION_EDIT_EMPTY,
  ANNOTATION_EDIT_LABEL,
  ANNOTATION_EDIT_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a mark already says, offered for rewriting.
 *
 * The third caller of {@link AnnotationTextForm} and the first that starts with
 * something in the field — which is the whole difference, plus four words.
 * *Save comment* rather than *Add note*, because a control that says *add* and
 * then replaces what was there is a control that says what it will do and does
 * something else (B9).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AnnotationEditBody({
  text,
  resolve,
}: { readonly text: string } & DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={ANNOTATION_EDIT_APPLY}
      empty={ANNOTATION_EDIT_EMPTY}
      initial={text}
      label={ANNOTATION_EDIT_LABEL}
      resolve={resolve}
      tooLong={ANNOTATION_EDIT_TOO_LONG}
    />
  );
}
