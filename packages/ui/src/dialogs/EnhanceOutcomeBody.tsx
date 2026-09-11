import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { ENHANCE_OUTCOME_NONE, ENHANCE_OUTCOME_PAGES } from '../messages/en.js';

/**
 * What levelling the scans did.
 *
 * The zero case is a sentence of its own rather than *0 pages*, for
 * `OcrOutcomeBody`'s reason: a document whose pages are all text has nothing to
 * level, and that is the one outcome a reader cannot see for themselves.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function EnhanceOutcomeBody({ pages }: { readonly pages: number }): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-enhance-outcome">
      {pages === 0 ? (
        <p>{_(ENHANCE_OUTCOME_NONE)}</p>
      ) : (
        <p>{_(ENHANCE_OUTCOME_PAGES, { count: pages })}</p>
      )}
    </div>
  );
}
