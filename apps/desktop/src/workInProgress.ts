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
export type WorkProgress = { readonly kind: 'idle' } | { readonly kind: 'running'; readonly done: number; readonly total: number };

/** A handle that reports nowhere and is never stopped: the work's caller named no work. */
const UNNAMED: WorkHandle = { step: () => undefined, stopped: () => false, end: () => undefined };

export class WorkInProgress {
  readonly #running = new Map<string, { done: number; total: number; stop: boolean }>();

  /** Begins the work named `work`, or one nobody follows where the caller named none. */
  begin(work: string | undefined): WorkHandle {
    if (work === undefined) return UNNAMED;
    const state = { done: 0, total: 0, stop: false };
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
    return state === undefined ? { kind: 'idle' } : { kind: 'running', done: state.done, total: state.total };
  }

  /** Asks the work named `work` to stop at its next part; `false` where nothing runs under that name. */
  cancel(work: string): boolean {
    const state = this.#running.get(work);
    if (state === undefined) return false;
    state.stop = true;
    return true;
  }
}
