import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  IMPORT_FORM_DATA_MATCHED_NOTHING,
  IMPORT_FORM_DATA_TOO_LARGE,
  IMPORT_FORM_DATA_UNREADABLE,
} from '../messages/en.js';
import { type FileTooLargeProps, fileTooLargeValues } from './fileTooLarge.js';

/**
 * The import-form-data problem dialog's body.
 *
 * `InsertImageProblemBody`'s shape and its rules: each sentence says the
 * document is unchanged rather than leaving that to a heading, and a refusal by size
 * names the file's size beside the bound (`fileTooLarge.ts`).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportFormDataProblemBody(
  props:
    | { readonly reason: 'unreadable' }
    | { readonly reason: 'matched-nothing'; readonly named: number }
    | FileTooLargeProps,
): ReactElement {
  const { _, i18n } = useLingui();

  if (props.reason === 'matched-nothing') {
    return (
      <div className="m-import-form-data-problem">
        <p>{_(IMPORT_FORM_DATA_MATCHED_NOTHING, { named: props.named })}</p>
      </div>
    );
  }

  if (props.reason === 'unreadable') {
    return (
      <div className="m-import-form-data-problem">
        <p>{_(IMPORT_FORM_DATA_UNREADABLE)}</p>
      </div>
    );
  }

  return (
    <div className="m-import-form-data-problem">
      <p>{_(IMPORT_FORM_DATA_TOO_LARGE, fileTooLargeValues(i18n, props))}</p>
    </div>
  );
}
