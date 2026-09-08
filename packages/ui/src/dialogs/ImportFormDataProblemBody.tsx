import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { IMPORT_FORM_DATA_TOO_LARGE, IMPORT_FORM_DATA_UNREADABLE } from '../messages/en.js';

/**
 * The import-form-data problem dialog's body.
 *
 * `InsertImageProblemBody`'s shape and its rules: each sentence says the
 * document is unchanged rather than leaving that to a heading, and the limit is
 * converted to megabytes at the point of display rather than stored.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportFormDataProblemBody(
  props:
    | { readonly reason: 'unreadable' }
    | { readonly reason: 'too-large'; readonly limitBytes: number },
): ReactElement {
  const { _ } = useLingui();

  if (props.reason === 'unreadable') {
    return (
      <div className="m-import-form-data-problem">
        <p>{_(IMPORT_FORM_DATA_UNREADABLE)}</p>
      </div>
    );
  }

  const megabytes = Math.floor(props.limitBytes / (1024 * 1024));
  return (
    <div className="m-import-form-data-problem">
      <p>{_(IMPORT_FORM_DATA_TOO_LARGE, { megabytes })}</p>
    </div>
  );
}
