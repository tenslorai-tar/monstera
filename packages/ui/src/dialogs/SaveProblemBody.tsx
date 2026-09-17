import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  SAVE_REFUSED_CONTESTED,
  SAVE_REFUSED_REPLACED,
  SAVE_REFUSED_TARGET_ABSENT,
  SAVE_REFUSED_UNREPRESENTABLE,
  SAVE_REFUSED_UNVERIFIABLE,
  SAVE_WORK_INTACT,
  SAVE_LAYOUT_FAILED,
  SAVE_LAYOUT_UNAVAILABLE,
  SAVE_NO_TABLES,
  SAVE_NO_TABLES_NO_TEXT,
  SAVE_PDFA_FAILED,
  SAVE_PDFA_UNAVAILABLE,
  SAVE_PRINT_FAILED,
  SAVE_PRINT_UNAVAILABLE,
  SAVE_REVIEW_CHANGED,
  SAVE_WRITE_FAILED,
} from '../messages/en.js';

/** Every outcome this dialog is opened for. */
type SaveProblem =
  | 'contested'
  | 'replaced'
  | 'target-absent'
  | 'unrepresentable'
  | 'unverifiable'
  | 'write-failed'
  | 'layout-unavailable'
  | 'layout-failed'
  | 'no-tables'
  | 'no-tables-no-text'
  | 'review-changed'
  | 'print-unavailable'
  | 'print-failed'
  | 'pdfa-unavailable'
  | 'pdfa-failed';

/**
 * The message for one outcome.
 *
 * ## A RECORD, not a switch, and the difference is what a sixth outcome does
 *
 * A `switch` with no `default` is exhaustive at the point of writing and stays
 * compiling when the union grows — TypeScript only complains if the function's
 * return type forbids `undefined`, which is one indirection away from obvious. A
 * `Record<SaveProblem, MessageKey>` is missing a key the moment the union gains
 * a member, and the error lands on the table rather than on a return path.
 *
 * That matters here because the union is the **channel's** enum, so it grows
 * when the kernel grows a verdict — somewhere else entirely, by somebody who
 * will never open this file unless the compiler sends them.
 */
const MESSAGE: Readonly<Record<SaveProblem, MessageKey>> = {
  contested: SAVE_REFUSED_CONTESTED,
  replaced: SAVE_REFUSED_REPLACED,
  'target-absent': SAVE_REFUSED_TARGET_ABSENT,
  // THE SIXTH, and the first that is about the FORMAT rather than the
  // destination: XFDF has no escape for a control character and the other two
  // export formats carry it. It reaches this dialog rather than a toast for the
  // reason the others do — the document is untouched and there is an action.
  unrepresentable: SAVE_REFUSED_UNREPRESENTABLE,
  unverifiable: SAVE_REFUSED_UNVERIFIABLE,
  'write-failed': SAVE_WRITE_FAILED,
  // A LAYOUT EXPORT's two: no converter on this machine, and one that ran and wrote
  // nothing usable. The document is untouched in both, which the dialog's first line
  // already says, and the plain export is the action.
  'layout-unavailable': SAVE_LAYOUT_UNAVAILABLE,
  'layout-failed': SAVE_LAYOUT_FAILED,
  // AN EXCEL EXPORT that found no table. The second names the remedy where some
  // pages have no text, since the table read can only find a table in text.
  'no-tables': SAVE_NO_TABLES,
  'no-tables-no-text': SAVE_NO_TABLES_NO_TEXT,
  // THE REVIEW'S EDITS were made on a version the document is no longer at.
  'review-changed': SAVE_REVIEW_CHANGED,
  // A PRINT's two: no print dialog on this platform, and a printer that refused a step.
  'print-unavailable': SAVE_PRINT_UNAVAILABLE,
  'print-failed': SAVE_PRINT_FAILED,
  // A PDF/A EXPORT's two, layout text's reason: no converter here, and one that made no PDF/A.
  'pdfa-unavailable': SAVE_PDFA_UNAVAILABLE,
  'pdfa-failed': SAVE_PDFA_FAILED,
};

/**
 * The save-problem dialog's body.
 *
 * ## The reassurance is FIRST, and that is invariant 18 rather than tone
 *
 * A user whose save was refused has one urgent question, and it is not why. The
 * document is intact, still dirty, and its log is untouched; a body that leads
 * with the cause leaves the reader working that out from the absence of bad
 * news. So the first paragraph says the work is still there and the second says
 * what happened.
 *
 * A default export because `declareDialog` takes a `lazy()` component, and
 * `lazy` resolves a module's default.
 */
export default function SaveProblemBody({
  outcome,
}: {
  readonly outcome: SaveProblem;
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-save-problem">
      <p className="m-save-problem-intact">{_(SAVE_WORK_INTACT)}</p>
      <p>{_(MESSAGE[outcome])}</p>
    </div>
  );
}
