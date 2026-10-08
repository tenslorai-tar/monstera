import { describe, expect, it, vi } from 'vitest';

import { TOAST_UNFINISHED } from './messages/en.js';
import { type RejectionSource, UNFINISHED_REPORT_GAP_MS, reportUnhandledRejections } from './unhandledRejections.js';

/** A source that records its listeners and can raise the event, as the window does. */
function source(): RejectionSource & { readonly raise: () => void; readonly listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    raise: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe('a rejection nobody was waiting for reaches the person (CR-COR-12)', () => {
  it('says something did not finish, once for a burst, and again after the gap', () => {
    const window = source();
    const show = vi.fn();
    let clock = 1_000;
    reportUnhandledRejections(window, show, () => clock);

    window.raise();
    window.raise();
    window.raise();
    expect(show.mock.calls).toStrictEqual([['problem', TOAST_UNFINISHED]]);

    clock += UNFINISHED_REPORT_GAP_MS;
    window.raise();
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: with no rejection nothing is said, and a removed listener says nothing more', () => {
    const window = source();
    const show = vi.fn();
    const stop = reportUnhandledRejections(window, show);
    expect(show).not.toHaveBeenCalled();

    stop();
    expect(window.listeners.size).toBe(0);
    window.raise();
    expect(show).not.toHaveBeenCalled();
  });
});
