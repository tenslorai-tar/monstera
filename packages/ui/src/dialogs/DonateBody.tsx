import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { DONATE_LATER, DONATE_LICENCE, DONATE_OPEN, DONATE_WHERE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DonateAnswer } from './donate.js';

/**
 * *Support Monstera*: what the money is for, where the button sends you, and two answers.
 *
 * ## Two sentences, and both of them are checkable
 *
 * The licence is ADR-0001's. *Monstera never sees your payment details* is a fact about this
 * application's code rather than a promise: the only thing it does is hand one address to
 * `shell.openExternal` through `app.openWebPage`, and the browser does the rest.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DonateBody({ resolve }: DialogAnswering<DonateAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-donate">
      <p>{_(DONATE_LICENCE)}</p>
      <p>{_(DONATE_WHERE)}</p>
      <div className="m-donate__actions">
        <Button
          label={DONATE_OPEN}
          onClick={() => {
            resolve('open');
          }}
          variant="primary"
        />
        <Button
          label={DONATE_LATER}
          onClick={() => {
            resolve('later');
          }}
        />
      </div>
    </div>
  );
}
