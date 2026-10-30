import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { WORDS_NOT_WRITTEN_DISCARD, WORDS_NOT_WRITTEN_KEEP, WORDS_NOT_WRITTEN_QUESTION } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { WordsNotWrittenAnswer } from './wordsNotWritten.js';

/**
 * *Keep editing / Discard*, asked where a person leaves an Edit text editor whose words a write refused (ADR-0278).
 *
 * **Keep editing is primary**: it is the choice that loses nothing, and dismissing the dialog — its ×, or Escape — answers
 * it too, because the platform's dismissal must never be the destructive answer. Discard puts the page's text back.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function WordsNotWrittenBody({ resolve }: DialogAnswering<WordsNotWrittenAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-words-not-written">
      <p>{_(WORDS_NOT_WRITTEN_QUESTION)}</p>
      {/* NO CANCEL BESIDE THEM: a dismissal answers Keep editing, so Cancel would be a second way to say it (`own`). */}
      <DialogFooter dismissal="own">
        <Button
          label={WORDS_NOT_WRITTEN_DISCARD}
          onClick={() => {
            resolve('discard');
          }}
        />
        <Button
          label={WORDS_NOT_WRITTEN_KEEP}
          onClick={() => {
            resolve('keep');
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
