import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { STATUS_LABEL, STATUS_PAGE_OF, STATUS_ZOOM } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';

/**
 * The strip along the bottom: where the reader is, and how big the page is.
 *
 * ## It READS and dispatches nothing
 *
 * Every value here is state some other surface already owns — the scroller
 * reports the page, the zoom mode resolves to a scale. A status bar that
 * computed either would be a second answer to a question with one, and the two
 * would disagree exactly when a reader was watching (B3).
 *
 * ## The numbers a person reads, not the ones the kernel counts
 *
 * `pdfjsPageOf` converts, because pages are 1-based everywhere a person can see
 * them and 0-based everywhere they cross the contract. The conversion is
 * `pageNumbering.ts`' and appears nowhere else here.
 *
 * ## `role="status"` and not `aria-live="assertive"`
 *
 * The page number changes on every scroll. An assertive region would interrupt
 * a screen-reader user mid-sentence, several times a second, to tell them
 * something they can ask for — which is worse than not announcing it. `status`
 * is polite by definition, and the tabular figures below keep the digits from
 * shifting the layout as they change.
 */
export function StatusBar({
  page,
  pageCount,
  zoom,
}: {
  /** Zero-based, as everything that crosses the contract is. */
  readonly page: number;
  readonly pageCount: number;
  /** The scale actually shown, which for a fit is what the scroller resolved. */
  readonly zoom: number;
}): ReactElement {
  const { i18n } = useLingui();

  return (
    <footer className="m-status-bar" role="status" aria-label={i18n._(STATUS_LABEL)}>
      <span className="m-status-page">
        {i18n._(STATUS_PAGE_OF, { page: pdfjsPageOf(page), count: pageCount })}
      </span>
      <span className="m-status-zoom">
        {/* ROUNDED FOR DISPLAY ONLY. A fit resolves to something like 1.3361,
            and a reader wants 134% — but the value shown is derived from the
            live scale rather than stored, so nothing downstream can pick up the
            rounding. */}
        {i18n._(STATUS_ZOOM, { percent: Math.round(zoom * 100) })}
      </span>
    </footer>
  );
}
