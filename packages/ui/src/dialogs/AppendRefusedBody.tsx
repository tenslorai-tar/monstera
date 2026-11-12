import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { APPEND_REFUSED_ANYWAY, APPEND_REFUSED_COPY, APPEND_REFUSED_EXPLAINS, APPEND_REFUSED_WHOLE_BREAKS } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { AppendRefusedAnswer } from './appendRefused.js';

/**
 * *Cancel / Save anyway / Save a copy*, for a signed document whose file could not take an appended save (ADR-0291
 * question 4).
 *
 * **Save a copy is primary**: the file on disk, and every signature in it, stay as they were. *Save anyway* is offered
 * only where a save was asked of an uncertified document, and the sentence before it says it breaks the signatures.
 * Cancel is the popup's own close, which writes nothing.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AppendRefusedBody({
  certified,
  copying,
  resolve,
}: { readonly certified: boolean; readonly copying: boolean } & DialogAnswering<AppendRefusedAnswer>): ReactElement {
  const { _ } = useLingui();
  const anyway = !certified && !copying;
  return (
    <div className="m-signed-edit" data-append-refused="">
      <p>{_(APPEND_REFUSED_EXPLAINS)}</p>
      <p>{_(APPEND_REFUSED_WHOLE_BREAKS)}</p>
      <DialogFooter>
        {anyway ? (
          <Button
            label={APPEND_REFUSED_ANYWAY}
            onClick={() => {
              resolve('anyway');
            }}
          />
        ) : null}
        <Button
          label={APPEND_REFUSED_COPY}
          variant="primary"
          onClick={() => {
            resolve('copy');
          }}
        />
      </DialogFooter>
    </div>
  );
}
