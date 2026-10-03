import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PENDING_REDACTIONS_APPLY, PENDING_REDACTIONS_EXPLAINS, PENDING_REDACTIONS_QUESTION } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import {
  PENDING_REDACTIONS_WITHOUT,
  type PendingRedactionOccasion,
  type PendingRedactionsAnswer,
} from './pendingRedactions.js';

/**
 * *N redactions are marked but not applied. Apply them now?* — Apply, go ahead without applying, or Cancel.
 *
 * ## Each button says what it does
 *
 * The middle one names the action the person started (*Save without applying*, *Close without applying*), so a
 * person who answers without reading the question still gets the action whose name they pressed. **Apply is primary**:
 * it is the answer that leaves nothing readable under a mark. Cancel is the footer's, and the header's × and Escape
 * mean the same, so the platform's dismissal neither applies nor proceeds.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PendingRedactionsBody({
  count,
  occasion,
  resolve,
}: {
  readonly count: number;
  readonly occasion: PendingRedactionOccasion;
} & DialogAnswering<PendingRedactionsAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-pending-redactions">
      <p>{_(PENDING_REDACTIONS_QUESTION, { count })}</p>
      <p>{_(PENDING_REDACTIONS_EXPLAINS)}</p>
      <DialogFooter>
        <Button
          label={PENDING_REDACTIONS_WITHOUT[occasion]}
          onClick={() => {
            resolve('without');
          }}
        />
        <Button
          label={PENDING_REDACTIONS_APPLY}
          onClick={() => {
            resolve('apply');
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
