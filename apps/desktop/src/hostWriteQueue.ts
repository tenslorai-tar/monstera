/**
 * Main's outstanding overlapped writes to the engine host, and the bound on
 * them (ADR-0023 §4's 2026-08-25 decision).
 *
 * ## Why main issues these at all
 *
 * A reader thread inside `WaitForMultipleObjects` cannot be told anything: a
 * `postMessage` to it is not delivered until the wait returns, measured by
 * `scripts/research/transportTeardown.mjs`. So writes cannot travel to the
 * reader, and of the three mechanisms that remain, main issuing them itself is
 * the only one with nothing to tear down and no third native boundary. Its
 * premise is measured rather than argued — 64 writes into a peer that never
 * reads, slowest 1ms, 63 genuinely outstanding when reaped, and the stream
 * delivered in issue order byte for byte, which is what a length-prefixed
 * framing on a byte-mode pipe requires.
 *
 * ## What is here and what is deliberately not
 *
 * The **ordering and the bound**, over an injected surface — the same split as
 * `enginePipeFactory.ts` and `engineHostFactory.ts`. `WriteFile`,
 * `GetOverlappedResult` and the lifetime of an `OVERLAPPED` belong to the
 * adapter that may carry an `any` under B7.
 *
 * ## Every refusal is terminal, and that is the shape rather than a policy
 *
 * A write that was not issued means a frame the peer will never see, and the
 * next frame's length prefix then arrives where the missing one's body should
 * be — the stream is desynchronised from OUR side. There is no resynchronising
 * from that, for the same reason the runtime loop refuses to resynchronise a
 * violated stream: guessing where the next message starts is the peer choosing
 * our parse offsets.
 *
 * So {@link HostWriteQueue.write} has two outcomes, not three, and every
 * non-success closes the queue. Decision 8's shape — kill, never resume —
 * arriving one layer down.
 *
 * ## The bound is a limit, not a watermark
 *
 * A host that stops reading its end makes main hold an `OVERLAPPED` and a pinned
 * buffer per outstanding frame, in the process that carries ARCHITECTURE §9.17's
 * budget. Nothing here waits for the peer, so nothing here notices — which is
 * exactly the property that made main issuing the writes affordable, and exactly
 * why the unbounded set had to become unrepresentable rather than monitored (B5).
 *
 * The limit is required and undefaulted, for the reason the job object's
 * `ProcessMemoryLimit` is: a default is a number nobody chose, sitting in the
 * one place where choosing it is the whole decision.
 *
 * ## When completions are collected
 *
 * On the next write and on {@link HostWriteQueue.close}. Nothing else, and no
 * timer — a timer is a thing that runs on its own, which is what this design was
 * chosen for not having.
 *
 * The residual is stated rather than discovered: a transport that writes once
 * and then goes quiet holds that frame's buffer and `OVERLAPPED` until it ends.
 * That is bounded by the same limit as the overrun, so the worst idle case is
 * `limit` frames pinned — and it is the price of nothing running on its own.
 */

/**
 * One issued write, held until its completion is collected.
 *
 * Opaque, and this module never looks inside one. What it stands for is an
 * `OVERLAPPED` the kernel writes into and a buffer the kernel reads from after
 * the call returned — the two things that must outlive the call, and in
 * JavaScript would otherwise be collected at a time nothing here controls. A
 * shape this module could construct is a shape it could construct wrong.
 */
export interface PendingWrite {
  readonly __handle: 'pending-write';
}

/** What a collect found. Never blocks — see {@link OverlappedWriteSurface}. */
export type WriteState = 'completed' | 'pending' | 'failed';

/**
 * The Win32 calls this ordering needs, as it needs to see them.
 *
 * None of the members is Win32-shaped, which is what lets every property below
 * be exercised without a pipe.
 */
export interface OverlappedWriteSurface {
  /**
   * Issues one overlapped write and returns the handle to its completion, or
   * `null` when the call was refused outright.
   *
   * `ERROR_IO_PENDING` is a success here: the whole point is that the call
   * returns before the peer has read anything.
   */
  readonly issue: (frame: Uint8Array) => PendingWrite | null;
  /**
   * Collects one write's completion **without waiting**.
   *
   * `pending` must be an answer the surface can give — `GetOverlappedResult`
   * with `wait` false reports `ERROR_IO_INCOMPLETE`, measured. A surface that
   * could only answer by waiting would put the stall back in main, which is the
   * reason overlapped-polled-from-main was rejected for reads.
   */
  readonly collect: (write: PendingWrite) => WriteState;
  /** Releases one collected write's event and buffer. Never called for a `pending` one. */
  readonly release: (write: PendingWrite) => void;
  /**
   * Hands back every write still outstanding at the ending, in issue order.
   *
   * ONE call rather than a `release` per write, because releasing an
   * `OVERLAPPED` the kernel may still be writing into is the classic
   * overlapped-I/O defect, and whether it is safe depends on the handle having
   * been closed first — a Win32 rule, which belongs with the Win32 calls. A
   * per-write release here would let this module get that order wrong.
   */
  readonly abandon: (writes: readonly PendingWrite[]) => void;
  /** The last error, for a diagnostic. Read only after a refusal. */
  readonly lastError: () => number;
}

/** Why the queue closed. Every value is terminal; there is no resuming one. */
export type WriteRefusal =
  /** The queue had already ended, by an earlier refusal or by `close`. */
  | { readonly reason: 'closed'; readonly detail: string }
  /** A previously issued write reported failure when it was collected. */
  | { readonly reason: 'failed'; readonly detail: string }
  /** The outstanding set was at its limit after collecting what it could. */
  | { readonly reason: 'overrun'; readonly detail: string }
  /** The surface refused the call. */
  | { readonly reason: 'refused'; readonly detail: string };

/** Success carries nothing: a queued write has no result yet, by construction. */
export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly refusal: WriteRefusal };

export interface HostWriteQueue {
  /**
   * Collects what it can, then issues one frame.
   *
   * In that order, because the limit is about what is *still* outstanding: a
   * queue that checked before collecting would refuse a frame it had room for.
   */
  readonly write: (frame: Uint8Array) => WriteOutcome;
  /** Ends the queue and hands every outstanding write back to the surface. Idempotent. */
  readonly close: () => void;
  /** How many writes are outstanding. For diagnostics and for the proof's controls. */
  readonly outstanding: () => number;
}

/**
 * @param surface The Win32 calls. See {@link OverlappedWriteSurface}.
 * @param limit The most writes that may be outstanding at once. Required and
 *   undefaulted; see the note above. Must be at least 1 — a queue that can hold
 *   nothing refuses its first write, which is a transport that cannot transport.
 */
export function createHostWriteQueue(
  surface: OverlappedWriteSurface,
  limit: number,
): HostWriteQueue {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `A write queue's limit must be a whole number of frames, at least 1; got ${String(limit)}. ` +
        `A zero limit refuses the first write, which is a transport that cannot transport, and a ` +
        `fractional one is a caller that computed it from something it should not have.`,
    );
  }

  /**
   * Held on an object rather than in a `let` for the reason `hostTransport.ts`
   * states about its own: a plain `let` lets the compiler narrow after one guard
   * and call the next check unreachable, and the check it would delete is the
   * one that stops a frame reaching a closed queue.
   */
  const state: { closed: WriteRefusal | null } = { closed: null };
  /** Outstanding writes, in issue order. */
  const queued: PendingWrite[] = [];

  /**
   * Collects every outstanding write, keeping the ones still pending in order.
   *
   * Walks the whole list rather than stopping at the first `pending`. Stopping
   * early would be sound only because completions preserve issue order, and
   * that is a measurement about a byte-mode pipe rather than a property of this
   * ordering — spending it here would put a Win32 fact inside the module that
   * exists to have none.
   *
   * @returns the first failure found, or null.
   */
  const collect = (): WriteRefusal | null => {
    const stillPending: PendingWrite[] = [];
    let failure: WriteRefusal | null = null;
    for (const write of queued) {
      const found = surface.collect(write);
      if (found === 'pending') {
        stillPending.push(write);
        continue;
      }
      // THE FIRST FAILURE WINS, and nothing can currently observe that (finding
      // DDDD-4). The detail below is a constant, so two failures in one sweep
      // produce identical output and this guard survives its own mutation —
      // recorded here rather than deleted, because it is not vacuous code: it
      // encodes the same discipline the transport's ending has, and it becomes
      // load-bearing the day the detail names which write failed.
      if (found === 'failed' && failure === null) {
        failure = {
          reason: 'failed',
          detail:
            `a write reported failure when it was collected, so a frame the peer never saw is ` +
            `missing from the stream and every length prefix after it lands in the wrong place`,
        };
      }
      surface.release(write);
    }
    queued.length = 0;
    queued.push(...stillPending);
    return failure;
  };

  const shut = (refusal: WriteRefusal): WriteOutcome => {
    if (state.closed === null) {
      state.closed = refusal;
      surface.abandon([...queued]);
      queued.length = 0;
    }
    return { ok: false, refusal };
  };

  return {
    write: (frame: Uint8Array): WriteOutcome => {
      const already = state.closed;
      if (already !== null) {
        return {
          ok: false,
          refusal: { reason: 'closed', detail: `the queue ended earlier: ${already.detail}` },
        };
      }

      const failure = collect();
      if (failure !== null) return shut(failure);

      if (queued.length >= limit) {
        return shut({
          reason: 'overrun',
          detail:
            `${String(queued.length)} write(s) are outstanding against a limit of ` +
            `${String(limit)}. The peer has stopped reading its end, and every frame beyond the ` +
            `limit is an OVERLAPPED and a pinned buffer held in the process that carries ` +
            `ARCHITECTURE §9.17's budget`,
        });
      }

      const issued = surface.issue(frame);
      if (issued === null) {
        return shut({
          reason: 'refused',
          detail: `the write was refused with GetLastError ${String(surface.lastError())}`,
        });
      }
      queued.push(issued);
      return { ok: true };
    },

    close: (): void => {
      // COLLECT FIRST. Everything already finished is released the ordinary way,
      // so `abandon` receives only writes the kernel may still be touching —
      // which is the case its contract is about, and a smaller one to be right
      // about.
      if (state.closed === null) collect();
      shut({ reason: 'closed', detail: 'the transport ended' });
    },

    outstanding: (): number => queued.length,
  };
}
