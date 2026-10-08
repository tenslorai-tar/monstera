import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PERMISSION_PASSWORD_REPLACED_DONE, PERMISSION_PASSWORD_REPLACED_WHAT } from '../messages/en.js';

/**
 * The permissions-password notice's body.
 *
 * The command SUCCEEDED, so the first sentence says the change was made and the second says what was replaced and what
 * did not change, in that order: a body that led with the replacement would read as a failure report, which is
 * `HistoryTrimmedBody`'s argument for the same arrangement.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PermissionPasswordReplacedBody(): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-permission-notice">
      <p>{_(PERMISSION_PASSWORD_REPLACED_DONE)}</p>
      <p>{_(PERMISSION_PASSWORD_REPLACED_WHAT)}</p>
    </div>
  );
}
