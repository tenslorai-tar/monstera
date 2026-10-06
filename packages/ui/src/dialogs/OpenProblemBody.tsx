import type { ReactElement } from 'react';

import { OpenProblemLines } from './OpenProblemLines.js';
import type { OpenProblemProps } from './openProblem.js';

/**
 * The open problem dialog's body: the start screen's own sentences for the same problems.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OpenProblemBody(props: OpenProblemProps): ReactElement {
  return (
    <div className="m-open-problem">
      <OpenProblemLines problems={props.problems} />
    </div>
  );
}
