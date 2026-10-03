import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { READ_ONLY_FILE_HELD, READ_ONLY_FILE_READ_ONLY, SAVE_COPY_TITLE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { READ_ONLY_FILE_RESULT, UnwritableAccess } from './readOnlyFile.js';

/** The sentence for each reason: what the person can do now, and what the copy is. */
const TEXT: Readonly<Record<UnwritableAccess, MessageKey>> = {
  'read-only': READ_ONLY_FILE_READ_ONLY,
  held: READ_ONLY_FILE_HELD,
};

/**
 * The read-only file dialog's body: why changes cannot be saved to this file, and *Save a copy…*, the command's own
 * words, as the one action. Cancel keeps reading this file.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReadOnlyFileBody({
  access,
  resolve,
}: { readonly access: UnwritableAccess } & DialogAnswering<z.infer<typeof READ_ONLY_FILE_RESULT>>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-read-only-file" data-read-only-file={access}>
      <p>{_(TEXT[access])}</p>
      <DialogFooter>
        <Button
          label={SAVE_COPY_TITLE}
          variant="primary"
          onClick={() => {
            resolve({ kind: 'save-copy' });
          }}
        />
      </DialogFooter>
    </div>
  );
}
