import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { HELD_COPIES_DELETE, HELD_COPIES_EXPLAINS, HELD_COPIES_STILL } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Says which older copies still hold what was removed and why they are still there, with *Delete now* the way to try
 * again. Closing keeps them for now; the next save of the document tries them again on its own.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function HeldCopiesBody({
  held,
  still,
  resolve,
}: { readonly held: readonly string[]; readonly still: boolean } & DialogAnswering<{ readonly delete: true }>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-held-copies">
      <p>{_(still ? HELD_COPIES_STILL : HELD_COPIES_EXPLAINS, { count: held.length })}</p>
      <ul className="m-dialog-list" data-held-copies={held.length}>
        {held.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          label={HELD_COPIES_DELETE}
          variant="primary"
          onClick={() => {
            resolve({ delete: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
