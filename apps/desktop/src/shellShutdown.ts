/**
 * What happens between the user quitting and the process ending.
 *
 * ## The defect this exists for, measured before it was written
 *
 * Nothing closed the engine host on the way out. Three readings on 2026-08-31,
 * all on the pinned Electron binary, all in Node mode:
 *
 * | the process | at the end | result |
 * |---|---|---|
 * | kills its host, then exits | `process.exit(0)` | **aborts**, 134, `napi_throw` fatal from the reader's `GetOverlappedResult` |
 * | exits with the host alive | `process.exit(0)` | **hangs** — the line before it printed and the process was still alive when killed by hand |
 * | closes the host deliberately | `close()` | **exit 0**, no fatal |
 *
 * Those three are Node-mode processes built through the same composition root,
 * not the shipped window. What they establish is that the third column has a
 * value that works and that the shell was reaching neither.
 *
 * ## And the shipped `app.quit()` is now measured too
 *
 * This paragraph carried *whether Electron's own `app.quit()` takes either of
 * the first two paths is NOT established* for a range. It is established, on
 * 2026-08-31, by `proof:shell`'s three lifecycle cases: the harness quits for
 * real, its teardown sleeps 250ms between two markers, and a third marker
 * records `will-quit`.
 *
 * | run | markers, in order | exit |
 * |---|---|---|
 * | as shipped | REQUESTED, TEARDOWN_START, TEARDOWN_DONE, WILL_QUIT | 0 |
 * | with `preventDefault` removed | REQUESTED, TEARDOWN_START, WILL_QUIT | 0 |
 *
 * So the shipped Electron honours the `preventDefault` below, and the second
 * row is why the exit code is not the assertion: **both exit 0**. A handler
 * that defers nothing still ends the process cleanly, having abandoned the
 * teardown halfway. The missing DONE is the whole signal.
 *
 * ## Why this file names no Electron
 *
 * The same trade `windowPolicy.ts` makes against `window.ts`: the decision is
 * decidable without a runtime, and a unit test that resolves the `electron`
 * specifier is the shape that had a test downloading Electron a commit ago. So
 * the quit control arrives as three functions and `main.ts` binds them to
 * `app`.
 *
 * ## `before-quit` IS SYNCHRONOUS, which is the whole difficulty
 *
 * Teardown is not. A handler that returns before it finishes leaves the process
 * ending exactly as it did before — row two of the table. So the shape is
 * `preventDefault`, tear down, quit again; and the second `before-quit` — the
 * one our own `quit()` raises — must pass through, or nothing ever ends.
 */

/** The quit-time calls, injected. */
export interface QuitControl {
  /** Ends the application, raising `before-quit` a second time. */
  readonly quit: () => void;
  /**
   * Where a teardown failure goes.
   *
   * A failure must not trap the user in an application that will not close, so
   * the quit happens either way — and a quit that swallowed the reason would be
   * the shape this project spends its time removing.
   */
  readonly report: (error: unknown) => void;
}

/** A `before-quit` handler and the teardown it started. */
export interface QuitHandler {
  /**
   * The handler.
   *
   * `preventDefault` is a PARAMETER rather than a member of {@link QuitControl}
   * because it belongs to the event being handled, not to the application. The
   * alternative — main storing the current event in a mutable and the control
   * reading it — works only while `preventDefault` is called synchronously
   * before the first await, which is a timing assumption nobody would find
   * before it broke.
   *
   * Returns the teardown's promise on the pass that starts it and `null` on
   * every other, so a caller that wants to wait can — Electron does not, and
   * `main.ts` voids it. **Not a test-only accessor:** the value is the honest
   * answer to *did this call begin a teardown*, and production ignoring it is
   * production not needing it.
   */
  readonly onBeforeQuit: (preventDefault: () => void) => Promise<void> | null;
}

/**
 * Ends the application only after `shutdown` has finished.
 *
 * @param shutdown Closes what the shell holds. Called at most once.
 * @param control The quit-time calls.
 */
export function quitAfterShutdown(
  shutdown: () => Promise<void>,
  control: QuitControl,
): QuitHandler {
  let started: Promise<void> | null = null;
  let settled = false;

  return {
    onBeforeQuit: (preventDefault: () => void): Promise<void> | null => {
      // THE PASS THAT GOES THROUGH IS THE ONE AFTER THE TEARDOWN SETTLES, and
      // this used to be "the second pass", which is not the same thing.
      //
      // It read `if (started !== null) return null` — let any later quit
      // through, on the assumption that the only one could be the `control.quit()`
      // below raising `before-quit` again. That assumption is false, and CI
      // found it on both platforms while this machine passed: `app.quit()`
      // closes windows, `main.ts` registers `window-all-closed` to call
      // `app.quit()`, and that second quit arrives from a DIFFERENT cause while
      // the teardown is still running. The process then ended mid-teardown —
      // the engine host left unclosed, which is the whole defect this file
      // exists for.
      //
      // It is not an edge case. A user quitting by closing the window is the
      // ordinary path, and it produces exactly this sequence.
      //
      // So the gate is the teardown's state rather than a call count: every
      // quit before it settles is prevented, whoever raised it, and the first
      // one after is let through. `settled` is set in the same `finally` that
      // calls `control.quit()`, so the quit that call raises always finds it
      // true and an application that cannot be closed stays impossible.
      if (settled) return null;
      if (started !== null) {
        // PREVENTED, NOT IGNORED. Returning null here without preventing lets
        // Electron proceed with this quit while the teardown runs on.
        preventDefault();
        return null;
      }

      preventDefault();
      started = shutdown()
        .catch((error: unknown) => {
          control.report(error);
        })
        .finally(() => {
          settled = true;
          control.quit();
        });
      return started;
    },
  };
}
