import { type Result, err, ok } from '@monstera/shared';
import type { ReaderMessage, ReaderWorkerData } from '@monstera/nodemode';

import type { PipeHandle } from './enginePipeFactory.js';
import type { ReaderChannel } from './hostTransport.js';
import type { StopEvent } from './win32PipeSurface.js';

/**
 * Starting the engine host's reader thread and giving `hostTransport.ts` the
 * channel it asks for (ADR-0023 §4, ADR-0024).
 *
 * ## What is here and what is deliberately not
 *
 * The **ordering and the lifetime**, over an injected surface — the same split
 * as `enginePipeFactory.ts`, `hostWriteQueue.ts` and `engineHostFactory.ts`.
 * Creating a Win32 event, turning a handle into an address and starting a worker
 * belong to the adapter; every property below is decidable without any of them,
 * which is what lets this be exercised in milliseconds.
 *
 * ## The stop event exists before the worker does
 *
 * A reader started without a stop address is a reader nothing can stop, and the
 * only remedy left is killing the thread from outside — the teardown this whole
 * design was chosen to avoid. So the event is created first and its absence is a
 * refusal, not a worker started with a null.
 *
 * ## An ending is forwarded ONCE, from whichever source spoke first
 *
 * The worker has three ways to stop being useful and all three arrive
 * separately: a posted `ended` message, an `error` event, and `exit`. A reader
 * that threw produces an error AND an exit; one that was stopped produces an
 * `ended` message AND an exit. Forwarding each would make a single ending look
 * like several, and the transport above would have to guess which was the cause
 * — so the first one wins here, which is the same rule `hostTransport.ts` applies
 * one layer up and for the same reason.
 *
 * **An exit with nothing said before it is still an ending**, and it is the one
 * worth having: a reader that vanished without a word is a dead host, and
 * silence is exactly what a missing case would produce.
 */

/** A started reader thread, as this ordering needs to see it. */
export interface ReaderWorkerHandle {
  /** Registers the sink for what the reader posts. Called once, at wiring. */
  readonly onMessage: (sink: (message: ReaderMessage) => void) => void;
  /** Registers the sink for a thread-level throw. Called once. */
  readonly onError: (sink: (error: Error) => void) => void;
  /** Registers the sink for the thread ending. Called once. */
  readonly onExit: (sink: (code: number) => void) => void;
  /**
   * Ends the thread from outside.
   *
   * The BACKSTOP, never the mechanism. Stopping a reader is signalling its stop
   * event and letting it return from its own wait — measured at 15ms — and a
   * `terminate` on that path would mask a reader that could not be stopped,
   * which is the failure the two-handle wait exists to make impossible.
   */
  readonly terminate: () => void;
}

/** The Win32 and worker calls this ordering cannot make itself. */
export interface ReaderHostSurface {
  readonly createStopEvent: () => StopEvent | null;
  readonly signal: (event: StopEvent) => boolean;
  readonly closeEvent: (event: StopEvent) => void;
  readonly addressOf: (handle: PipeHandle | StopEvent) => string;
  /** Starts the reader. `null` when the thread could not be created. */
  readonly startWorker: (data: ReaderWorkerData) => ReaderWorkerHandle | null;
  readonly lastError: () => number;
}

/** What the composer holds: the channel to wire, and the way to let it go. */
export interface EngineReaderChannel {
  readonly channel: ReaderChannel;
  /**
   * Runs the sink when the host has connected to the pipe, or at once if it
   * already has.
   *
   * ## Why it is here and not on {@link ReaderChannel}
   *
   * The transport does not need this. What needs it is the **composer**, which
   * must not hand out a client before a peer exists (finding YYYY-1), and the
   * composer is what holds this object. Putting it on the transport's view of
   * the reader would widen an interface for a caller that has no use for it.
   *
   * ## It LATCHES, and that is the whole point rather than a convenience
   *
   * The reader thread starts before the host process is created, so a sink
   * registered afterwards is normally in time. *Normally* is what this class of
   * bug is made of: a signal that fires before anyone is listening and is then
   * gone is a lost wakeup, which is the same shape as the race this mechanism
   * exists to remove. So the arrival is recorded, and registering late runs the
   * sink immediately.
   *
   * At most one sink, and it runs at most once.
   */
  readonly onConnected: (sink: () => void) => void;
  /**
   * Releases the stop event and, if the reader is still alive, ends the thread.
   *
   * Idempotent, and called by the composer after the transport reports its
   * ending. It is separate from `stop` because they answer different questions:
   * `stop` asks the reader to finish, `dispose` gives up its resources — and a
   * reader that was asked and did not finish is a fact worth being able to
   * observe rather than one to tidy away inside `stop`.
   */
  readonly dispose: () => void;
  /** Whether the reader thread has ended. For the composer and for controls. */
  readonly finished: () => boolean;
}

/**
 * @param surface The Win32 and worker calls. See {@link ReaderHostSurface}.
 * @param pipe The instance the reader owns, from `createHostPipe`.
 */
export function createEngineReaderChannel(
  surface: ReaderHostSurface,
  pipe: PipeHandle,
  readBytes: number,
): Result<EngineReaderChannel, string> {
  if (!Number.isInteger(readBytes) || readBytes < 1) {
    return err(
      `A reader's read buffer must be a whole number of bytes, at least 1; got ` +
        `${String(readBytes)}.`,
    );
  }

  // FIRST, and its failure is a refusal. See the note above.
  const stopEvent = surface.createStopEvent();
  if (stopEvent === null) {
    return err(`the stop event could not be created (GetLastError ${String(surface.lastError())})`);
  }

  const worker = surface.startWorker({
    pipeAddress: surface.addressOf(pipe),
    stopAddress: surface.addressOf(stopEvent),
    readBytes,
  });
  if (worker === null) {
    // The event is closed on the way out. A refusal that leaked a handle would
    // be a failure path that costs something every time it is taken, which is
    // the path least likely to be exercised.
    surface.closeEvent(stopEvent);
    return err('the reader thread could not be started');
  }

  /**
   * Held on an object rather than in `let`s for the reason the modules beside
   * this one give: a plain `let` lets the compiler narrow after one guard and
   * call the next check unreachable, and the checks here are what stop a second
   * ending and a second signal.
   */
  const state = { ended: false, stopped: false, disposed: false, connected: false };
  /** @see EngineReaderChannel.dispose */
  let chunkSink: ((chunk: Uint8Array) => void) | null = null;
  let endedSink: ((detail: string) => void) | null = null;
  let connectedSink: (() => void) | null = null;

  /** @see EngineReaderChannel.onConnected — records the arrival, then tells whoever asked. */
  const arrived = (): void => {
    if (state.connected) return;
    state.connected = true;
    const sink = connectedSink;
    connectedSink = null;
    sink?.();
  };

  const finish = (detail: string): void => {
    if (state.ended) return;
    state.ended = true;
    endedSink?.(detail);
  };

  worker.onMessage((message) => {
    if (message.kind === 'connected') {
      // AFTER AN ENDING, DROPPED, as a chunk is. A reader that ended and then
      // reported a connection would let the composer wait on a peer that is
      // already gone — and the composer's own timeout would then blame a slow
      // host for a dead one.
      if (state.ended) return;
      arrived();
      return;
    }
    if (message.kind === 'chunk') {
      // AFTER AN ENDING, DROPPED. Bytes the reader posted before it stopped are
      // still in flight when the ending is reported, and the layer above drops
      // them too — this one drops them so the two layers cannot disagree about
      // whether a chunk arrived after the end.
      if (state.ended) return;
      chunkSink?.(message.bytes);
      return;
    }
    finish(message.detail);
  });

  worker.onError((error) => {
    finish(`the reader thread threw: ${error.message}`);
  });

  worker.onExit((code) => {
    // AN EXIT WITH NOTHING SAID BEFORE IT IS STILL AN ENDING. `finish` keeps the
    // first cause, so an exit following a posted ending changes nothing; an exit
    // following silence is a reader that vanished, which is a dead host and
    // exactly what a missing case here would render as nothing at all.
    finish(`the reader thread exited with code ${String(code)} without reporting`);
  });

  return ok({
    channel: {
      stop: (): void => {
        // ONCE. `SetEvent` twice is harmless and this is about this module's own
        // discipline: a second signal would mean a second caller believed it was
        // ending something, and the transport above already guarantees it calls
        // this at most once.
        if (state.stopped) return;
        state.stopped = true;
        surface.signal(stopEvent);
      },
      onChunk: (sink) => {
        chunkSink = sink;
      },
      onEnded: (sink) => {
        endedSink = sink;
      },
    },

    onConnected: (sink): void => {
      if (state.connected) {
        sink();
        return;
      }
      connectedSink = sink;
    },

    dispose: (): void => {
      if (state.disposed) return;
      state.disposed = true;
      // TERMINATE ONLY WHAT IS STILL RUNNING. A reader that ended on its own has
      // nothing to end, and calling anyway would be the shape that lets somebody
      // later conclude the terminate is what stops it.
      if (!state.ended) worker.terminate();
      surface.closeEvent(stopEvent);
    },

    finished: (): boolean => state.ended,
  });
}
