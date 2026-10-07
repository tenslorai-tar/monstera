import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { DONATE_CLICK, DONATE_LATER, DONATE_ONGOING, DONATE_OPEN } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DonateAnswer } from './donate.js';

/**
 * *Thank you for supporting Monstera.* (the dialog's title): an invitation, the line that says what the primary does,
 * and two answers.
 *
 * ## What it does not say
 *
 * It does not give the licence or account for the money: both read as rules to a person who only wanted to help, and
 * the owner asked for words a person would say (2026-10-07). *Monstera never sees your payment details* is still true
 * and still a fact about the code — the only thing a press does is hand one address to `shell.openExternal` through
 * `app.openWebPage` — it is simply not this dialog's business to recite.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DonateBody({ resolve }: DialogAnswering<DonateAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-donate">
      <p>{_(DONATE_ONGOING)}</p>
      <p>{_(DONATE_CLICK)}</p>
      {/* THE PATTERN'S FOOTER WITHOUT A CANCEL: *Donate later* is this dialog's own word for not now, and a Cancel
          beside it would say the same thing twice. The primary is last. */}
      <DialogFooter dismissal="own">
        <Button
          label={DONATE_LATER}
          onClick={() => {
            resolve('later');
          }}
        />
        <Button
          label={DONATE_OPEN}
          onClick={() => {
            resolve('open');
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
