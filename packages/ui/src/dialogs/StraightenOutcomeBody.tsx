import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { STRAIGHTEN_OUTCOME_NONE, STRAIGHTEN_OUTCOME_ONE_PAGE, STRAIGHTEN_OUTCOME_PAGES } from '../messages/en.js';

/**
 * What Straighten did: *the page* in a one-page document, a count otherwise, and nothing changed said as itself.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function StraightenOutcomeBody({
  pages,
  straightened,
}: {
  readonly pages: number;
  readonly straightened: number;
}): ReactElement {
  const { _ } = useLingui();

  const said =
    straightened === 0
      ? _(STRAIGHTEN_OUTCOME_NONE, { count: pages })
      : pages === 1
        ? _(STRAIGHTEN_OUTCOME_ONE_PAGE)
        : _(STRAIGHTEN_OUTCOME_PAGES, { count: straightened });
  return (
    <div className="m-straighten-outcome">
      <p>{said}</p>
    </div>
  );
}
