import { describe, expect, it } from 'vitest';

import { type QuitControl, quitAfterShutdown } from './shellShutdown.js';

/**
 * ONE call list across the control and the teardown, which is the point rather
 * than a convenience.
 *
 * Every property here is about ORDER — teardown before the quit, the prevent
 * before the teardown — and per-call spies would let a handler that quit first
 * and tore down afterwards pass each assertion individually. That is the
 * failure this file exists for: **a handler that does nothing also ends up
 * quitting**, so the end state is shared by the correct path and the absent
 * one, and only the sequence separates them.
 */
function control(): {
  control: QuitControl;
  preventDefault: () => void;
  calls: string[];
  errors: unknown[];
} {
  const calls: string[] = [];
  const errors: unknown[] = [];
  return {
    calls,
    errors,
    // The EVENT's call, recorded into the same list as the application's, which
    // is what lets the ordering assertions below be one comparison.
    preventDefault: () => {
      calls.push('preventDefault');
    },
    control: {
      quit: () => calls.push('quit'),
      report: (error) => {
        calls.push('report');
        errors.push(error);
      },
    },
  };
}

describe('quitAfterShutdown', () => {
  it('prevents the quit, tears down, and only then quits', async () => {
    const seen = control();
    const handler = quitAfterShutdown(async () => {
      seen.calls.push('shutdown');
      await Promise.resolve();
      seen.calls.push('shutdown-finished');
    }, seen.control);

    await handler.onBeforeQuit(seen.preventDefault);

    expect(seen.calls).toEqual(['preventDefault', 'shutdown', 'shutdown-finished', 'quit']);
  });

  /**
   * THE CONTROL, and it is the case the ruling turns on. A handler that does
   * nothing at all also exits — Electron quits when `before-quit` returns
   * without a `preventDefault` — so `the process ended` is the observable both
   * paths share and asserting it proves nothing.
   *
   * What only the correct path produces is a `quit` that happens **after** a
   * teardown that has finished. This case fails against a handler that quits
   * without tearing down, against one that tears down without waiting, and
   * against one that never prevents the first quit.
   */
  it('CONTROL: the quit comes after the teardown SETTLES, not after it starts', async () => {
    const seen = control();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = quitAfterShutdown(async () => {
      seen.calls.push('shutdown-started');
      await held;
      seen.calls.push('shutdown-finished');
    }, seen.control);

    const pending = handler.onBeforeQuit(seen.preventDefault);

    // The teardown is in flight and the application MUST still be running.
    await Promise.resolve();
    expect(seen.calls).toEqual(['preventDefault', 'shutdown-started']);
    expect(seen.calls).not.toContain('quit');

    release();
    await pending;
    expect(seen.calls).toEqual([
      'preventDefault',
      'shutdown-started',
      'shutdown-finished',
      'quit',
    ]);
  });

  /**
   * THE SECOND `before-quit` IS OURS. `control.quit()` raises the event again,
   * and preventing that one is an application that cannot be closed — a worse
   * defect than the one being fixed. Asserted as calls: exactly one
   * `preventDefault` and exactly one `shutdown` across both passes.
   */
  it('lets the quit it raised itself through, and tears down once', async () => {
    const seen = control();
    const handler = quitAfterShutdown(async () => {
      seen.calls.push('shutdown');
      await Promise.resolve();
    }, seen.control);

    await handler.onBeforeQuit(seen.preventDefault);
    const second = handler.onBeforeQuit(seen.preventDefault);

    expect(second).toBeNull();
    expect(seen.calls.filter((call) => call === 'preventDefault')).toHaveLength(1);
    expect(seen.calls.filter((call) => call === 'shutdown')).toHaveLength(1);
    expect(seen.calls.filter((call) => call === 'quit')).toHaveLength(1);
  });

  /**
   * A QUIT ARRIVING DURING THE TEARDOWN IS PREVENTED, whoever raised it.
   *
   * Found by CI on both platforms while this machine passed. `app.quit()`
   * closes windows; `main.ts` registers `window-all-closed` to call
   * `app.quit()`; so a second quit arrives from a DIFFERENT cause while the
   * teardown is still running. The old gate let any later quit through — it
   * read "the second pass is ours" — and the process ended mid-teardown with
   * the engine host unclosed.
   *
   * A user quitting by closing the window is the ordinary path, not an edge.
   */
  it('PREVENTS a quit raised by something else while the teardown runs', async () => {
    const seen = control();
    let finish = (): void => undefined;
    const handler = quitAfterShutdown(() => {
      seen.calls.push('shutdown');
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }, seen.control);

    void handler.onBeforeQuit(seen.preventDefault);
    // `window-all-closed` firing mid-teardown, which is what Electron does the
    // moment the first quit closes the last window.
    const during = handler.onBeforeQuit(seen.preventDefault);

    expect(during).toBeNull();
    // THE ASSERTION IS THE CALL, not the end state. Both quits end with the
    // process gone either way, so a case looking at the outcome passes with the
    // defect present. What separates them is whether this one was PREVENTED —
    // two preventDefaults, and no quit yet.
    expect(seen.calls.filter((call) => call === 'preventDefault')).toHaveLength(2);
    expect(seen.calls.filter((call) => call === 'quit')).toHaveLength(0);
    expect(seen.calls.filter((call) => call === 'shutdown')).toHaveLength(1);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.calls.filter((call) => call === 'quit')).toHaveLength(1);
  });

  /**
   * A TEARDOWN THAT FAILS STILL QUITS, and says why. Trapping the user in an
   * application that will not close is worse than whatever failed, and a quit
   * that swallowed the reason would leave the failure with nowhere to be seen —
   * the shape every sink in this shell exists to refuse.
   */
  it('quits and REPORTS when the teardown rejects', async () => {
    const seen = control();
    const boom = new Error('the host would not close');
    const handler = quitAfterShutdown(() => Promise.reject(boom), seen.control);

    await handler.onBeforeQuit(seen.preventDefault);

    expect(seen.calls).toEqual(['preventDefault', 'report', 'quit']);
    expect(seen.errors).toEqual([boom]);
  });
});
