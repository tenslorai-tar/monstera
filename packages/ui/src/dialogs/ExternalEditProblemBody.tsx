import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  EXTERNAL_EDIT_PROBLEM_ABSENT,
  EXTERNAL_EDIT_PROBLEM_AT_CAPACITY,
  EXTERNAL_EDIT_PROBLEM_DOCUMENT_CHANGED,
  EXTERNAL_EDIT_PROBLEM_LAUNCH_FAILED,
  EXTERNAL_EDIT_PROBLEM_NOT_PDF,
  EXTERNAL_EDIT_PROBLEM_NOT_WATCHABLE,
  EXTERNAL_EDIT_PROBLEM_OPEN_ELSEWHERE,
} from '../messages/en.js';
import type { ExternalEditProblem } from './externalEditProblemReasons.js';

/** Each reason's own sentence, exhaustive over the list — a new reason without one does not compile. */
const SENTENCES: Readonly<Record<ExternalEditProblem, MessageKey>> = {
  'not-pdf': EXTERNAL_EDIT_PROBLEM_NOT_PDF,
  'launch-failed': EXTERNAL_EDIT_PROBLEM_LAUNCH_FAILED,
  'not-watchable': EXTERNAL_EDIT_PROBLEM_NOT_WATCHABLE,
  'document-changed': EXTERNAL_EDIT_PROBLEM_DOCUMENT_CHANGED,
  'open-elsewhere': EXTERNAL_EDIT_PROBLEM_OPEN_ELSEWHERE,
  absent: EXTERNAL_EDIT_PROBLEM_ABSENT,
  'at-capacity': EXTERNAL_EDIT_PROBLEM_AT_CAPACITY,
};

/**
 * The external-edit problem dialog's body.
 *
 * Every sentence says what happened to the document — in each case here, nothing — and what
 * the person can do next, for `InsertImageProblemBody`'s reason.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ExternalEditProblemBody({
  reason,
}: {
  readonly reason: ExternalEditProblem;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-external-edit-problem">
      <p>{_(SENTENCES[reason])}</p>
    </div>
  );
}
