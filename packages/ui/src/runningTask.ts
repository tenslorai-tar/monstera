import type { MessageKey } from '@monstera/shared';

/**
 * A long command reporting how far it has got, and being told to stop.
 *
 * ## The problem this is the shape of
 *
 * `document.word-count` and `document.spell-check` walk every page: four
 * hundred pages is four hundred round trips before anything appears, and the
 * only feedback is a dialog that has not opened yet. Both rows recorded that as
 * owed and both said the same thing about it — **it is a surface question, not
 * a missing `await`.**
 *
 * `searchDocument` already has progress and cancellation, and what gives it
 * them is the **find bar**: a surface that is on screen while the walk runs.
 * A dialog cannot be that surface. Its props are validated at the `ask` call
 * and it opens with the answer, so a dialog is where a walk ENDS.
 *
 * So the surface is the status bar — the one piece of chrome that is present
 * for the whole of a document's life — and this is the seam between it and a
 * command that does not know it exists.
 *
 * ## Why it is a command DEPENDENCY and not a new registry
 *
 * A command already receives shell callbacks as dependencies: `ask` opens a
 * dialog, `onApplied` reports a mutation. `track` is one more of those, so this
 * registers into the pattern the command seam already has rather than adding a
 * seam to `docs/ARCHITECTURE.md` §7's list. Nothing about the command registry
 * changes, and a command that does not take `track` is unaffected.
 *
 * ## A CANCELLED WALK PUBLISHES NOTHING
 *
 * `documentSearch.ts`'s rule, and it applies for the same reason: a partial
 * count is indistinguishable from a complete one once it is on screen. It says
 * *your document has 4,000 words* about a document with 40,000, and a reader
 * who cancelled a slow count has no way to tell. So a cancelled walk opens no
 * dialog at all — the cancel is the outcome.
 *
 * That rule lives in each command rather than here, because this seam cannot
 * enforce it: it hands out a signal and has no opinion about what the caller
 * does with the answer. What it CAN do is make the signal impossible to
 * forget — {@link TrackedTask.signal} is not optional.
 */

/** What a command holds while it runs. */
export interface TrackedTask {
  /**
   * Aborted when the reader presses cancel. **Not optional**: a task that took
   * a signal it could ignore would show a cancel button that does nothing,
   * which is the display-only defect with a progress bar attached.
   */
  readonly signal: AbortSignal;
  /** How far it has got. Called after each unit, never before. */
  readonly step: (done: number) => void;
  /** Finished, cancelled or refused — all three end it. */
  readonly end: () => void;
}

/** What the status bar renders. */
export interface RunningTask {
  readonly label: MessageKey;
  readonly done: number;
  readonly total: number;
  readonly cancel: () => void;
}

/** Starts a task, or does nothing where no surface is listening. */
export type TrackTask = (label: MessageKey, total: number) => TrackedTask;

/**
 * The `track` a command is handed, over a setter the shell owns.
 *
 * `publish` is called with the task and with `undefined` when it ends, which is
 * exactly a `useState` setter's shape — so App holds one piece of state and
 * this function is the whole of the plumbing.
 *
 * @param publish where the shell keeps the running task.
 */
export function trackerOver(publish: (task: RunningTask | undefined) => void): TrackTask {
  return (label, total) => {
    const controller = new AbortController();
    // THE CANCEL IS THE CONTROLLER'S, captured here rather than looked up when
    // the button is pressed. A reader who cancels one walk while a second has
    // started must not stop the second, and a lookup at press time is exactly
    // how that happens.
    const cancel = (): void => {
      controller.abort();
    };
    publish({ label, done: 0, total, cancel });
    return {
      signal: controller.signal,
      step: (done) => {
        // REPUBLISHED WHOLE, because the status bar reads an immutable value.
        // Mutating `done` in place would leave React with the same object and
        // nothing to re-render on, which is a progress indicator that reports
        // 0 for the whole walk and then disappears.
        publish({ label, done, total, cancel });
      },
      end: () => {
        publish(undefined);
      },
    };
  };
}

/**
 * A tracker for a caller with no surface — every unit test, and the browser
 * shim's world.
 *
 * It hands out a signal that is never aborted rather than `undefined`, so the
 * commands have one code path. A command written against an optional tracker
 * would have a branch nothing exercises, which is the specification nobody
 * reads.
 */
export const UNTRACKED: TrackTask = () => ({
  signal: new AbortController().signal,
  step: () => undefined,
  end: () => undefined,
});
