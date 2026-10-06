import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SIGNED_EDIT_COPY, SIGNED_EDIT_EXPLAINS, SIGNED_EDIT_THIS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SignedEditAnswer } from './signedEdit.js';

/**
 * *Cancel / Change this document / Work on a copy*, for an edit that would break a signature.
 *
 * **Work on a copy is primary**: it is the choice that loses nothing, since the signed document stays exactly as it
 * was. Cancel is the popup's own close, which leaves the document unchanged.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignedEditBody({ resolve }: DialogAnswering<SignedEditAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-signed-edit">
      <p>{_(SIGNED_EDIT_EXPLAINS)}</p>
      <DialogFooter>
        <Button
          label={SIGNED_EDIT_THIS}
          onClick={() => {
            resolve('this');
          }}
        />
        <Button
          label={SIGNED_EDIT_COPY}
          variant="primary"
          onClick={() => {
            resolve('copy');
          }}
        />
      </DialogFooter>
    </div>
  );
}
