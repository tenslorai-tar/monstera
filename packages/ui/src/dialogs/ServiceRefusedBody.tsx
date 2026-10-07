import { useLingui } from '@lingui/react';
import type { SERVICE_REFUSALS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  ANTHROPIC_OUT_OF_CREDIT,
  EXCEL_SERVICE_REFUSED,
  SERVICE_DETAILS,
  SERVICE_WHY_DECLINED,
  SERVICE_WHY_OTHER,
  SERVICE_WHY_REJECTED,
  SERVICE_WHY_TOO_LARGE,
  SERVICE_WHY_TRUNCATED,
  SERVICE_WHY_UNREADABLE,
} from '../messages/en.js';

type Reason = (typeof SERVICE_REFUSALS)[number];

/**
 * A plain sentence for each refusal that reaches this dialog, and a total `Record` so a refusal added to the contract
 * without one is a compile error here, never a dialog that falls back to the service's own words.
 */
const WHY: Readonly<Record<Reason, MessageKey>> = {
  'no-key': SERVICE_WHY_OTHER,
  'not-https': SERVICE_WHY_OTHER,
  'not-the-service': SERVICE_WHY_OTHER,
  unauthorised: SERVICE_WHY_OTHER,
  'out-of-credit': ANTHROPIC_OUT_OF_CREDIT,
  rejected: SERVICE_WHY_REJECTED,
  unavailable: SERVICE_WHY_OTHER,
  unreachable: SERVICE_WHY_OTHER,
  'timed-out': SERVICE_WHY_OTHER,
  refused: SERVICE_WHY_DECLINED,
  truncated: SERVICE_WHY_TRUNCATED,
  'too-large': SERVICE_WHY_TOO_LARGE,
  'unreadable-answer': SERVICE_WHY_UNREADABLE,
  'not-deleted': SERVICE_WHY_OTHER,
  unplaceable: SERVICE_WHY_OTHER,
};

/**
 * Which page a service did not read, and why, in plain words: nothing was written.
 *
 * **The service's own text is behind *Details*, never the message.** It read *an image of 1191x1684 exceeds the maximum
 * image size of the model and would be downsized to 924x1307* (the owner's screenshot of 2026-10-07), which is a fact
 * for whoever is fixing it and not a sentence for a person who asked for a spreadsheet. The sentence says what happened
 * to the page and what to try; the words that tell two refusals apart — an account out of credit and a malformed request
 * are both a 400 — are one press away rather than gone.
 *
 * **Out of credit has the application's own sentence**, the same account the assistant reports, so a person told it two
 * ways from two doors does not read two problems.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ServiceRefusedBody({
  page,
  reason,
  detail,
}: {
  readonly page: number;
  readonly reason: Reason;
  readonly detail: string;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-save-problem">
      <p>{_(EXCEL_SERVICE_REFUSED, { page, detail: _(WHY[reason]) })}</p>
      {detail === '' || reason === 'out-of-credit' ? null : (
        <details className="m-save-problem__details">
          <summary>{_(SERVICE_DETAILS)}</summary>
          <p>{detail}</p>
        </details>
      )}
    </div>
  );
}
