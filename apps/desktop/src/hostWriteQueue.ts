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
 * ## A refusal is terminal WHERE THERE IS A STREAM TO DESYNCHRONISE
 *
 * A write that was not issued means a frame the peer will never see, and the
 * next frame's length prefix then arrives where the missing one's body should
 * be — the stream is desynchronised from OUR side. There is no resynchronising
 * from that, for the same reason the runtime loop refuses to resynchronise a
 * violated stream: guessing where the next message starts is the peer choosing
 * our parse offsets. Decision 8's shape — kill, never resume — arriving one
 * layer down.
 *
 * **That argument needs a stream, and there is exactly one refusal where there
 * is not one yet.** `ERROR_PIPE_LISTENING` says the instance has no peer
 * connected, so nothing has been written and no offsets exist to be wrong; it
 * is reported as {@link WriteRefusal} `not-connected` and leaves the queue
 * open. Every other refusal still closes it. The reasoning, the measurement and
 * the finding are at {@link ERROR_PIPE_LISTENING}.
 *
 * This paragraph read *"every refusal is terminal, and that is the shape rather
 * than a policy"* until 2026-08-28. It was a shape derived from an argument,
 * and the argument had a case it did not cover.
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

/**
 * Why a write did not go out.
 *
 * **All but one are terminal**, and the exception is not a softening of the
 * rule above — it is the one case the rule's own argument does not cover. See
 * {@link NOT_CONNECTED}.
 */
export type WriteRefusal =
  /** The queue had already ended, by an earlier refusal or by `close`. */
  | { readonly reason: 'closed'; readonly detail: string }
  /** A previously issued write reported failure when it was collected. */
  | { readonly reason: 'failed'; readonly detail: string }
  /** The outstanding set was at its limit after collecting what it could. */
  | { readonly reason: 'overrun'; readonly detail: string }
  /** The surface refused the call. */
  | { readonly reason: 'refused'; readonly detail: string }
  /**
   * The peer has not connected yet. **The one non-terminal refusal**: the queue
   * stays open and a later write can succeed.
   */
  | { readonly reason: 'not-connected'; readonly detail: string };

/**
 * `ERROR_PIPE_LISTENING` — the server instance exists and no client has
 * connected to it.
 *
 * ## Why this one errno is not an ending, stated as a mechanism
 *
 * The header's argument for every refusal being terminal is that a frame the
 * peer never sees leaves the next length prefix landing in the wrong place, so
 * the stream is desynchronised from our side. That argument needs a stream.
 *
 * `536` says there is not one: the instance is in its **listening** state, so
 * nothing has been written to it and no peer has read anything. A first frame
 * refused for this reason leaves no offsets wrong, because there are no
 * offsets. Nor can it arrive mid-stream — an instance returns to listening only
 * through `DisconnectNamedPipe`, which nothing in this design calls; a peer that
 * goes away mid-stream produces `ERROR_BROKEN_PIPE` or `ERROR_NO_DATA`, and
 * those stay terminal.
 *
 * ## Why the branch exists at all (finding YYYY-1)
 *
 * `surface.lastError()` was already being read here and spent on a string. The
 * one number that separates *the peer has not connected* from *the peer is
 * gone* was fetched, interpolated into a diagnostic, and discarded — Rule 0's
 * own listed shape, a request whose response nobody reads.
 *
 * Measured 2026-08-28: `createEngineHostConnection` returns as soon as the host
 * process is created, so the first frame beats the host's `CreateFile` on the
 * pipe every time — 3 of 3, deterministic rather than a race. Collapsed into
 * `refused`, that shut the queue and ended the connection as `connection-lost`,
 * which `engineSessions` counts as a death; two deaths poison the document
 * under ADR-0023 Decision 9a. A startup ordering problem was being routed into
 * the recovery path for a crash.
 *
 * The factory not handing out a client until the peer has connected is the
 * design fix and makes this state unreachable from that path. This branch is
 * correct independently of it: a classifier that reads the discriminating value
 * and throws it away is wrong whatever the caller does.
 */
const ERROR_PIPE_LISTENING = 536;

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
        // READ ONCE, then branched on AND reported. It used to be read only to
        // be interpolated — see {@link ERROR_PIPE_LISTENING} for why that made a
        // startup ordering problem indistinguishable from a dead host.
        const errno = surface.lastError();
        if (errno === ERROR_PIPE_LISTENING) {
          return {
            ok: false,
            refusal: {
              reason: 'not-connected',
              detail:
                `the write was refused with GetLastError ${String(errno)} ` +
                `(ERROR_PIPE_LISTENING): the pipe instance exists and the host has not ` +
                `connected to it yet. Nothing was written, so no length prefix is misplaced ` +
                `and the queue stays open`,
            },
          };
        }
        return shut({
          reason: 'refused',
          detail: `the write was refused with GetLastError ${String(errno)}`,
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
