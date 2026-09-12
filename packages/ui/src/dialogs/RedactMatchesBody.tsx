import { useLingui } from '@lingui/react';
import { MAX_FIND_TEXT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

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
import { Button } from '../primitives/Button.js';
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
  const scopeId = useId();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'page'>('all');

  // NOT TRIMMED for the comparison, unlike the annotation dialogs: a search for
  // a trailing space is a search a person can mean, and the engine takes the
  // string as given. What is refused is an empty one, which matches everything
  // and nothing usefully.
  const over = query.length > MAX_FIND_TEXT;
  const usable = query.length > 0 && !over;

  return (
    <div className="m-redact-matches">
      <Input label={REDACT_MATCHES_LABEL} onValueChange={setQuery} value={query} />

      <label className="m-document-choice" htmlFor={scopeId}>
        {_(REDACT_MATCHES_SCOPE)}
        <select
          id={scopeId}
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
      </label>

      <p className="m-redact-matches__note">{_(REDACT_MATCHES_EXPLAINS)}</p>
      <p className="m-redact-matches__problem" role="status">
        {over ? _(REDACT_MATCHES_TOO_LONG) : query.length === 0 ? _(REDACT_MATCHES_EMPTY) : ''}
      </p>
      <Button
        disabled={!usable}
        label={REDACT_MATCHES_APPLY}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute: the
          // result schema refuses an empty query, so a mismatch would throw
          // `DialogResultRejected` over the user's document.
          if (!usable) return;
          resolve({ query, pages: scope === 'all' ? 'all' : [page] });
        }}
        variant="primary"
      />
    </div>
  );
}
