import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { VIEW_LOCKED_CLOSE, VIEW_LOCKED_ENTER, VIEW_LOCKED_TITLE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';

/**
 * What a tab shows when its document needs a password and the person pressed Cancel at the prompt (the owner's decision,
 * 2026-11-10).
 *
 * ## No error, because nothing went wrong
 *
 * The page area used to show *This document could not be displayed*, the sentence a parse that threw produces, which
 * reads as a failure to a person who only changed their mind. So this says what is true, that the document is
 * protected, and offers the two ways on: *Enter password* opens the view again, whose open asks for the password, and
 * *Close* closes the tab through the one close path every other close takes.
 *
 * `role="status"` rather than `alert`: this is the answer to the person's own Cancel, not news they must be interrupted
 * with.
 */
export function LockedDocument({
  onEnterPassword,
  onClose,
}: {
  readonly onEnterPassword: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-view-problem" data-document-locked="" role="status">
      <p className="m-view-problem-title">{_(VIEW_LOCKED_TITLE)}</p>
      <div className="m-view-problem-actions">
        <Button label={VIEW_LOCKED_ENTER} onClick={onEnterPassword} variant="primary" />
        <Button label={VIEW_LOCKED_CLOSE} onClick={onClose} />
      </div>
    </div>
  );
}
