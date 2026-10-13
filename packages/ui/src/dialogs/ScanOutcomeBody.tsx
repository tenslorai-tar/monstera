import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  SCAN_OUTCOME_NO_SHEET,
  SCAN_OUTCOME_NONE,
  SCAN_OUTCOME_ONE_PAGE,
  SCAN_OUTCOME_PAGES,
  SCAN_OUTCOME_UNREADABLE,
} from '../messages/en.js';

/**
 * What cropping to the paper did.
 *
 * Each outcome a reader cannot see is a sentence of its own: no photographed page, and no sheet found, both change
 * nothing and say so. A page that could not be read is said beside whatever else happened, since it is the one page
 * a person may look at and wonder about.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ScanOutcomeBody({
  scanned,
  cropped,
  unreadable,
  onePage,
}: {
  readonly scanned: number;
  readonly cropped: number;
  readonly unreadable: number;
  readonly onePage: boolean;
}): ReactElement {
  const { _ } = useLingui();

  const done =
    scanned === 0
      ? _(SCAN_OUTCOME_NONE)
      : cropped === 0
        ? _(SCAN_OUTCOME_NO_SHEET)
        : onePage
          ? _(SCAN_OUTCOME_ONE_PAGE)
          : _(SCAN_OUTCOME_PAGES, { count: cropped });
  return (
    <div className="m-scan-outcome">
      <p>{done}</p>
      {unreadable > 0 ? <p>{_(SCAN_OUTCOME_UNREADABLE, { count: unreadable })}</p> : null}
    </div>
  );
}
