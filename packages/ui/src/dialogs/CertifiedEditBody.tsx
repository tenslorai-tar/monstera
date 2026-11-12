import { useLingui } from '@lingui/react';
import type { FailureDetails } from '@monstera/shared';
import type { ReactElement } from 'react';

import { CERTIFIED_EDIT_EXPLAINS, SIGNED_EDIT_COPY } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { problemMessage, problemParticulars } from './problemMessages.js';

/**
 * *Cancel / Work on a copy*, for a change a certified document's certifier does not allow (ADR-0291 Decision 4).
 *
 * The level's sentence and the certifier are the problem dialog's own, from the same two readers (B3a), so the window
 * that offers the copy and a surface that only says the refusal read alike. Then what the copy is. **No *Change this
 * document***: the owner's decision of 2026-11-06 removes it here. Cancel is the popup's own close, which leaves the
 * document as it was certified.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CertifiedEditBody({ level, signer, resolve }: FailureDetails['certified'] & DialogAnswering<'copy'>): ReactElement {
  const { _ } = useLingui();
  const problem = { code: 'certified', detail: { level, signer } } as const;
  const particulars = problemParticulars(problem);
  return (
    <div className="m-signed-edit">
      <p>{_(problemMessage(problem))}</p>
      {particulars === undefined ? null : (
        <dl className="m-command-problem-reference">
          <dt>{_(particulars.label)}</dt>
          <dd>{particulars.value}</dd>
        </dl>
      )}
      <p>{_(CERTIFIED_EDIT_EXPLAINS)}</p>
      <DialogFooter>
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
