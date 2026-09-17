import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { IMPORT_ANNOTATIONS_TOO_LARGE, IMPORT_ANNOTATIONS_UNREADABLE } from '../messages/en.js';

/**
 * The comment-import problem dialog's body: `ImportFormDataProblemBody`'s, with its words — each
 * sentence says nothing was added, and the limit is shown in megabytes at the point of display.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportAnnotationsProblemBody(
  props: { readonly reason: 'unreadable' } | { readonly reason: 'too-large'; readonly limitBytes: number },
): ReactElement {
  const { _ } = useLingui();
  if (props.reason === 'unreadable') {
    return <p className="m-import-annotations-problem">{_(IMPORT_ANNOTATIONS_UNREADABLE)}</p>;
  }
  const megabytes = Math.floor(props.limitBytes / (1024 * 1024));
  return <p className="m-import-annotations-problem">{_(IMPORT_ANNOTATIONS_TOO_LARGE, { megabytes })}</p>;
}
