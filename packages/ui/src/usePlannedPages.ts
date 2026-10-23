import { useMemo, useSyncExternalStore } from 'react';

import type { DocumentView } from './documentView.js';
import { type PagePlans, type PendingOp, type PlannedPage, plannedPages } from './pagePlan.js';

const NO_PENDING: readonly PendingOp[] = [];
const NO_PENDING_SNAPSHOT = (): readonly PendingOp[] => NO_PENDING;
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * The pages a surface shows over the view it draws, while page commands are sent and not yet drawn
 * ([ADR-0261](../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md)), or
 * `null` when it shows the view's own pages. ONE reader of the plan for the main view, the strip and Organize, for the
 * reason `usePageRotations` is one: two surfaces asking it two ways show one page turned in one and not the other.
 */
export function usePlannedPages(plans: PagePlans | undefined, view: DocumentView | undefined): readonly PlannedPage[] | null {
  const pending = useSyncExternalStore(plans?.subscribe ?? NO_SUBSCRIBE, plans?.getSnapshot ?? NO_PENDING_SNAPSHOT);
  return useMemo(
    () => (view === undefined ? null : plannedPages(pending, view.version, view.document.numPages)),
    [pending, view],
  );
}
