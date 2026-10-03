import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { KEPT_BACKUPS_EXPLAINS } from '../messages/en.js';

/**
 * Names each file beside the document that looks like a backup and was kept because Monstera did not make it
 * ([ADR-0139](../../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)). A notice: the
 * person deletes them where they keep their files, or keeps them.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function KeptBackupsBody({ kept }: { readonly kept: readonly string[] }): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-kept-backups">
      <p>{_(KEPT_BACKUPS_EXPLAINS, { count: kept.length })}</p>
      <ul data-kept-backups={kept.length}>
        {kept.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
