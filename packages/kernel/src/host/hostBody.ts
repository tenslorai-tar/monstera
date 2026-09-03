import { ENGINE_HOST_FRAME_MAX_BYTES, type IncidentSink } from '@monstera/contract';

import type { CommandExecution } from '../commandSpecs.js';
import type { EngineWriter, MupdfSession } from '../engineSeam.js';
import type { PageGeometryReader } from '../pageGeometry.js';
import type { TokenBytesSource } from '../token.js';
import { engineChannels } from './engineChannels.js';
import {
  type HostContainmentProbe,
  type HostFilesystem,
  type HostDestinationsReader,
  type HostLayersReader,
  type HostPageLinksReader,
  type HostPageTextReader,
  createEngineHandlers,
} from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';
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

/** What the host body needs that only the real process has. */
export interface HostBodyDependencies {
  /** How this process runs a command. `localMupdfExecution`. */
  readonly execution: CommandExecution<'mupdf'>;
  /** The engine. `mupdfWriter`. */
  readonly writer: EngineWriter<MupdfSession>;
  /** The two handed directories, and only ever those. */
  readonly files: HostFilesystem;
  /** ADR-0023 §5's startup check. `probeContainment`. */
  readonly probe: HostContainmentProbe;
  /** How this process reads the view model's geometry. `readPageGeometry`. */
  readonly geometry: PageGeometryReader;
  /** How this process reads one page's structured text, as MuPDF's JSON. */
  readonly pageText: HostPageTextReader;
  /** How this process reads one page's links. `readPageLinks`. */
  readonly pageLinks: HostPageLinksReader;
  /** How this process reads the document's outline. `readDestinations`. */
  readonly destinations: HostDestinationsReader;
  /** How this process reads the document's layers. `readLayers`. */
  readonly layers: HostLayersReader;
  /** Where session ids come from. `cryptoBytes`. */
  readonly tokens: TokenBytesSource;
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
export function startEngineHost(
  stream: HostByteStream,
  dependencies: HostBodyDependencies,
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
    channels: engineChannels,
    handlers: createEngineHandlers(
      createHostSessions(dependencies.tokens),
      dependencies.execution,
      dependencies.writer,
      dependencies.files,
      dependencies.probe,
      dependencies.geometry,
      dependencies.pageText,
      dependencies.pageLinks,
      dependencies.destinations,
      dependencies.layers,
    ),
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
