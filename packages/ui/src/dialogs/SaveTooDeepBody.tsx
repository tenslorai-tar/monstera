import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SAVE_TOO_DEEP_BOOKMARKS, SAVE_TOO_DEEP_COPY, SAVE_TOO_DEEP_EXPLAINS, SAVE_TOO_DEEP_STILL } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * *This file can't be saved*, in plain words, with *Save a copy without bookmarks* where the bookmarks are the cause.
 * The popup's own close is the other answer and changes nothing.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SaveTooDeepBody({
  bookmarks,
  still,
  resolve,
}: { readonly bookmarks: boolean; readonly still?: true } & DialogAnswering<'copy-without-bookmarks'>): ReactElement {
  const { _ } = useLingui();
  if (still === true) return <p>{_(SAVE_TOO_DEEP_STILL)}</p>;
  return (
    <div className="m-save-too-deep">
      <p>{_(SAVE_TOO_DEEP_EXPLAINS)}</p>
      {bookmarks ? (
        <>
          <p>{_(SAVE_TOO_DEEP_BOOKMARKS)}</p>
          <DialogFooter>
            <Button
              label={SAVE_TOO_DEEP_COPY}
              variant="primary"
              onClick={() => {
                resolve('copy-without-bookmarks');
              }}
            />
          </DialogFooter>
        </>
      ) : null}
    </div>
  );
}
