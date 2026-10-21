import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { RESET_FORM_APPLY, RESET_FORM_EXPLAINS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { RESET_FORM_RESULT } from './resetForm.js';

/**
 * The question before the form is cleared: what goes, what stays, and that Undo brings it back. A default export because
 * `declareDialog` takes a `lazy()` component.
 */
export default function ResetFormBody({ resolve }: DialogAnswering<z.infer<typeof RESET_FORM_RESULT>>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-reset-form">
      <p>{_(RESET_FORM_EXPLAINS)}</p>
      <DialogFooter>
        <Button
          label={RESET_FORM_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ confirmed: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
