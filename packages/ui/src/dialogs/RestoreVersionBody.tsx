import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { byteSize } from '../byteSize.js';
import { RESTORE_VERSION_INTRO, RESTORE_VERSION_ROW, RESTORE_VERSION_RESTORE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { KeptVersionProps, RestoreVersionAnswer } from './restoreVersionResult.js';

/**
 * The restore dialog's body: each kept version with the date and time it was saved over and its size, and one button per
 * version. The press answers that version's id, and the command writes it out as a copy where the person chooses.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function RestoreVersionBody({
  versions,
  resolve,
}: { readonly versions: readonly KeptVersionProps[] } & DialogAnswering<RestoreVersionAnswer>): ReactElement {
  const { i18n, _ } = useLingui();
  const when = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="m-restore-version">
      <p>{_(RESTORE_VERSION_INTRO)}</p>
      <ul className="m-restore-version__list">
        {versions.map((version) => (
          <li className="m-restore-version__row" data-version={version.id} key={version.id}>
            <span className="m-restore-version__what">
              {_(RESTORE_VERSION_ROW, { when: when.format(new Date(version.savedAt)), size: byteSize(i18n, version.bytes) })}
            </span>
            <Button
              label={RESTORE_VERSION_RESTORE}
              onClick={() => {
                resolve({ id: version.id });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
