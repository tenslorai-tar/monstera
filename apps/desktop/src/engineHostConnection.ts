import { type HostClient, type HostTermination, createHostClient } from '@monstera/kernel';
import { type Result, err, ok } from '@monstera/shared';

import {
  type HostPipe,
  type PipeCreationSurface,
  type PipeHandle,
  createHostPipe,
} from './enginePipeFactory.js';
import { type ContainerSid, type UserSid } from './hostDacl.js';
import { type ReaderHostSurface, createEngineReaderChannel } from './engineReaderChannel.js';
import { type HostCreationSurface, createContainedHost } from './engineHostFactory.js';
import { type OverlappedWriteSurface, createHostWriteQueue } from './hostWriteQueue.js';
import { type TransportEnd, createHostTransport } from './hostTransport.js';

/**
 * The composition point that creates a host, a pipe, a reader and a transport
 * together, and hands back one thing that can be called (ADR-0023 §4).
 *
 * Every part below already existed with nothing joining them: `createHostPipe`
 * makes the channel, `createEngineReaderChannel` puts a thread on one end,
 * `createHostWriteQueue` bounds the other, `createHostTransport` gives the two
 * directions one lifetime, `createHostClient` turns that into an `invoke`, and
 * `createContainedHost` starts the process that answers. This file is the
 * **order** they go in and the **teardown** that undoes exactly what was built.
 *
 * ## The host is created LAST, and that is a requirement rather than a taste
 *
 * Two mechanisms, and the second is the one that would be expensive to
 * rediscover.
 *
 * - **A reader must be waiting before a client connects.** The reader thread is
 *   what issues `ConnectNamedPipe`; a server instance nobody has connected
 *   cannot be read, which `readerWorker.ts` records as the wedge Decision 8
 *   exists to kill. Starting the process first makes the ordinary path depend
 *   on the host being slower than we are.
 * - **A death has nowhere to be reported until the transport exists.** The
 *   engine host is the only stage here that creates something outside this
 *   process, so it is also the only one that can fail *after* it succeeds.
 *   Creating it last means every earlier refusal frees everything with no
 *   process having existed at all — the property `createContainedHost` already
 *   has internally, one layer up.
 *
 * ## One teardown path, taken by a crash and by a deliberate close alike
 *
 * `close()` does nothing but terminate the transport, which calls the `ended`
 * sink — the same sink a dead reader reaches. So there is exactly one function
 * that knows what has to be freed and in what order, and no way for the two
 * routes to drift apart. `hostTransport.ts` guarantees that sink runs **once**,
 * whichever side ended it, so the freeing below needs no re-entry guard of its
 * own.
 *
 * ## What is deliberately not here
 *
 * **Session lifetime.** A dead host is rebuilt by the supervisor
 * ([ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9), which owns the per-document failure count, the poisoning and the
 * lane-entered rebuild. This file reports the ending and frees the resources; it
 * has no opinion about whether another host should exist.
 *
 * **The pipe's name.** Supplied, because uniqueness is a property of the *set*
 * of hosts and this module can only see one. The caller that mints it is also
 * the caller that must put it in the host's command line, which is why
 * {@link EngineHostConnectionSurfaces.hostFor} receives it rather than being
 * built in advance.
 */

/**
 * The adapters this composition drives, each already one native boundary.
 *
 * Injected rather than imported so that every property below is decidable
 * without a pipe, a worker or a process — the same split
 * `enginePipeFactory.ts`, `engineReaderChannel.ts` and `engineHostFactory.ts`
 * already make, and the reason this file's cases run in milliseconds.
 */
export interface EngineHostConnectionSurfaces {
  /** Creating the pipe. `createWin32PipeSurface()`. */
  readonly pipes: PipeCreationSurface;
  /** The stop event and the reader worker. `createReaderHostSurface()`. */
  readonly reader: ReaderHostSurface;
  /** Overlapped writes on the instance the reader owns. `createWin32WriteSurface`. */
  readonly writesFor: (pipe: PipeHandle) => OverlappedWriteSurface;
  /**
   * Creating the process, given the pipe it must connect to.
   *
   * A function of the name rather than a prepared surface: the host learns the
   * pipe from its command line, so the surface cannot be built until the name
   * exists, and the name cannot exist before this call.
   */
  readonly hostFor: (pipeName: string) => HostCreationSurface;
}

export interface EngineHostConnectionOptions {
  /** The pipe's full name, `\\.\pipe\…`. Unique per host — see the note above. */
  readonly pipeName: string;
  /** This process's own user SID. */
  readonly user: UserSid;
  /** The AppContainer's SID. */
  readonly container: ContainerSid;
  /** The reader's read buffer. */
  readonly readBytes: number;
  /**
   * How many writes may be outstanding before the connection is torn down.
   *
   * Required and undefaulted, as the queue's own limit is: a frame the peer
   * never saw leaves the next length prefix landing in the wrong place, so the
   * bound is a correctness property and not a tuning knob.
   */
  readonly maxOutstandingWrites: number;
  /** How many calls may be waiting for an answer. Required, as the client's is. */
  readonly maxInFlight: number;
  /** The job's `ProcessMemoryLimit`. `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES`. */
  readonly processMemoryLimitBytes: number;
  /** The correlation id source, injected so a test can make it deterministic. */
  readonly correlate: () => string;
  /**
   * The connection ended. Called **once**, and only for a connection that
   * started.
   *
   * Must not throw, for the reason every sink in this shell must not: it runs
   * while a failure is already in progress, and a throwing sink replaces a
   * diagnosable failure with an undiagnosable one.
   *
   * It is called **after** everything has been freed, so a caller may rebuild
   * inside it without racing this module's teardown.
   */
  readonly onEnded: (reason: HostTermination) => void;
}

/** Why a connection was not created. Every one of these leaves nothing running. */
export interface EngineHostConnectionFailure {
  readonly stage: 'pipe' | 'reader' | 'host';
  readonly detail: string;
}

/** A live connection to a contained engine host. */
export interface EngineHostConnection {
  /** The host, as something that can be called. */
  readonly client: HostClient;
  /** The host process's id. Diagnostics only; nothing addresses the host by it. */
  readonly pid: number;
  /**
   * Ends the connection and frees everything it built.
   *
   * Idempotent. Takes the same path a dead host takes, so `onEnded` fires with
   * `shutdown` rather than being skipped — a caller that has to distinguish
   * "the host went away" from "we closed it" reads the code, which is exactly
   * the distinction those two codes exist to carry.
   */
  readonly close: () => void;
  /** Whether the connection has ended, for whatever reason. */
  readonly ended: () => boolean;
}

/**
 * @param surfaces The adapters. See {@link EngineHostConnectionSurfaces}.
 * @param options See {@link EngineHostConnectionOptions}.
 * @returns The connection, or the stage that refused and why.
 */
export function createEngineHostConnection(
  surfaces: EngineHostConnectionSurfaces,
  options: EngineHostConnectionOptions,
): Result<EngineHostConnection, EngineHostConnectionFailure> {
  const pipe = createHostPipe(
    surfaces.pipes,
    options.pipeName,
    options.user,
    options.container,
    // ONE, and not an option. This composition starts one reader, so a second
    // instance would be a pipe end nothing reads — a knob whose only correct
    // value is the one here.
    1,
  );
  if (!pipe.ok) return err({ stage: 'pipe', detail: `${pipe.error.stage}: ${pipe.error.detail}` });

  const instance = firstInstanceOf(pipe.value);
  const closePipe = (): void => {
    surfaces.pipes.close(instance);
  };

  const reader = createEngineReaderChannel(surfaces.reader, instance, options.readBytes);
  if (!reader.ok) {
    closePipe();
    return err({ stage: 'reader', detail: reader.error });
  }
  const channel = reader.value;

  const queue = createHostWriteQueue(surfaces.writesFor(instance), options.maxOutstandingWrites);

  /**
   * What the sinks need and what does not exist when they are written.
   *
   * The transport's sinks are supplied at construction and the client is built
   * *from* the transport, so `receive` and `ended` both close over something
   * one line below them. Held on an object and read through the property rather
   * than captured in a `let`, for the reason `hostTransport.ts` and `client.ts`
   * both state about their own: a plain `let` lets the compiler narrow after one
   * assignment and call a later read unreachable.
   */
  const state: {
    client: HostClient | null;
    host: { readonly pid: number; readonly free: () => void } | null;
    started: boolean;
    end: HostTermination | null;
  } = { client: null, host: null, started: false, end: null };

  /**
   * Which termination the ending really is.
   *
   * `TransportEnd.by` answers *who called `terminate`*, and the client calls it
   * for a protocol violation — so `us` covers a deliberate close and a violation
   * alike, and only this module knows which of the two happened. Reading the
   * client's own termination first is what separates them, and it is also why
   * the mapping below never has to guess: by the time `us` reaches it with
   * nothing raised, `close()` is the only thing that can have caused it.
   *
   * This is the mapping DDDD-15 existed for. Before `connection-lost` and
   * `shutdown` there was nothing here to return that was not a violation
   * somebody would have had to have committed.
   */
  const reasonFor = (end: TransportEnd): HostTermination => {
    const raised = state.client?.termination() ?? null;
    if (raised !== null) return raised;
    return end.by === 'peer'
      ? { code: 'connection-lost', detail: end.detail }
      : { code: 'shutdown', detail: end.detail };
  };

  /**
   * Everything the ending has to free, in one place and in one order.
   *
   * Callers are settled FIRST: a promise nobody settles is the failure that
   * costs most, and freeing handles ahead of it only lengthens the window in
   * which somebody is still waiting.
   */
  const ended = (end: TransportEnd): void => {
    const reason = reasonFor(end);
    state.end = reason;

    // A no-op when the client raised the violation itself, which is why the
    // first cause survives: `client.fail` keeps the termination it already has.
    state.client?.fail(reason);

    channel.dispose();
    state.host?.free();
    closePipe();

    // ONLY for a connection that started. A host that never came up reports its
    // failure through the returned `Result`, and calling this as well would
    // report one failure twice — as a refusal and as a death.
    if (state.started) options.onEnded(reason);
  };

  const transport = createHostTransport(channel.channel, queue, {
    receive: (chunk) => state.client?.receive(chunk),
    ended,
  });

  const client = createHostClient({
    transport,
    maxInFlight: options.maxInFlight,
    correlate: options.correlate,
  });
  state.client = client;

  // ONE surface, built once and kept. Asking for a second would give the
  // teardown below a different adapter from the one that created the process —
  // two opinions about the same handles, which is the shape B3a names, and here
  // the second opinion would be the one holding the kill.
  const surface = surfaces.hostFor(options.pipeName);

  const host = createContainedHost(surface, options.processMemoryLimitBytes);
  if (!host.ok) {
    // Through the transport, so the one teardown path runs. `started` is still
    // false, so nothing is reported to `onEnded`.
    transport.terminate({ code: 'shutdown', detail: 'the host was never created' });
    return err({ stage: 'host', detail: `${host.error.stage}: ${host.error.detail}` });
  }

  state.host = {
    pid: host.value.pid,
    free: () => {
      // TERMINATED BEFORE ANY HANDLE IS CLOSED, which is `engineHostFactory.ts`'s
      // own rule: the job carries `KILL_ON_JOB_CLOSE`, and relying on that makes
      // the kill a side effect of tidying up rather than the thing we asked for.
      surface.terminate(host.value.process);
      surface.close(host.value.process);
      surface.close(host.value.job);
    },
  };

  state.started = true;

  return ok({
    client,
    pid: host.value.pid,
    close: () => {
      if (state.end !== null) return;
      transport.terminate({ code: 'shutdown', detail: 'the shell closed this connection' });
    },
    ended: () => state.end !== null,
  });
}

/**
 * The instance the reader will own.
 *
 * A `RangeError` rather than a refusal, because it cannot be an outcome: one
 * instance was requested and `createHostPipe` refuses anything under one, so an
 * empty list here would mean that factory returned `ok` having built nothing.
 * Reporting it as a stage failure would file a broken callee as a Win32 refusal.
 */
function firstInstanceOf(pipe: HostPipe): PipeHandle {
  const instance = pipe.instances[0];
  if (instance === undefined) {
    throw new RangeError(
      `createHostPipe returned ok for ${pipe.name} with no instances. One was requested, and ` +
        'that factory refuses fewer than one, so this is the factory disagreeing with itself ' +
        'rather than a pipe that could not be created.',
    );
  }
  return instance;
}
