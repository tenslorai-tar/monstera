import type { ReactElement } from 'react';

import {
  TYPEWRITER_APPLY,
  TYPEWRITER_EMPTY,
  TYPEWRITER_LABEL,
  TYPEWRITER_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { AnnotationTextAnswer } from './annotationTextResult.js';

/**
 * What the typewriter types.
 *
 * The same form and its own four words. A default export because
 * `declareDialog` takes a `lazy()` component.
 */
export default function TypewriterBody({
  resolve,
}: DialogAnswering<AnnotationTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={TYPEWRITER_APPLY}
      empty={TYPEWRITER_EMPTY}
      label={TYPEWRITER_LABEL}
      resolve={resolve}
      tooLong={TYPEWRITER_TOO_LONG}
    />
  );
}
