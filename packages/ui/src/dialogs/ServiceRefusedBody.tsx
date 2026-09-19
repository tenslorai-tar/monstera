import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { EXCEL_SERVICE_REFUSED } from '../messages/en.js';

/**
 * Which page a service did not read, and why, in one sentence: nothing was written.
 *
 * The *why* is main's sentence, which quotes the service where it explained itself — an account
 * out of credit and a malformed request are both a 400, and only the first is the reader's to act
 * on, so the words that tell them apart are shown rather than summarised.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ServiceRefusedBody({
  page,
  detail,
}: {
  readonly page: number;
  readonly detail: string;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-save-problem">
      <p>{_(EXCEL_SERVICE_REFUSED, { page, detail })}</p>
    </div>
  );
}
