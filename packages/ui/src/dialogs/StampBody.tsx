import { useLingui } from '@lingui/react';
import { BUILT_IN_STAMPS, type BuiltInStamp } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { STAMP_DIALOG_APPLY, STAMP_DIALOG_CHOICES, STAMP_TITLES } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { StampAnswer } from './stampResult.js';

/**
 * The stamp chooser's body: each built-in stamp as the word it puts on the page, drawn as a stamp is — capitals in a
 * bordered box — so the choice looks like its result. The list is the contract's, in its order; the words are
 * catalogue keys, one per stamp, so a stamp added there arrives owing its words here.
 *
 * APPROVED is chosen at the start, so *Add stamp* always has something to add.
 */
export default function StampBody({ resolve }: DialogAnswering<StampAnswer>): ReactElement {
  const { _ } = useLingui();
  const [stamp, setStamp] = useState<BuiltInStamp>('approved');

  return (
    <div className="m-stamp-chooser">
      <fieldset className="m-stamp-chooser__choices">
        <legend>{_(STAMP_DIALOG_CHOICES)}</legend>
        {BUILT_IN_STAMPS.map((each) => (
          <label key={each} className="m-stamp-chooser__choice" data-stamp={each}>
            <input
              type="radio"
              name="stamp-choice"
              checked={stamp === each}
              onChange={() => {
                setStamp(each);
              }}
            />
            <span className="m-stamp-chooser__word">{_(STAMP_TITLES[each])}</span>
          </label>
        ))}
      </fieldset>
      <Button
        label={STAMP_DIALOG_APPLY}
        variant="primary"
        onClick={() => {
          resolve({ stamp });
        }}
      />
    </div>
  );
}
