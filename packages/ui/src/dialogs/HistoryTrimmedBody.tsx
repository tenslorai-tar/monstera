import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { HISTORY_TRIMMED_APPLIED, HISTORY_TRIMMED_LOST } from '../messages/en.js';

/**
 * The history-trimmed dialog's body.
 *
 * ## The command SUCCEEDED, and that is the first sentence
 *
 * `dialog.save-problem` leads with the reassurance because a refused save's
 * urgent question is *is my work still there*. The same rule reaches the
 * opposite arrangement here: this dialog appears after an operation that
 * worked, so a body leading with the loss reads as a failure report and the
 * user's first act would be to look for the damage.
 *
 * ## The number is interpolated rather than described
 *
 * *"Some older steps"* is a sentence that cannot say how much, and the user's
 * next action — whether to save now — turns on the size. The count comes from
 * the kernel's own trim, so it is what actually went rather than an estimate.
 *
 * A default export because `declareDialog` takes a `lazy()` component, and
 * `lazy` resolves a module's default.
 */
export default function HistoryTrimmedBody({
  dropped,
}: {
  readonly dropped: number;
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-history-trimmed">
      <p className="m-history-trimmed-applied">{_(HISTORY_TRIMMED_APPLIED)}</p>
      <p>{_(HISTORY_TRIMMED_LOST, { dropped })}</p>
    </div>
  );
}
