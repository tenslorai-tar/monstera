import { useLingui } from '@lingui/react';
import { DOCUMENT_PASSWORD_MAX_CHARS } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DOCUMENT_PASSWORD_APPLY,
  DOCUMENT_PASSWORD_ASKS,
  DOCUMENT_PASSWORD_EMPTY,
  DOCUMENT_PASSWORD_LABEL,
  DOCUMENT_PASSWORD_TOO_LONG,
  DOCUMENT_PASSWORD_WRONG,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DocumentPasswordAnswer } from './documentPassword.js';

/**
 * Asks for the password an encrypted document needs
 * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## It does NOT reuse `AnnotationTextForm`, and the reason is the trim
 *
 * That form treats a whitespace-only value as empty, which is right for every
 * caller it has: a sticky note of three spaces is an invisible icon. A password
 * of three spaces is a password — PDF hands the bytes to a hash — so a shared
 * form would refuse a document whose owner chose one, with no sentence anywhere
 * that could explain why. The rest of the shape is deliberately that form's:
 * the refusal is on screen before the control is pressed, and the control is
 * disabled while the value is unusable.
 *
 * ## What it does with the value, and what it must never do
 *
 * It hands it to `resolve` and holds nothing. There is no store, no setting and
 * no recent-files entry involved: the password lives in this component's state
 * for as long as the dialog is open and goes out of scope with it. The caller
 * gives it to main and to this document's own parser and keeps it nowhere a
 * version bump would carry it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DocumentPasswordBody({
  name,
  retry,
  resolve,
}: {
  readonly name: string;
  readonly retry: boolean;
} & DialogAnswering<DocumentPasswordAnswer>): ReactElement {
  const { _ } = useLingui();
  const [password, setPassword] = useState('');

  const over = password.length > DOCUMENT_PASSWORD_MAX_CHARS;
  const usable = password.length > 0 && !over;

  return (
    <div className="m-annotation-text">
      {/* THE FILE'S NAME, because a password prompt that names no document is
          one a person answers without knowing what they are unlocking — and
          with tabs there may be several. It is the name and never the path,
          which is the only thing the renderer has (invariant L2). */}
      <p className="m-annotation-text__problem">{_(DOCUMENT_PASSWORD_ASKS, { name })}</p>
      <Input
        label={DOCUMENT_PASSWORD_LABEL}
        onValueChange={setPassword}
        secret
        value={password}
      />
      <p className="m-annotation-text__problem" role="status">
        {over
          ? _(DOCUMENT_PASSWORD_TOO_LONG)
          : password.length === 0
            ? // THE RETRY SENTENCE WINS WHILE THE FIELD IS EMPTY, which is the
              // moment it is most useful: a person who has just been refused
              // has an empty field again, and telling them it is empty is the
              // one thing they already know.
              _(retry ? DOCUMENT_PASSWORD_WRONG : DOCUMENT_PASSWORD_EMPTY)
            : ''}
      </p>
      <Button
        disabled={!usable}
        label={DOCUMENT_PASSWORD_APPLY}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute: the
          // result schema refuses an empty string, so a mismatch would throw
          // `DialogResultRejected` over a document nobody has opened yet.
          if (!usable) return;
          resolve({ password });
        }}
        variant="primary"
      />
    </div>
  );
}
