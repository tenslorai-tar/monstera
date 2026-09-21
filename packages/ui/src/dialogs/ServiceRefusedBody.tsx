import { useLingui } from '@lingui/react';
import type { SERVICE_REFUSALS } from '@monstera/contract';
import type { ReactElement } from 'react';

import { ANTHROPIC_OUT_OF_CREDIT, EXCEL_SERVICE_REFUSED } from '../messages/en.js';

/**
 * Which page a service did not read, and why, in one sentence: nothing was written.
 *
 * The *why* is main's sentence, which quotes the service where it explained itself — an account
 * out of credit and a malformed request are both a 400, and only the first is the reader's to act
 * on, so the words that tell them apart are shown rather than summarised.
 *
 * **Except out of credit**, which has the application's own sentence: it is the same account the
 * assistant reports, and a person told it two ways from two doors reads two problems.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ServiceRefusedBody({
  page,
  reason,
  detail,
}: {
  readonly page: number;
  readonly reason: (typeof SERVICE_REFUSALS)[number];
  readonly detail: string;
}): ReactElement {
  const { _ } = useLingui();
  const why = reason === 'out-of-credit' ? _(ANTHROPIC_OUT_OF_CREDIT) : detail;
  return (
    <div className="m-save-problem">
      <p>{_(EXCEL_SERVICE_REFUSED, { page, detail: why })}</p>
    </div>
  );
}
