/**
 * Work in main that the renderer named, so it can show how far the work has got and stop it (`work.progress`,
 * `work.cancel`; the owner's O9 and O10).
 *
 * ## The renderer names the work, and polls
 *
 * The work's own call is in flight for its whole length, so its progress cannot ride on its answer. The renderer mints a
 * name, sends it with the call, and asks about it while it waits; main keeps two counts and a flag under the name, and
 * nothing that is the file's. A name main holds nothing under answers `idle`: the work has not begun, or has ended.
 *
 * ## Begun by the method once the input is chosen, finished by the handler (ADR-0234)
 *
 * Every conversion takes a name. Its method begins the work after the picker answers, so an open or dismissed picker shows
 * nothing; its handler finishes the name once the answer is ready, so the notice stays through an import's open.
 *
 * ## Stopping is a flag the work reads between parts
 *
 * A part in flight is not interrupted — a host call cannot be taken back half-way — so a stop is honoured at the next
 * part, where the work removes what it made and answers `cancelled`.
 */

/** What a piece of work tells, and asks, while it runs. */
export interface WorkHandle {
  /** How many parts are done, of how many. */
  readonly step: (done: number, total: number) => void;
  /** Whether the person asked the work to stop. */
  readonly stopped: () => boolean;
  /** The work is over; its name answers `idle` from now on. */
  readonly end: () => void;
}

/** What the progress channel answers. */
export type WorkProgress =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly done: number; readonly total: number; readonly stoppable: boolean };

/**
 * Whether the work reads {@link WorkHandle.stopped} between parts. Said at the begin, because the renderer shows Cancel
 * only for work that honours it (ADR-0234 Decision 5): a Cancel a single conversion ignored would do nothing.
 */
export type Stopping = 'stops-between-parts' | 'runs-to-the-end';

export class WorkInProgress {
  readonly #running = new Map<string, { done: number; total: number; stop: boolean; stoppable: boolean }>();

  /**
   * Begins the work named `work`: called ONCE THE INPUT IS CHOSEN (ADR-0234 Decision 3), after the picker answers and
   * before anything is read or converted, so a picker that is open, or dismissed, shows no notice.
   */
  begin(work: string, stopping: Stopping): WorkHandle {
    const state = { done: 0, total: 0, stop: false, stoppable: stopping === 'stops-between-parts' };
    this.#running.set(work, state);
    return {
      step: (done, total) => {
        state.done = done;
        state.total = total;
      },
      stopped: () => state.stop,
      end: () => {
        // ONLY ITS OWN ENTRY: a name reused for a later work is that work's.
        if (this.#running.get(work) === state) this.#running.delete(work);
      },
    };
  }

  progress(work: string): WorkProgress {
    const state = this.#running.get(work);
    return state === undefined
      ? { kind: 'idle' }
      : { kind: 'running', done: state.done, total: state.total, stoppable: state.stoppable };
  }

  /**
   * Ends whatever runs under `work`: called by the conversion's HANDLER once its answer is ready, however the call ended,
   * so the notice lasts until the result appears — an import's open included — and no path out leaves it standing.
   */
  finish(work: string): void {
    this.#running.delete(work);
  }

  /** Asks the work named `work` to stop at its next part; `false` where nothing runs under that name or it cannot stop. */
  cancel(work: string): boolean {
    const state = this.#running.get(work);
    if (state?.stoppable !== true) return false;
    state.stop = true;
    return true;
  }
}
