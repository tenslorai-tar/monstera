import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import { type ReactElement, useEffect, useState } from 'react';

import {
  CRASH_REPORT_ADDRESS_LABEL,
  CRASH_REPORT_COPY,
  CRASH_REPORT_DISMISS,
  CRASH_REPORT_FRAGMENTS,
  CRASH_REPORT_OFFER,
  CRASH_REPORT_SHARE,
  CRASH_REPORT_SHARE_FAILED,
} from './messages/en.js';
import { confirmCopied } from './commands/confirmWritten.js';
import { Button } from './primitives/Button.js';
import type { ShowToast } from './toasts.js';

/**
 * Where a person may send a crash report by hand — the owner's address, 2026-09-26 (ADR-0109). **Not live**: shown
 * and copied, and nothing in this application or its tests ever sends to it.
 */
export const CRASH_REPORT_ADDRESS = 'report@monsterapdf.com';

/**
 * *Send us the crash report?* — on the start screen after a run that crashed
 * ([ADR-0109](../../../docs/DECISIONS/0109-a-crash-report-is-written-here-and-sent-only-by-the-person.md)).
 *
 * The report leaves only if the person sends it: **Share…** opens the Windows Share sheet with the report and the
 * diagnostics log, and the address is shown with **Copy address** for a mail app that is not a Share target. The
 * sentence beneath says a report can hold parts of the documents that were open. **Not now** stops the offer for this
 * report. Nothing here composes, addresses or sends a message.
 *
 * Like `RecentFiles`, it projects no command: one datum from main, with its own controls (ADR-0068's rule for data).
 */
export function CrashReportOffer({
  client,
  toast,
}: {
  readonly client: ContractClient;
  /** Where the copied address is confirmed: every copy's one confirmation (`confirmCopied`). */
  readonly toast: ShowToast;
}): ReactElement | null {
  const { _ } = useLingui();
  const [report, setReport] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client['crashReport.pending']({}).then(
      (answer) => {
        if (!cancelled && answer.ok) setReport(answer.value.report?.id ?? null);
      },
      () => {
        // NOTHING: an offer that cannot be read is an offer not made, and the start screen works without it.
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client]);

  if (report === null) return null;

  return (
    <section aria-label={_(CRASH_REPORT_OFFER)} className="m-crash-offer" data-crash-offer="">
      <p className="m-crash-offer__question">{_(CRASH_REPORT_OFFER)}</p>
      <div className="m-crash-offer__actions">
        <Button
          label={CRASH_REPORT_SHARE}
          variant="primary"
          onClick={() => {
            void client['crashReport.share']({ id: report }).then((answer) => {
              // OFFERED IS THE SHEET SHOWN, and the offer then goes: the person has it in front of them.
              if (answer.ok && answer.value.outcome === 'offered') setReport(null);
              else setProblem(true);
            });
          }}
        />
        <Button
          label={CRASH_REPORT_DISMISS}
          onClick={() => {
            void client['crashReport.dismiss']({ id: report });
            setReport(null);
          }}
        />
      </div>
      <p className="m-crash-offer__address">
        {_(CRASH_REPORT_ADDRESS_LABEL, { address: CRASH_REPORT_ADDRESS })}{' '}
        <Button
          label={CRASH_REPORT_COPY}
          onClick={() => {
            // THROUGH MAIN: the renderer holds no clipboard permission (§2), and *Copied* shows only when main says so.
            void client['window.copyText']({ text: CRASH_REPORT_ADDRESS }).then((answer) => {
              if (answer.ok && answer.value.copied) confirmCopied({ toast });
            });
          }}
        />
      </p>
      <p className="m-crash-offer__warning">{_(CRASH_REPORT_FRAGMENTS)}</p>
      {problem ? (
        <p className="m-crash-offer__problem" role="status">
          {_(CRASH_REPORT_SHARE_FAILED)}
        </p>
      ) : null}
    </section>
  );
}
