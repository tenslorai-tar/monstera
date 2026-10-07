import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { RATE_US_CLICK, RATE_US_INVITE, RATE_US_LATER, RATE_US_OPEN } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { RateUsAnswer } from './rateUs.js';

/**
 * *Thank you for choosing Monstera.* (the dialog's title): an invitation to share an experience, the line that says what
 * the primary does, and two answers.
 *
 * It shares the Donate dialog's shape (`m-donate`'s paragraphs over a footer without a Cancel) so the two buttons in
 * the top row open two dialogs that look like a pair. A default export because `declareDialog` takes a `lazy()`
 * component.
 */
export default function RateUsBody({ resolve }: DialogAnswering<RateUsAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-donate">
      <p>{_(RATE_US_INVITE)}</p>
      <p>{_(RATE_US_CLICK)}</p>
      <DialogFooter dismissal="own">
        <Button
          label={RATE_US_LATER}
          onClick={() => {
            resolve('later');
          }}
        />
        <Button
          label={RATE_US_OPEN}
          onClick={() => {
            resolve('open');
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
