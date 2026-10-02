import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { STALE_COPIES_DELETE, STALE_COPIES_EXPLAINS, STALE_COPIES_UNDO } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Lists EVERY copy that would be deleted — each backup by the name it has beside the file, and Monstera's undo copies
 * by count — with *Delete permanently* the one way forward. Keeping them is closing the dialog.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function StaleCopiesBody({
  backups,
  undoCopies,
  resolve,
}: { readonly backups: readonly string[]; readonly undoCopies: number } & DialogAnswering<{ readonly delete: true }>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-stale-copies">
      <p>{_(STALE_COPIES_EXPLAINS)}</p>
      <ul data-stale-copies={backups.length + undoCopies}>
        {backups.map((name) => (
          <li key={name}>{name}</li>
        ))}
        {undoCopies > 0 ? <li>{_(STALE_COPIES_UNDO, { count: undoCopies })}</li> : null}
      </ul>
      <DialogFooter>
        <Button
          label={STALE_COPIES_DELETE}
          variant="primary"
          onClick={() => {
            resolve({ delete: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
