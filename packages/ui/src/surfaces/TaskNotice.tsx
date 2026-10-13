import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { TASK_CANCEL, TASK_PROGRESS, TASK_STARTED } from '../messages/en.js';
import type { RunningTask } from '../runningTask.js';

/**
 * The work in progress, on screen wherever the person is: the one place a running task is shown, with its Cancel (the
 * owner's O9: *"users are not notified that it is running"*).
 *
 * In the toast strip, above the toasts, because that strip is on screen over a document and over the start screen alike,
 * where the status bar exists only with a document open. It stays while the work runs and leaves when it ends — never on
 * a timer, since a notice that left before the work did would say the work had stopped.
 *
 * The COUNT is not announced at every step: the strip is a polite live region, and a count that changes every second
 * would be read out every second. The label is announced when the work begins; the count is there to look at.
 */
export function TaskNotice({ task }: { readonly task: RunningTask | undefined }): ReactElement | null {
  const { i18n } = useLingui();
  if (task === undefined) return null;
  const label = i18n._(task.label);
  return (
    <div className="m-toast m-toast--task" data-task-notice={String(task.done)}>
      <p className="m-toast__message">
        {/* NOT A COUNT YET where the work has not said how many parts it has: the label alone, as work beginning. */}
        {task.total === 0 ? (
          i18n._(TASK_STARTED, { label })
        ) : (
          <span aria-live="off">{i18n._(TASK_PROGRESS, { label, done: task.done, total: task.total })}</span>
        )}
      </p>
      <button className="m-toast__action" onClick={task.cancel} type="button">
        {i18n._(TASK_CANCEL)}
      </button>
    </div>
  );
}
