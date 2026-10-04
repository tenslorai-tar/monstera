import { useLingui } from '@lingui/react';
import { DOCUMENT_PASSWORD_MAX_CHARS } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  DOCUMENT_PASSWORD_APPLY,
  DOCUMENT_PASSWORD_ASKS,
  DOCUMENT_PASSWORD_EMPTY,
  DOCUMENT_PASSWORD_LABEL,
  DOCUMENT_PASSWORD_TOO_LONG,
  DOCUMENT_PASSWORD_WRONG,
} from '../messages/en.js';
import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DocumentPasswordAnswer } from './documentPassword.js';

/**
 * Asks for the password an encrypted document needs
 * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## It does NOT trim, unlike every other text the application asks for
 *
 * Words for a mark, a name or an address treat a whitespace-only value as empty,
 * which is right for them: a sticky note of three spaces is an invisible icon. A
 * password of three spaces is a password — PDF hands the bytes to a hash — so a
 * trimming form would refuse a document whose owner chose one, with no sentence
 * anywhere that could explain why. The rest of the shape is the other dialogs':
 * too long is said as it is typed, and an empty field only once the action is
 * pressed (`attempt.ts`).
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
  const attempt = useAttempt();
  const form = useRef<HTMLDivElement>(null);

  const over = password.length > DOCUMENT_PASSWORD_MAX_CHARS;
  const usable = password.length > 0 && !over;
  // TOO LONG is said as typed; AN EMPTY FIELD only once the action is pressed (`attempt.ts`). The retry sentence is
  // neither: it reports what the person just did, so it is said on opening, while the field is empty again.
  const problem = attemptProblem(
    attempt,
    over ? DOCUMENT_PASSWORD_TOO_LONG : retry && password.length === 0 ? DOCUMENT_PASSWORD_WRONG : undefined,
    password.length === 0,
    DOCUMENT_PASSWORD_EMPTY,
  );

  return (
    <div className="m-annotation-text" ref={form}>
      {/* THE FILE'S NAME, because a password prompt that names no document is
          one a person answers without knowing what they are unlocking — and
          with tabs there may be several. It is the name and never the path,
          which is the only thing the renderer has (invariant L2). */}
      <p className="m-annotation-text__problem">{_(DOCUMENT_PASSWORD_ASKS, { name })}</p>
      <DialogRow label={DOCUMENT_PASSWORD_LABEL} problem={problem === undefined ? undefined : _(problem)}>
        <Input
          invalid={over}
          label={DOCUMENT_PASSWORD_LABEL}
          labelShownBeside
          onValueChange={setPassword}
          opensFocused
          secret
          value={password}
        />
      </DialogRow>
      <DialogFooter>
        <Button
          disabled={over}
          label={DOCUMENT_PASSWORD_APPLY}
          onClick={() => {
            attempt.attempt();
            // GUARDED: the result schema refuses an empty string, so a mismatch would throw `DialogResultRejected`
            // over a document nobody has opened yet. A refused press puts the person back in the field.
            if (!usable) {
              form.current?.querySelector<HTMLElement>('input')?.focus();
              return;
            }
            resolve({ password });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
