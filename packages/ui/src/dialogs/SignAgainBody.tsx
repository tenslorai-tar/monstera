import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SIGN_AGAIN_CONTINUE, SIGN_AGAIN_EXPLAINS, SIGN_AGAIN_UNREADABLE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SignAgainAnswer } from './signAgain.js';

/**
 * Says what signing a signed document does, with *Continue* the one way forward. Cancel is the footer's, and the header's ×
 * and Escape mean the same, so the platform's dismissal never signs.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignAgainBody({
  count,
  unreadable,
  resolve,
}: { readonly count: number; readonly unreadable: boolean } & DialogAnswering<SignAgainAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-sign-again">
      <p>{_(SIGN_AGAIN_EXPLAINS, { count })}</p>
      {unreadable ? <p>{_(SIGN_AGAIN_UNREADABLE)}</p> : null}
      <DialogFooter>
        <Button
          label={SIGN_AGAIN_CONTINUE}
          variant="primary"
          onClick={() => {
            resolve('continue');
          }}
        />
      </DialogFooter>
    </div>
  );
}
