import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { IMPORT_ANNOTATIONS_TOO_LARGE, IMPORT_ANNOTATIONS_UNREADABLE } from '../messages/en.js';
import { type FileTooLargeProps, fileTooLargeValues } from './fileTooLarge.js';

/**
 * The comment-import problem dialog's body: `ImportFormDataProblemBody`'s, with its words — each
 * sentence says nothing was added, and a refusal by size names the file's size beside the bound
 * (`fileTooLarge.ts`).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportAnnotationsProblemBody(props: { readonly reason: 'unreadable' } | FileTooLargeProps): ReactElement {
  const { _, i18n } = useLingui();
  if (props.reason === 'unreadable') {
    return <p className="m-import-annotations-problem">{_(IMPORT_ANNOTATIONS_UNREADABLE)}</p>;
  }
  return <p className="m-import-annotations-problem">{_(IMPORT_ANNOTATIONS_TOO_LARGE, fileTooLargeValues(i18n, props))}</p>;
}
