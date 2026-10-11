import { useLingui } from '@lingui/react';
import { type MessageKey, messageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  IMPORT_RESULT_MORE,
  SETTINGS_IMPORT_APPLIED,
  SETTINGS_IMPORT_LEFT,
  SETTINGS_SKIP_NOT_ACCEPTED,
  SETTINGS_SKIP_NOT_IN_VERSION,
  SETTINGS_SKIP_SECRET,
} from '../messages/en.js';
import type { SkippedSetting } from '../settingsStore.js';

/** The sentence for each reason a value was left out. A Record, so a reason added to the store is a compile error here. */
const REASON_MESSAGE: Readonly<Record<SkippedSetting['reason'], MessageKey>> = {
  'not-in-this-version': SETTINGS_SKIP_NOT_IN_VERSION,
  secret: SETTINGS_SKIP_SECRET,
  'not-accepted': SETTINGS_SKIP_NOT_ACCEPTED,
};

/**
 * The settings import result's body: how many values were set, and each one left out with its reason. A setting this
 * build has is named by its title, translated; one it does not have by the id the file gave. A default export because
 * `declareDialog` takes a `lazy()` component.
 */
export default function ImportSettingsResultBody({
  applied,
  skipped,
  more,
}: {
  readonly applied: number;
  readonly skipped: readonly { readonly id: string; readonly title?: string | undefined; readonly reason: SkippedSetting['reason'] }[];
  readonly more: number;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-import-result">
      <p>{_(SETTINGS_IMPORT_APPLIED, { count: applied })}</p>
      <p>{_(SETTINGS_IMPORT_LEFT, { count: skipped.length + more })}</p>
      <ul className="m-dialog-list m-import-result__list">
        {skipped.map((skip) => (
          <li className="m-import-result__row" data-skipped-setting={skip.id} key={skip.id}>
            <span className="m-import-result__name">{skip.title === undefined ? skip.id : _(messageKey(skip.title))}</span>
            <span className="m-import-result__reason">{_(REASON_MESSAGE[skip.reason])}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{_(IMPORT_RESULT_MORE, { count: more })}</p> : null}
    </div>
  );
}
