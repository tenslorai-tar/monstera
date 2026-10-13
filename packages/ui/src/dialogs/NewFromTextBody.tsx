import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import type { ReadFontList } from '../FontPicker.js';
import { NEW_FROM_TEXT_APPLY, NEW_FROM_TEXT_FONT } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { ResolvedFontRow } from './ResolvedFontRow.js';
import type { NewFromTextAnswer } from './newFromTextResult.js';

/**
 * The new-PDF-from-text dialog's body: the one font row, opening on the face every composition was set in before there was
 * a choice, and the button that goes on to main's picker. A default export because `declareDialog` takes a `lazy()`
 * component.
 */
export default function NewFromTextBody({
  fonts,
  resolve,
}: {
  /** The fonts main listed when the dialog opened; absent where that read failed, which the picker says in words. */
  readonly fonts?: ReadFontList | undefined;
} & DialogAnswering<NewFromTextAnswer>): ReactElement {
  const [family, setFamily] = useState<string>(COMPOSED_FAMILY_DEFAULT);
  return (
    <div className="m-new-from-text">
      <ResolvedFontRow fonts={fonts} label={NEW_FROM_TEXT_FONT} value={family} onPick={setFamily} />
      <DialogFooter>
        <Button
          label={NEW_FROM_TEXT_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ family });
          }}
        />
      </DialogFooter>
    </div>
  );
}
