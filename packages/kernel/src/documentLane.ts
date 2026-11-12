/**
 * One document's lane (ADR-0009 §7, its order since [ADR-0274](../../../docs/DECISIONS/0274-a-documents-lane-runs-a-write-before-a-queued-read.md)):
 * one entry runs at a time, and when it ends the lane takes the oldest queued WRITE before the oldest queued READ.
 *
 * A write is a command, undo, redo, save, close, an unlock, a session's rebuild; a read is a query. Nothing interleaves,
 * which is §7's safety rule; what moved is only which queued entry runs next. Measured 2026-10-27 on the owner's laptop
 * (ADR-0274's table), first come first served had a finish wait behind the read on open, the check after a save and the
 * font list's read: 3.8 s against M1's 1.50 s. A running read is never interrupted, since no native call has a safe point to stop at, so a write waits
 * for at most the one read already running.
 *
 * ONE QUESTION DOES NOT WAIT FOR THAT READ ({@link DocumentLane.afterWrites}, ADR-0292): a synchronous question about
 * the document's state in `main`, which no read changes. It waits for the writes before it, and a write after it waits for it.
 */

/** What an entry is to the lane's order. */
export type LaneEntryKind = 'write' | 'read';

interface Waiting {
  readonly kind: LaneEntryKind;
  readonly start: () => Promise<void>;
}

export class DocumentLane {
  readonly #waiting: Waiting[] = [];
  #busy = false;
  /** The kind of the entry running, or `null` while none is. */
  #running: LaneEntryKind | null = null;
  readonly #whenIdle: (() => void)[] = [];

  /**
   * Queues `work` as an entry of `kind` and answers what it answers, or its failure. A failure is the entry's alone: the
   * lane carries none forward, so one command that threw never rejects the commands after it.
   */
  enter<T>(kind: LaneEntryKind, work: () => Promise<T>): Promise<T> {
    // THE WORK WAITS ON A GATE THE LANE OPENS, so what it answers or throws reaches the caller as it is.
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const answer = gate.then(work);
    this.#waiting.push({
      kind,
      start: () => {
        open();
        return answer.then(
          () => undefined,
          () => undefined,
        );
      },
    });
    this.#next();
    return answer;
  }

  /**
   * Answers `ask` once no write is running and no write queued before it is waiting, never waiting for a running READ
   * (ADR-0292): at once where that holds, else as a write-ordered entry, so the writes before it run first and a write
   * after it waits for it. `ask` is synchronous, so it cannot interleave with anything once it starts.
   */
  afterWrites<T>(ask: () => T): Promise<T> {
    const writeAhead = this.#running === 'write' || this.#waiting.some((entry) => entry.kind === 'write');
    if (!writeAhead) {
      try {
        return Promise.resolve(ask());
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return this.enter('write', () => Promise.resolve().then(ask));
  }

  /** Settles once every entry accepted so far has run: what a close waits for before it tears the document down. */
  drained(): Promise<void> {
    if (!this.#busy && this.#waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#whenIdle.push(resolve);
    });
  }

  #next(): void {
    if (this.#busy) return;
    // THE OLDEST WRITE, else the oldest read.
    const write = this.#waiting.findIndex((entry) => entry.kind === 'write');
    const [entry] = this.#waiting.splice(write === -1 ? 0 : write, 1);
    if (entry === undefined) {
      for (const idle of this.#whenIdle.splice(0)) idle();
      return;
    }
    this.#busy = true;
    this.#running = entry.kind;
    void entry.start().finally(() => {
      this.#busy = false;
      this.#running = null;
      this.#next();
    });
  }
}
