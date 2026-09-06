import type { ReactElement } from 'react';

import {
  ANNOTATION_TEXT_APPLY,
  ANNOTATION_TEXT_EMPTY,
  ANNOTATION_TEXT_LABEL,
  ANNOTATION_TEXT_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a text box says, collected after its box has been drawn.
 *
 * The validation used to live here and now lives in {@link AnnotationTextForm},
 * which the sticky note's dialog renders too. What stays is this dialog's four
 * message keys — the words are the whole difference between the two, and they
 * are declared statically here rather than passed through a props schema so
 * B9's rule holds and each dialog reads as its own.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AnnotationTextBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={ANNOTATION_TEXT_APPLY}
      empty={ANNOTATION_TEXT_EMPTY}
      label={ANNOTATION_TEXT_LABEL}
      resolve={resolve}
      tooLong={ANNOTATION_TEXT_TOO_LONG}
    />
  );
}
