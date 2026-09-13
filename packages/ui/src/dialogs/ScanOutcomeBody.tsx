import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SCAN_OUTCOME_NONE, SCAN_OUTCOME_PAGES } from '../messages/en.js';

/**
 * What straightening the scans did.
 *
 * `EnhanceOutcomeBody`'s rule: the zero case is a sentence of its own, because a document
 * whose pages all carry text has nothing to straighten and that is the one outcome a
 * reader cannot see. The other sentence says what happens WHERE a sheet was found, since
 * which pages those were is not something this dialog is told.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ScanOutcomeBody({ pages }: { readonly pages: number }): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-scan-outcome">
      {pages === 0 ? <p>{_(SCAN_OUTCOME_NONE)}</p> : <p>{_(SCAN_OUTCOME_PAGES, { count: pages })}</p>}
    </div>
  );
}
