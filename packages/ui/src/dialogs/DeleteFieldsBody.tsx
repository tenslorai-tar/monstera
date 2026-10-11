import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { DELETE_FIELDS_APPLY, DELETE_FIELDS_EXPLAINS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DELETE_FIELDS_RESULT } from './deleteFields.js';

/**
 * The question before several fields go: how many, and that Undo brings them back. A default export because
 * `declareDialog` takes a `lazy()` component.
 */
export default function DeleteFieldsBody({
  count,
  resolve,
}: { readonly count: number } & DialogAnswering<z.infer<typeof DELETE_FIELDS_RESULT>>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-delete-fields">
      <p>{_(DELETE_FIELDS_EXPLAINS, { count })}</p>
      <DialogFooter>
        <Button
          label={DELETE_FIELDS_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ confirmed: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
