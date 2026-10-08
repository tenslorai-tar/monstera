import { useLingui } from '@lingui/react';
import type { ImportSkipped } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  IMPORT_RESULT_FILLED,
  IMPORT_RESULT_LEFT,
  IMPORT_RESULT_MORE,
  IMPORT_SKIP_CANNOT_BE_FILLED,
  IMPORT_SKIP_NOT_IN_DOCUMENT,
  IMPORT_SKIP_OPTION_NOT_OFFERED,
  IMPORT_SKIP_READ_ONLY,
  IMPORT_SKIP_SEVERAL_VALUES,
} from '../messages/en.js';

/** The sentence for each reason a field was left alone. A Record, so a reason added to the contract is a compile error here. */
const REASON_MESSAGE: Readonly<Record<ImportSkipped['reason'], MessageKey>> = {
  'not-in-document': IMPORT_SKIP_NOT_IN_DOCUMENT,
  'read-only': IMPORT_SKIP_READ_ONLY,
  'several-values': IMPORT_SKIP_SEVERAL_VALUES,
  'option-not-offered': IMPORT_SKIP_OPTION_NOT_OFFERED,
  'cannot-be-filled': IMPORT_SKIP_CANNOT_BE_FILLED,
};

/**
 * The import result dialog's body: how many fields were filled, and the fields left as they were, each with its reason.
 *
 * A field's name is the document's own and is shown as it is, never translated; everything around it is a catalogue
 * sentence. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportFormDataResultBody({
  filled,
  skipped,
  more,
}: {
  readonly filled: number;
  readonly skipped: readonly ImportSkipped[];
  readonly more: number;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-import-result">
      <p>{_(IMPORT_RESULT_FILLED, { count: filled })}</p>
      <p>{_(IMPORT_RESULT_LEFT, { count: skipped.length + more })}</p>
      <ul className="m-dialog-list m-import-result__list">
        {skipped.map((skip) => (
          <li className="m-import-result__row" key={`${skip.name}:${skip.reason}`}>
            <span className="m-import-result__name">{skip.name}</span>
            <span className="m-import-result__reason">{_(REASON_MESSAGE[skip.reason])}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{_(IMPORT_RESULT_MORE, { count: more })}</p> : null}
    </div>
  );
}
