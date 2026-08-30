import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  SAVE_REFUSED_CONTESTED,
  SAVE_REFUSED_REPLACED,
  SAVE_REFUSED_TARGET_ABSENT,
  SAVE_REFUSED_UNVERIFIABLE,
  SAVE_WORK_INTACT,
  SAVE_WRITE_FAILED,
} from '../messages/en.js';

/** Every outcome this dialog is opened for. */
type SaveProblem = 'contested' | 'replaced' | 'target-absent' | 'unverifiable' | 'write-failed';

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
  unverifiable: SAVE_REFUSED_UNVERIFIABLE,
  'write-failed': SAVE_WRITE_FAILED,
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
