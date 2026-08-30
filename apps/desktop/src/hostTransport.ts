import { AsyncLocalStorage } from 'node:async_hooks';

import type { HostRuntimeTransport, HostTermination } from '@monstera/kernel';

import type { HostWriteQueue } from './hostWriteQueue.js';

/**
 * The async context this module was loaded in, and the one an ending is
 * announced from.
 *
 * ## The defect, measured against a real host on 2026-08-31
 *
 * `sinks.ended` is where the shell learns its host is gone, and its contract
 * says a caller may rebuild inside it. Rebuilding means entering each surviving
 * document's lane — and `DocumentService.run` refuses a lane it is already
 * inside, through an `AsyncLocalStorage` the call inherits.
 *
 * The ending inherits whatever context announced it, and the reader worker is
 * constructed inside `create`, which runs inside **the first document's lane**
 * (the host is built lazily at the first open, ADR-0023 Decision 9c). So every
 * host death arrived carrying that document's lane, and the recovery entry for
 * exactly that document threw `Lane reentry` before it was queued.
 *
 * The shell rebuilt the process and never restored the session:
 * `scripts/research/hostRecovery.mjs` killed a contained host, watched a new one
 * appear in 4086ms, and the next command answered `MissingSessionError`. Every
 * case that had exercised this path injected a `reopen` that entered no lane,
 * which is why nothing saw it.
 *
 * ## Why the snapshot is taken here, at module scope
 *
 * `AsyncLocalStorage.snapshot()` captures the context it is called in, so this
 * is a **restore to module-load time** rather than a clear. That is right for
 * the same reason it is safe: this module is on `entry.ts`'s static import
 * chain, so it loads while the shell is being built and no document exists yet,
 * let alone a lane.
 *
 * The alternative — clearing the store inside `DocumentService` — was rejected:
 * the lane guard is correct, and an ending is not caused by whoever happened to
 * build the connection, so the context it inherits is the wrong one to reason
 * from at any layer below this.
 */
const ANNOUNCE_FROM_MODULE_LOAD = AsyncLocalStorage.snapshot();

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
 * waits over the read's completion event **and** a stop event, and does the
 * overlapped **reads**. That shape was decided and measured before this module
 * existed: a reader blocked inside `ReadFile` has to be unwedged with
 * `CancelIoEx` or by closing the handle underneath it, and `proof:teardown`
 * measured both the working design and the rejected one.
 *
 * ## The two directions are not the same mechanism
 *
 * Writes do not travel to the reader, because a thread inside
 * `WaitForMultipleObjects` cannot be told anything — a `postMessage` to it is
 * not delivered until the wait returns, measured. Main issues them itself, and
 * `hostWriteQueue.ts` holds that ordering and its bound (ADR-0023 §4's
 * 2026-08-25 decision).
 *
 * That is why this module takes a queue beside the channel rather than a channel
 * that does both: they are two mechanisms with two failure modes, and one
 * parameter would have made an overrun and a dead reader the same fact — the
 * error this file's own ending already refuses to make.
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
   * `us` — `terminate` was called. `peer` — the host is why this ended.
   *
   * Two facts, never one field's worth. A host that crashed and a host we killed
   * produce the same silence on the pipe, and only the first is a defect.
   *
   * That test is what decides the value, rather than which side noticed: a write
   * queue that overran is `peer`, because a host that stopped consuming its end
   * is the cause and is a defect to report — even though main is what saw it,
   * and even though the reader thread is still alive at that moment.
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
 * @param writer Main's outstanding writes. See `hostWriteQueue.ts`.
 * @param sinks Where chunks and the ending go. See {@link TransportSinks}.
 * @returns The transport the runtime loop is given.
 */
export function createHostTransport(
  channel: ReaderChannel,
  writer: HostWriteQueue,
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
   * Records the ending once, shuts both mechanisms, and tells the caller once.
   *
   * The FIRST cause wins, deliberately. A reader that went away and was then
   * terminated ended because of the reader; reporting the later call would
   * relabel a dead host as a clean shutdown, which is the one direction that
   * loses a defect.
   *
   * `readerAlive` decides whether the stop event is signalled, and it is a
   * parameter rather than a call at each site because there are now three
   * endings and only one of them has a dead reader. The queue is closed on all
   * three: it holds pinned buffers whatever ended the transport, and an ending
   * that released them on two paths out of three is the shape a fourth ending
   * would get wrong.
   */
  const finish = (end: TransportEnd, readerAlive: boolean): boolean => {
    if (state.end !== null) return false;
    state.end = end;
    // NOT signalled into a reader that has gone: the thread that would receive
    // it has exited, and calling anyway would be a call made to look symmetrical
    // — a shape that invites someone to make the channel do work there.
    if (readerAlive) channel.stop();
    writer.close();
    // DETACHED, and this is the one line that makes recovery possible. See
    // ANNOUNCE_FROM_MODULE_LOAD: the ending otherwise carries the async context
    // of whoever built the connection, which is a document's lane, and the
    // rebuild this sink exists to allow is refused as reentry.
    ANNOUNCE_FROM_MODULE_LOAD(() => {
      sinks.ended(end);
    });
    return true;
  };

  channel.onChunk((chunk) => {
    if (state.end !== null) return;
    sinks.receive(chunk);
  });

  channel.onEnded((detail) => {
    finish({ by: 'peer', detail }, false);
  });

  return {
    write: (frame: Uint8Array): void => {
      if (state.end !== null) return;
      const outcome = writer.write(frame);
      if (outcome.ok) return;
      // A REFUSED WRITE IS AN ENDING, not a dropped frame. The frame the peer
      // will never see leaves the next length prefix landing in the wrong place,
      // so the stream is desynchronised from our side — and `HostRuntimeTransport`
      // has no way to say "this one did not go", deliberately, because a
      // transport that reported per-frame failure would invite a caller to
      // retry into a stream that has already lost its offsets.
      //
      // `peer`, not `us`: an overrun means the host stopped consuming and a
      // refusal means its pipe would not take the bytes. Both are defects to
      // report rather than shutdowns anybody asked for.
      finish({ by: 'peer', detail: `write ${outcome.refusal.reason}: ${outcome.refusal.detail}` }, true);
    },

    terminate: (reason: HostTermination): void => {
      finish({ by: 'us', detail: `${reason.code}: ${reason.detail}` }, true);
    },
  };
}
