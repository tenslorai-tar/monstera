import type { HostRuntimeTransport, HostTermination } from '@monstera/kernel';

/**
 * The engine host's transport, over a reader thread (ADR-0023 §4 and its
 * 2026-08-25 addition).
 *
 * ## What is here and what is deliberately not
 *
 * This is the **ordering and the lifetime**, over an injected channel — the same
 * split as `engineHostFactory.ts` and `enginePipeFactory.ts`, and for the same
 * reason: every property below is decidable without a pipe, a worker or Win32,
 * and a transport testable only against a real host would be tested by nothing.
 *
 * The channel's implementation is the worker thread. It owns the pipe handle,
 * waits over the operation's completion event **and** a stop event, and does the
 * overlapped reads and writes. That shape was decided and measured before this
 * module existed: a reader blocked inside `ReadFile` has to be unwedged with
 * `CancelIoEx` or by closing the handle underneath it, and `proof:teardown`
 * measured both the working design and the rejected one.
 *
 * ## An ending has two causes and they are not the same fact
 *
 * `terminate(reason)` is us. The reader thread going away on its own is the host
 * — it crashed, it exited, the pipe broke. Only the second is something anybody
 * needs to be told about, and a design that reported one sink for both would
 * make a dead host indistinguishable from a shutdown.
 *
 * This is the shape this project has paid for elsewhere: a failure announced on
 * a channel nobody subscribes to is unproven however many checks read the
 * artefact. So the reader ending is a **required** sink rather than an optional
 * callback, and forgetting it is a compile error rather than a host that dies
 * quietly.
 *
 * ## Everything after an ending is dropped, in both directions
 *
 * The runtime loop already drops chunks after its own termination. This drops
 * them one layer lower and for a different reason: bytes the reader posted
 * before it stopped are still in flight when `terminate` returns, and feeding a
 * loop that has been told the connection is gone would let a violated stream's
 * remaining frames be processed — which is precisely what the loop's own stop
 * flag exists to prevent.
 *
 * Writes are dropped for the plainer reason that there is nothing to write to.
 */

/** Why the transport stopped, and which side caused it. */
export interface TransportEnd {
  /**
   * `us` — `terminate` was called. `peer` — the reader thread went away.
   *
   * Two facts, never one field's worth. A host that crashed and a host we killed
   * produce the same silence on the pipe, and only the first is a defect.
   */
  readonly by: 'us' | 'peer';
  /** Diagnostic text. Shapes and reasons — never payload content. */
  readonly detail: string;
}

/**
 * The reader thread, as this module needs to see it.
 *
 * Every member is one thing the worker does, and none of them is Win32-shaped:
 * that is what lets the ordering below be exercised without a pipe.
 */
export interface ReaderChannel {
  /** Hands one already-framed message to the reader thread to write. */
  readonly write: (frame: Uint8Array) => void;
  /**
   * Signals the stop event.
   *
   * Called **at most once** by this module, which is not the same as the reader
   * being able to survive two: `SetEvent` twice is harmless, and the guarantee
   * offered here is about this module's own discipline rather than about what
   * the other side tolerates.
   */
  readonly stop: () => void;
  /** Registers the sink for bytes the reader produced. Called once, at wiring. */
  readonly onChunk: (sink: (chunk: Uint8Array) => void) => void;
  /** Registers the sink for the reader going away. Called once, at wiring. */
  readonly onEnded: (sink: (detail: string) => void) => void;
}

/** Where the transport's two outputs go. Both required — see the note above. */
export interface TransportSinks {
  /** The runtime loop's `receive`. */
  readonly receive: (chunk: Uint8Array) => void;
  /** Called exactly once, whichever side ended it. */
  readonly ended: (end: TransportEnd) => void;
}

/**
 * @param channel The reader thread. See {@link ReaderChannel}.
 * @param sinks Where chunks and the ending go. See {@link TransportSinks}.
 * @returns The transport the runtime loop is given.
 */
export function createHostTransport(
  channel: ReaderChannel,
  sinks: TransportSinks,
): HostRuntimeTransport {
  /**
   * Held on an object rather than in a `let`, for the reason `runtime.ts` states
   * about its own stop flag: a plain `let` lets the compiler narrow the value
   * after one guard and call the next check unreachable, and the check it would
   * delete is the one that stops a chunk reaching a loop that has ended.
   */
  const state: { end: TransportEnd | null } = { end: null };

  /**
   * Records the ending once and tells the caller once.
   *
   * The FIRST cause wins, deliberately. A reader that went away and was then
   * terminated ended because of the reader; reporting the later call would
   * relabel a dead host as a clean shutdown, which is the one direction that
   * loses a defect.
   */
  const finish = (end: TransportEnd): boolean => {
    if (state.end !== null) return false;
    state.end = end;
    sinks.ended(end);
    return true;
  };

  channel.onChunk((chunk) => {
    if (state.end !== null) return;
    sinks.receive(chunk);
  });

  channel.onEnded((detail) => {
    // NOT followed by `stop`. The reader is what would receive it, and it is
    // gone; signalling a stop event nobody is waiting on would be a call made to
    // look symmetrical.
    finish({ by: 'peer', detail });
  });

  return {
    write: (frame: Uint8Array): void => {
      if (state.end !== null) return;
      channel.write(frame);
    },

    terminate: (reason: HostTermination): void => {
      // `stop` ONLY WHEN THIS CALL IS THE ENDING. A terminate that arrives after
      // the reader already went away has nothing to stop, and calling anyway
      // would be a signal into a thread that has exited — harmless today and a
      // shape that invites someone to make the channel do work there.
      if (finish({ by: 'us', detail: `${reason.code}: ${reason.detail}` })) {
        channel.stop();
      }
    },
  };
}
