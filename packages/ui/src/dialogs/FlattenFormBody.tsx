import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { FLATTEN_FORM_APPLY, FLATTEN_FORM_EXPLAINS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Says what a flatten removes and that Undo is the only way back, with *Flatten form* the one way forward. Keeping the
 * form is closing the dialog.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FlattenFormBody({ resolve }: DialogAnswering<{ readonly flatten: true }>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-flatten-form">
      <p>{_(FLATTEN_FORM_EXPLAINS)}</p>
      <DialogFooter>
        <Button
          label={FLATTEN_FORM_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ flatten: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
