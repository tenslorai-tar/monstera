import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  type ChannelMap,
  type Handlers,
  type IncidentSink,
} from '@monstera/contract';

import { type HostTermination, createHostRuntime } from './runtime.js';

/**
 * The engine host's program, minus everything that needs a real process.
 *
 * `hostEntry.ts` is the runnable and does two things: open the pipe named on
 * its command line, and call this. The split is `composition.ts`/`entry.ts` one
 * layer down, for the same reason — the whole body is then decidable in a unit
 * test with no pipe, no container and no document, and what a test cannot reach
 * is kept as small as it can be.
 *
 * ## This is the hostile side, and it is written as the hostile side
 *
 * Invariant 25's premise is that this process may be compromised. Nothing here
 * gets to decide anything about its own containment: it **attempts two paths
 * and reports what happened**, and `classifyContainment` in main turns that into
 * a verdict. The same shape governs the rest — the handlers answer with declared
 * codes, and a peer that sends something undeclared reaches
 * `HostRuntimeTransport.terminate`, which cannot be talked out of ending the
 * connection.
 *
 * ## The stream is a surface, and the reason is not only testability
 *
 * `net.Socket` is what the entry supplies, and it is measured as workable
 * (ADR-0023's 2026-08-27 addition: libuv opens the pipe itself, which is a
 * different question from the one `enginePipeFactory.ts` answers about adopting
 * a Win32 handle). Taking it as a surface keeps this module free of `node:net`,
 * so a case can drive a violation, a half-frame or a peer that goes away
 * mid-call without a pipe existing.
 */
export interface HostByteStream {
  /** Sends bytes. One already-framed message per call. */
  readonly write: (bytes: Uint8Array) => void;
  /** Registers the sink for bytes arriving. Called once, at wiring. */
  readonly onData: (sink: (chunk: Uint8Array) => void) => void;
  /**
   * Registers the sink for the stream going away by itself. Called once.
   *
   * Distinct from this side closing it: a peer that disappears is main having
   * gone, which ends this process, and there is nothing to report to.
   */
  readonly onEnd: (sink: (detail: string) => void) => void;
  /** Gives the stream up. Idempotent — `terminate` and `onEnd` can both reach it. */
  readonly close: () => void;
}

/**
 * What the host body needs that only the real process has.
 *
 * ## The engine arrives as a CHANNEL SET AND ITS HANDLERS, not as seventeen
 * readers ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md))
 *
 * This interface held every MuPDF reader by name until 2026-09-09, and
 * `startEngineHost` composed `engineChannels` with `createEngineHandlers`
 * itself. That made the body the one place that knew which engine it served —
 * which is precisely what §3's *one host body, parameterised by engine* says it
 * must not be, and what a second host would otherwise have had to copy.
 *
 * The entry composes now, because the entry is already the engine-specific
 * statement: `hostEntry.ts` imports `mupdfWriter` and the twelve readers, and a
 * PDFium entry brings its own. What is left here — framing, dispatch bounds and
 * the single ending — is the part that is the same for both.
 *
 * `TMap` is the channel set and `Handlers<TMap>` is derived from it, so a
 * handler for a channel the map does not declare is a compile error rather than
 * a function nothing ever calls.
 */
export interface HostBodyDependencies<TMap extends ChannelMap> {
  /** This host's channels. `engineChannels` for MuPDF. */
  readonly channels: TMap;
  /** One handler per channel, already bound to this engine's surfaces. */
  readonly handlers: Handlers<TMap>;
  /**
   * Where a handler's thrown diagnostic is recorded.
   *
   * It never crosses the pipe — main receives `internal` and an incident id.
   * In the real host this reaches the diagnostic file the factory inherited a
   * handle for, which is the only channel a container cannot close.
   */
  readonly incidents: IncidentSink;
  /**
   * How many calls may be outstanding.
   *
   * Required and undefaulted here for the reason `runtime.ts` requires it: the
   * alternative is "however many arrive", which is a peer deciding how much
   * memory this process holds.
   */
  readonly maxInFlight: number;
}

/** What the entry keeps hold of. */
export interface EngineHostBody {
  /** The violation that ended this host, or `null` while it is serving. */
  readonly termination: () => HostTermination | null;
  /** How many dispatched calls have not answered. */
  readonly inFlight: () => number;
}

/**
 * Wires the stream to the runtime loop and starts serving.
 *
 * @param stream The host's end of the pipe. See {@link HostByteStream}.
 * @param dependencies See {@link HostBodyDependencies}.
 * @param ended Called once, when this host stops serving — a violation this
 *   side raised, or main going away. The **entry** decides what that means for
 *   the process; this module does not call `process.exit`, because a body that
 *   ends the process cannot be driven by a case.
 */
export function startEngineHost<TMap extends ChannelMap>(
  stream: HostByteStream,
  dependencies: HostBodyDependencies<TMap>,
  ended: (reason: HostTermination) => void,
): EngineHostBody {
  /**
   * ONE ending, whichever side caused it.
   *
   * The runtime terminates on a violation and the stream ends when main goes
   * away, and both routes have to free the same thing and report once. A second
   * report would overwrite the reason — and the case that matters is precisely
   * the one where those two reasons differ, because a violation we raised and a
   * peer that vanished are not the same news.
   */
  const state: { reported: boolean } = { reported: false };
  const finish = (reason: HostTermination): void => {
    if (state.reported) return;
    state.reported = true;
    stream.close();
    ended(reason);
  };

  const runtime = createHostRuntime({
    channels: dependencies.channels,
    handlers: dependencies.handlers,
    transport: {
      write: stream.write,
      terminate: finish,
    },
    incidents: dependencies.incidents,
    maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
    maxInFlight: dependencies.maxInFlight,
  });

  stream.onData(runtime.receive);
  stream.onEnd((detail) => {
    // `connection-lost` and not `shutdown`: this side did not close it. The
    // distinction is the one `reasonFor` draws on main's side of the same
    // event, and it is the difference between a host we killed and one that
    // went away — only the second is a defect.
    finish({ code: 'connection-lost', detail });
  });

  return { termination: runtime.termination, inFlight: runtime.inFlight };
}
