import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SIGNATURE_BREAK_APPLY, SIGNATURE_BREAK_EXPLAINS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Says how many signatures this save would break and what that means, with *Save anyway* the one way forward. Keeping
 * the signatures is closing the dialog, which leaves the document unsaved and its changes open.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignatureBreakBody({
  signatures,
  resolve,
}: { readonly signatures: number } & DialogAnswering<{ readonly save: true }>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-signature-break">
      <p>{_(SIGNATURE_BREAK_EXPLAINS, { count: signatures })}</p>
      <Button
        label={SIGNATURE_BREAK_APPLY}
        variant="primary"
        onClick={() => {
          resolve({ save: true });
        }}
      />
    </div>
  );
}
