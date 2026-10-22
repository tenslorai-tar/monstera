import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { OPEN_BUTTON_FILE_EXPLAINS, OPEN_BUTTON_FILE_OPEN } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Names the PDF a push button opens, with *Open* the one way on (ADR-0259): the file's name as the document holds it,
 * shown whole as the follow-link question shows an address, since it is the document's choice and not the person's.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OpenButtonFileBody({
  file,
  resolve,
}: DialogAnswering<{ readonly open: true }> & { readonly file: string }): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-follow-link">
      <p>{_(OPEN_BUTTON_FILE_EXPLAINS)}</p>
      <p className="m-follow-link__address" data-open-button-file="">
        {file}
      </p>
      <DialogFooter>
        <Button
          label={OPEN_BUTTON_FILE_OPEN}
          variant="primary"
          onClick={() => {
            resolve({ open: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
