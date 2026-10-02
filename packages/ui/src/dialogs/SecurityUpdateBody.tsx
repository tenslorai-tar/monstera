import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SECURITY_UPDATE_OPEN_STORE, SECURITY_UPDATE_TEXT, SECURITY_UPDATE_UNDERSTOOD } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SecurityUpdateAnswer } from './securityUpdate.js';

/**
 * The security notice's body: one sentence naming the version, and two answers.
 *
 * **It never says *update now* as though Monstera could** — ADR-0018 forbids the application installing itself, so
 * the verb is the Store's.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SecurityUpdateBody({
  version,
  resolve,
}: { readonly version: string } & DialogAnswering<SecurityUpdateAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-security-update">
      <p>{_(SECURITY_UPDATE_TEXT, { version })}</p>
      {/* THE PATTERN'S FOOTER WITHOUT A CANCEL: *I understand* is this notice's dismissal and is recorded as read, which
          a Cancel would not be (`updateStatus.ts`). The primary is last. */}
      <DialogFooter dismissal="own">
        <Button
          label={SECURITY_UPDATE_UNDERSTOOD}
          onClick={() => {
            resolve('understood');
          }}
        />
        <Button
          label={SECURITY_UPDATE_OPEN_STORE}
          onClick={() => {
            resolve('store');
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
