import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  FLATTEN_FORM_ALL,
  FLATTEN_FORM_ALL_NOTE,
  FLATTEN_FORM_APPLY,
  FLATTEN_FORM_EXPLAINS,
  FLATTEN_FORM_SCOPE,
  FLATTEN_FORM_SELECTED,
  FLATTEN_FORM_SELECTED_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Says what a flatten does in the owner's words (G1), offers the whole form or only the selected fields when some are
 * selected, with *Flatten form* the one way forward. Keeping the form is closing the dialog.
 *
 * The whole form is the first choice even with a selection: it is what the control's name says, and a person who
 * selected fields to change them did not thereby ask for only those to be flattened.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FlattenFormBody({
  selected,
  resolve,
}: { readonly selected: number } & DialogAnswering<{ readonly flatten: true; readonly scope: 'all' | 'selected' }>): ReactElement {
  const { _ } = useLingui();
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  return (
    <div className="m-flatten-form">
      <p>{_(FLATTEN_FORM_EXPLAINS)}</p>
      {selected > 0 ? (
        <DialogChoices<'all' | 'selected'>
          label={FLATTEN_FORM_SCOPE}
          onChange={setScope}
          options={[
            { value: 'all', label: FLATTEN_FORM_ALL, note: FLATTEN_FORM_ALL_NOTE },
            // THE COUNT IN THE WORDS, so a person sees how many they are about to flatten.
            { value: 'selected', label: { shown: _(FLATTEN_FORM_SELECTED, { count: selected }) }, note: FLATTEN_FORM_SELECTED_NOTE },
          ]}
          value={scope}
        />
      ) : null}
      <DialogFooter>
        <Button
          label={FLATTEN_FORM_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ flatten: true, scope: selected > 0 ? scope : 'all' });
          }}
        />
      </DialogFooter>
    </div>
  );
}
