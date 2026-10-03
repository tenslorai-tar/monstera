import { useLingui } from '@lingui/react';
import { MAX_FIND_TEXT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  REDACT_MATCHES_APPLY,
  REDACT_MATCHES_EMPTY,
  REDACT_MATCHES_EXPLAINS,
  REDACT_MATCHES_LABEL,
  REDACT_MATCHES_SCOPE,
  REDACT_MATCHES_SCOPE_ALL,
  REDACT_MATCHES_SCOPE_PAGE,
  REDACT_MATCHES_TOO_LONG,
} from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { RedactMatchesAnswer } from './redactMatches.js';

/**
 * Ask for a term, and mark every occurrence of it.
 *
 * ## The sentence says MARK, and the control says so too
 *
 * The row is called *find-and-redact by search*, and a control with that label
 * would promise removal. What this does is add marks a person can see and
 * delete; *Apply redactions* is the irreversible half, behind its own confirm.
 *
 * ## No *match case*, and the reason is measured
 *
 * MuPDF's page search is case-insensitive and its binding takes no option.
 * `redactMatches.ts` carries the measurement; what matters here is that the
 * absent control is a decision rather than an oversight.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function RedactMatchesBody({
  page,
  resolve,
}: { readonly page: number } & DialogAnswering<RedactMatchesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'page'>('all');

  // NOT TRIMMED for the comparison, unlike the annotation dialogs: a search for
  // a trailing space is a search a person can mean, and the engine takes the
  // string as given. What is refused is an empty one, which matches everything
  // and nothing usefully.
  const over = query.length > MAX_FIND_TEXT;
  const usable = query.length > 0 && !over;
  const attempt = useAttempt();
  const form = useRef<HTMLDivElement>(null);
  // TOO LONG as typed; NOTHING TYPED only once the action is pressed (`attempt.ts`).
  const problem = attemptProblem(attempt, over ? REDACT_MATCHES_TOO_LONG : undefined, query.length === 0, REDACT_MATCHES_EMPTY);

  return (
    <div className="m-redact-matches" ref={form}>
      <DialogRow label={REDACT_MATCHES_LABEL} problem={problem === undefined ? undefined : _(problem)}>
        <Input invalid={problem !== undefined} label={REDACT_MATCHES_LABEL} labelShownBeside onValueChange={setQuery} value={query} />
      </DialogRow>

      <DialogRow label={REDACT_MATCHES_SCOPE}>
        <select
          aria-label={_(REDACT_MATCHES_SCOPE)}
          data-redact-matches-scope=""
          onChange={(event) => {
            setScope(event.target.value === 'all' ? 'all' : 'page');
          }}
          value={scope}
        >
          <option value="all">{_(REDACT_MATCHES_SCOPE_ALL)}</option>
          <option value="page">
            {_(REDACT_MATCHES_SCOPE_PAGE, { page: pdfjsPageOf(page) })}
          </option>
        </select>
      </DialogRow>

      <p className="m-redact-matches__note">{_(REDACT_MATCHES_EXPLAINS)}</p>
      <DialogFooter>
        <Button
          disabled={over}
          label={REDACT_MATCHES_APPLY}
          onClick={() => {
            attempt.attempt();
            // GUARDED: the result schema refuses an empty query, so a mismatch would throw `DialogResultRejected` over
            // the user's document. A refused press puts the person back in the field.
            if (!usable) {
              form.current?.querySelector<HTMLElement>('input')?.focus();
              return;
            }
            resolve({ query, pages: scope === 'all' ? 'all' : [page] });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
