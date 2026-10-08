import { useEffect } from 'react';

import { TOAST_UNFINISHED } from './messages/en.js';
import type { ShowToast } from './toasts.js';

/** The smallest gap between two reports, in milliseconds: a burst of rejections is one thing that went wrong. */
export const UNFINISHED_REPORT_GAP_MS = 5000;

/**
 * What the window can listen on and be told: `unhandledrejection` is dispatched on `window`, and a case hands over a
 * stand-in with the same two members.
 */
export interface RejectionSource {
  addEventListener(type: 'unhandledrejection', listener: () => void): void;
  removeEventListener(type: 'unhandledrejection', listener: () => void): void;
}

/**
 * Says so when a promise nobody was waiting for is rejected (CR-COR-12).
 *
 * Nineteen commands, the range transport and the annotation overlay start work with `void` and no handler: a rejected
 * channel, a dialog that refused its props or a document that failed to close went to the console, and the person saw an
 * action that did nothing. This is the one place a rejection with no owner reaches them, as a toast that says something
 * did not finish.
 *
 * **It does not stop the browser's own report** (no `preventDefault`), so the console still carries the cause for
 * whoever is looking; the toast is for the person who is not. **It names no cause**, because a rejection's message can
 * hold a path or a fragment of a document, and a sentence on screen is not where that belongs. One report per
 * {@link UNFINISHED_REPORT_GAP_MS}, so a loop of rejections cannot fill the window.
 *
 * @returns the function that removes the listener.
 */
export function reportUnhandledRejections(
  source: RejectionSource,
  show: ShowToast,
  now: () => number = Date.now,
): () => void {
  let last = Number.NEGATIVE_INFINITY;
  const listener = (): void => {
    const at = now();
    if (at - last < UNFINISHED_REPORT_GAP_MS) return;
    last = at;
    show('problem', TOAST_UNFINISHED);
  };
  source.addEventListener('unhandledrejection', listener);
  return (): void => {
    source.removeEventListener('unhandledrejection', listener);
  };
}

/** {@link reportUnhandledRejections} on this window, for as long as the caller is mounted. */
export function useUnhandledRejectionReport(show: ShowToast): void {
  useEffect(() => reportUnhandledRejections(window, show), [show]);
}
