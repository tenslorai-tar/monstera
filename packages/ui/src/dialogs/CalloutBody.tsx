import type { ReactElement } from 'react';

import { CALLOUT_APPLY, CALLOUT_EMPTY, CALLOUT_LABEL, CALLOUT_TOO_LONG } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What a callout says.
 *
 * The same form as the text box's and the sticky note's, with its own four
 * words. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CalloutBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={CALLOUT_APPLY}
      empty={CALLOUT_EMPTY}
      label={CALLOUT_LABEL}
      resolve={resolve}
      tooLong={CALLOUT_TOO_LONG}
    />
  );
}
