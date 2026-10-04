import { useLingui } from '@lingui/react';
import { MAX_LINK_URI } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  OPEN_FROM_URL_APPLY,
  OPEN_FROM_URL_EMPTY,
  OPEN_FROM_URL_LABEL,
  OPEN_FROM_URL_SCHEME,
  OPEN_FROM_URL_TOO_LONG,
} from '../messages/en.js';
import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { OpenFromUrlAnswer } from './openFromUrl.js';

/**
 * Where the PDF is, on the web.
 *
 * A web link's address rule (`typedRules.ts`' `linkAddressProblem`) with one scheme instead of three: the guard fetches
 * `https:` alone, so a person meets that sentence here rather than a refusal after pressing Open.
 *
 * ## When a refusal is shown (`attempt.ts`)
 *
 * What is typed being WRONG — too long, or not an `https:` address — is said as it is typed, and the action is
 * disabled while it is. NOTHING TYPED is said only once the person presses the action, which stays enabled so that it
 * can be pressed: a dialog that opened by telling the person what they had not typed yet read as already wrong (the
 * owner, 2026-10-03).
 *
 * ## The trim happens once, and the schema is where
 *
 * This tests `text.trim()` and hands `resolve` the RAW value; `OPEN_FROM_URL_RESULT` trims. Trimming here as well would
 * be two writers for one normalisation, and the one that matters is the schema's, which the answer is validated
 * against. What this does is decide whether the action is usable, a rendering question about the same string.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OpenFromUrlBody({ resolve }: DialogAnswering<OpenFromUrlAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');
  const attempt = useAttempt();
  const form = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  // THE CHANNEL'S BOUND, imported rather than restated, so the dialog cannot accept what the channel refuses.
  const over = trimmed.length > MAX_LINK_URI;
  const failed = trimmed.length > 0 && !over ? secure(trimmed) : undefined;
  const usable = trimmed.length > 0 && !over && failed === undefined;
  const invalid = over ? OPEN_FROM_URL_TOO_LONG : failed;
  const problem = attemptProblem(attempt, invalid, trimmed.length === 0, OPEN_FROM_URL_EMPTY);

  return (
    <div className="m-annotation-text" ref={form}>
      <DialogRow label={OPEN_FROM_URL_LABEL} problem={problem === undefined ? undefined : _(problem)}>
        <Input
          invalid={problem !== undefined}
          label={OPEN_FROM_URL_LABEL}
          labelShownBeside
          onValueChange={setText}
          opensFocused
          value={text}
        />
      </DialogRow>
      <DialogFooter>
        <Button
          // ENABLED WHILE EMPTY, so pressing it can say what is missing; disabled only while what is typed is wrong,
          // which the row already says.
          disabled={invalid !== undefined}
          label={OPEN_FROM_URL_APPLY}
          onClick={() => {
            attempt.attempt();
            // GUARDED rather than trusting the disabled attribute, for `DeletePagesBody`'s reason: the schema behind
            // `resolve` refuses an empty string, so a mismatch would throw `DialogResultRejected` over the user's
            // document rather than doing nothing. A refused press puts the person back in the field.
            if (!usable) {
              form.current?.querySelector<HTMLElement>('input')?.focus();
              return;
            }
            resolve({ text });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}

/** `undefined` for an address this build will try to fetch. */
function secure(value: string): MessageKey | undefined {
  try {
    return new URL(value).protocol === 'https:' ? undefined : OPEN_FROM_URL_SCHEME;
  } catch (error) {
    // A STRING `URL` CANNOT PARSE is the same problem to a person as a wrong scheme —
    // `linkAddressProblem`'s reason — and `URL` signals it with this one error.
    if (!(error instanceof TypeError)) throw error;
    return OPEN_FROM_URL_SCHEME;
  }
}
