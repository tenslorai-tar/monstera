import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { COMPONENT_CANNOT_START_DO, COMPONENT_CANNOT_START_WHAT } from '../messages/en.js';

/**
 * The could-not-start notice's body: what happened and that the document is not the cause, then what to do.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ComponentCannotStartBody(): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-permission-notice">
      <p>{_(COMPONENT_CANNOT_START_WHAT)}</p>
      <p>{_(COMPONENT_CANNOT_START_DO)}</p>
    </div>
  );
}
