import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import type { OpenProblemProps } from './openProblem.js';
import { OPEN_PROBLEM_SENTENCE } from './openProblemReasons.js';

/**
 * The open problem dialog's body: the start screen's own sentence for the same problem.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OpenProblemBody(props: OpenProblemProps): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-open-problem">
      <p>{_(OPEN_PROBLEM_SENTENCE[props.reason])}</p>
    </div>
  );
}
