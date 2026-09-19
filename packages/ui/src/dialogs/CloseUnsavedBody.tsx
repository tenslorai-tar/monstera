import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  CLOSE_UNSAVED_CANCEL,
  CLOSE_UNSAVED_DISCARD,
  CLOSE_UNSAVED_QUESTION,
  CLOSE_UNSAVED_SAVE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CloseUnsavedAnswer } from './closeUnsaved.js';

/**
 * *Save / Don't save / Cancel*, for one document with unsaved changes.
 *
 * ## The sentence names the document, and the buttons say what they do
 *
 * The close path asks once per dirty document, with that document's tab active, so the name
 * is what tells a person which of several the question is about. Each button is the action it
 * takes rather than *Yes* / *No* — a *No* to "Save changes?" and a *No* to "Discard changes?"
 * are opposite actions, and a label that needs the question to be read to be safe is the
 * dialog this one replaces.
 *
 * **Save is primary**: it is the choice that loses nothing. Dismissing the dialog — its ×, or
 * Escape — is Cancel, because the platform's dismissal must never be the destructive answer.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CloseUnsavedBody({
  name,
  resolve,
}: { readonly name: string } & DialogAnswering<CloseUnsavedAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-close-unsaved">
      <p>{_(CLOSE_UNSAVED_QUESTION, { name })}</p>
      <div className="m-close-unsaved__actions">
        <Button
          label={CLOSE_UNSAVED_SAVE}
          onClick={() => {
            resolve('save');
          }}
          variant="primary"
        />
        <Button
          label={CLOSE_UNSAVED_DISCARD}
          onClick={() => {
            resolve('discard');
          }}
        />
        <Button
          label={CLOSE_UNSAVED_CANCEL}
          onClick={() => {
            resolve('cancel');
          }}
        />
      </div>
    </div>
  );
}
