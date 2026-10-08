import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { LEGACY_BACKUPS_BODY, LEGACY_BACKUPS_LEAVE, LEGACY_BACKUPS_LEFT, LEGACY_BACKUPS_MOVE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { LegacyBackupsAnswer } from './legacyBackupsResult.js';

/**
 * The old-backups offer's body: how many `.bak` files Monstera made beside this file's folder, how many others stay, and
 * *Move them* or *Leave them*. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function LegacyBackupsBody({
  proven,
  unproven,
  resolve,
}: {
  readonly proven: number;
  readonly unproven: number;
} & DialogAnswering<LegacyBackupsAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-legacy-backups">
      <p>{_(LEGACY_BACKUPS_BODY, { count: proven })}</p>
      {unproven === 0 ? null : <p data-legacy-left={String(unproven)}>{_(LEGACY_BACKUPS_LEFT, { count: unproven })}</p>}
      <DialogFooter>
        <Button
          label={LEGACY_BACKUPS_LEAVE}
          onClick={() => {
            resolve({ move: false });
          }}
        />
        <Button
          label={LEGACY_BACKUPS_MOVE}
          variant="primary"
          onClick={() => {
            resolve({ move: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
