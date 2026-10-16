import {
  type ClientFileAnswers,
  type HostCallDeadline,
  type HostClient,
  type HostEnding,
  type HostTermination,
  couldNotStart,
  createHostClient,
} from '@monstera/kernel';
import type { NativeComponentId } from '@monstera/contract';
import { type DocId, type Result, err, ok } from '@monstera/shared';

import {
  type HostPipe,
  type PipeCreationSurface,
  type PipeHandle,
  createHostPipe,
} from './enginePipeFactory.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  type EngineReaderChannel,
  type ReaderHostSurface,
  createEngineReaderChannel,
} from './engineReaderChannel.js';
import { type HostCreationSurface, type ProcessorTime, createContainedHost } from './engineHostFactory.js';
import { type OverlappedWriteSurface, createHostWriteQueue } from './hostWriteQueue.js';
import { type TransportEnd, createHostTransport } from './hostTransport.js';
import type { HostMemorySampling } from './budget.js';
import type { MemorySampler, MemorySamplerSurface } from './memorySamplerSurface.js';

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
  /** The host's memory sampler, started once its process exists. `createMemorySamplerSurface()`. */
  readonly sampler: MemorySamplerSurface;
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
  /** How many calls may be outstanding, sent or waiting their turn. Required, as the client's is. */
  readonly maxInFlight: number;
  /**
   * The document a call is for, asked as it is made — `DocumentService.executingDocument`. What an ending is counted
   * against ({@link HostEnding.during}). Required, as the client's is.
   */
  readonly owner: () => DocId | undefined;
  /** The job's `ProcessMemoryLimit`. `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES`. */
  readonly processMemoryLimitBytes: number;
  /**
   * How the host's memory is watched below that limit (ADR-0023 §3, corrected 2026-10-03): the sampler kills it at
   * `processMemoryLimitBytes` less `headroomBytes`, sampling every `intervalMs`. Required, as the limit is.
   */
  readonly memorySampling: HostMemorySampling;
  /** The correlation id source, injected so a test can make it deterministic. */
  readonly correlate: () => string;
  /**
   * How this host's file-routed answers are fetched (ADR-0125) — absent for a host whose channels all answer in the
   * frame, which is the compose host's.
   */
  readonly fileAnswers?: ClientFileAnswers;
  /** Each call's deadline, past which the connection is ended and the host killed. Required, as the client's is. */
  readonly deadline: HostCallDeadline;
  /**
   * The connection ended. Called **once**, and only for a connection that
   * started.
   *
   * Must not throw, for the reason every sink in this shell must not: it runs
   * while a failure is already in progress, and a throwing sink replaces a
   * diagnosable failure with an undiagnosable one.
   *
   * It is called **after** everything has been freed, so a caller may rebuild
   * inside it without racing this module's teardown. It receives why the connection ended and the document whose
   * call the host was running then.
   */
  readonly onEnded: (ending: HostEnding) => void;
}

/** Why a connection was not created. Every one of these leaves nothing running. */
export interface EngineHostConnectionFailure {
  /**
   * `connect` is the stage a host that was created and never arrived fails at.
   *
   * It exists because the alternative is worse than a missing vocabulary word:
   * without it, a host that never connects is handed back as a live client and
   * surfaces later as `connection-lost`, which `engineSessions` counts as a
   * **death** — and two deaths poison the document under ADR-0023 Decision 9a.
   * A startup failure would take the recovery path built for a crash, and the
   * user's document would pay for it (finding YYYY-1).
   */
  readonly stage: 'pipe' | 'reader' | 'host' | 'connect';
  readonly detail: string;
  /** Where the host process ended before it connected, its exit code — {@link ENGINE_UNLOADABLE_EXIT} when its engine could not load. */
  readonly exitCode?: number;
}

/**
 * A host that ended before it connected because its engine could not load on this computer (`couldNotStart`). Not a
 * crash and not the document: a second attempt builds the same host and meets the same loader.
 */
export class EngineCannotStartError extends Error {
  readonly component: NativeComponentId;

  constructor(component: NativeComponentId, detail: string) {
    super(`${component} could not start on this computer: ${detail}`);
    this.name = 'EngineCannotStartError';
    this.component = component;
  }
}

/**
 * The error a host refused at connect is thrown as — the ONE reading of a refusal, for all three hosts (B3a). A
 * could-not-start refusal is told to the person through `told`, which says it once per component.
 */
export function refusedAtConnect(
  host: string,
  component: NativeComponentId,
  failure: EngineHostConnectionFailure,
  told: (component: NativeComponentId) => void,
): Error {
  if (failure.exitCode !== undefined && couldNotStart(failure.exitCode)) {
    told(component);
    return new EngineCannotStartError(component, failure.detail);
  }
  return new Error(`the ${host} was refused at ${failure.stage}: ${failure.detail}`);
}

/**
 * How long the host is given to connect to the pipe.
 *
 * **Measured rather than picked.** `scripts/perf/roleMupdfHost.mjs --host`
 * reports the interval from asking for a connection to this factory resolving,
 * on every run. Read 2026-08-28 on this machine across ten runs: **698ms to
 * 1370ms** — the pinned Electron binary in Node mode, started into an
 * AppContainer, resolving the kernel's module graph before it opens the pipe.
 *
 * The range is stated rather than a median, because the range is what a bound
 * has to clear. The first three readings taken were 739.8, 697.9 and 705.9ms
 * and would have supported *"about 700ms"*; the spread is twice that, and a
 * ceiling argued from the tight end is one that fires on an ordinary slow
 * moment.
 *
 * Ten seconds is roughly seven times the slowest observed, and the order of
 * magnitude is the point: this bound is not a tuning knob for a slow machine,
 * it is the line past which *the host is not coming*. `hostFixedCost.mjs`
 * independently chose the same figure for the same event before this existed.
 *
 * **Read again 2026-10-16, inside the running application, and the margin is
 * smaller there.** `scripts/research/hostStartWalk.mjs`, 27 starts on this
 * machine (idle, both processors held busy, and 0.7 GB of memory free): the
 * MuPDF host's own line put its runtime ready at 60–560 ms, its modules
 * evaluated at 0.9–2.9 s and its engine bound 20–80 ms later, while `main`'s
 * event loop was never held longer than 165 ms. Its module graph is 571 files;
 * outside the application (`roleMupdfHost.mjs --host`) the same host connects
 * in about 1.1 s. So the slowest in-application start is about a third of the
 * bound, not a seventh. Twice on 2026-10-16 a host missed it in a walk, in two
 * attempts each, and no condition tried here reproduced it; the refusal now
 * says how far the host got, what processor time it used, and when the bound
 * was checked, so the next one names its own cause.
 *
 * The figure is reported by an instrument rather than recorded once here,
 * because a bound justified by a number nobody re-reads is exactly what B6 is
 * about: on the day a host takes four seconds, the run that shows it is one
 * command rather than an argument.
 *
 * A bound is required rather than optional. Without one, a host that dies
 * before `ConnectNamedPipe` completes — and whose reader therefore reports
 * nothing — leaves this awaiting a message that will never arrive, and a
 * document open hangs with no failure anywhere.
 */
export const HOST_CONNECT_TIMEOUT_MS = 10_000;

/** Either the peer arrived, or it did not and this is why. */
type PeerOutcome = { readonly connected: true } | { readonly connected: false; readonly detail: string };

/**
 * Waits for the peer, the reader's ending, or the bound — whichever is first.
 *
 * Three outcomes collapsed into two on purpose: every non-connection is a
 * creation failure and the caller does the same thing with each, so what
 * differs is the diagnostic and not the control flow.
 *
 * A discriminated pair rather than `'connected' | string`, which is a union
 * TypeScript widens straight back to `string` — so the sentinel would have been
 * checkable only by comparing text, and a refusal whose detail happened to read
 * `connected` would have been a success. Caught by lint
 * (`no-redundant-type-constituents`), which is the rule earning its place.
 *
 * The ending is watched as well as the timeout because they are not the same
 * event and only one of them is worth ten seconds: a reader that has already
 * ended tells us immediately that no peer is coming, and waiting out the bound
 * for it would turn a fast, certain failure into a slow one.
 */
function connected(
  channel: EngineReaderChannel,
  waiting: { end: HostTermination | null; whenEnded: (() => void) | null },
): Promise<PeerOutcome> {
  return new Promise((settle) => {
    // WHEN THE WAIT BEGAN, so the refusal says when the bound was actually checked. A timer runs on this process's
    // event loop: if `main` itself was busy, it fires late, and it is handled before a connection the reader reported
    // meanwhile, so a host that arrived in time reads as one that did not. A check long after the bound names that.
    const began = Date.now();
    const timer = setTimeout(() => {
      settle({
        connected: false,
        detail:
          `no connection within ${String(HOST_CONNECT_TIMEOUT_MS)}ms (checked ${String(Date.now() - began)} ms after the ` +
          `wait began). The process was created, so this is a host that started and did not reach its pipe`,
      });
    }, HOST_CONNECT_TIMEOUT_MS);
    // UNREF'D, so a waiting connection cannot be the reason a process stays
    // alive. The wait is bounded by an event we expect within a second; holding
    // the event loop open for ten seconds on every host creation would make an
    // ordinary exit wait for a timer nobody is interested in.
    timer.unref();

    const done = (answer: PeerOutcome): void => {
      clearTimeout(timer);
      waiting.whenEnded = null;
      settle(answer);
    };

    channel.onConnected(() => {
      done({ connected: true });
    });

    /** Whichever ending arrives — one that already has, or one that arrives while waiting. */
    const died = (): void => {
      const reason = waiting.end;
      done({
        connected: false,
        detail: `the reader ended before any peer connected: ${reason === null ? 'no reason recorded' : reason.detail}`,
      });
    };

    // BOTH DIRECTIONS, because they are different moments and only one of them
    // is a poll. A reader that failed while the host was being created has
    // already set `end`; one that fails during the wait has not, and reading the
    // field once would leave that case to the ten-second timeout — turning a
    // fast, certain failure into a slow one, and reporting it as *did not
    // arrive* rather than *died*.
    waiting.whenEnded = died;
    if (waiting.end !== null) died();
  });
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
  /**
   * Ends the connection BECAUSE the shell refused this host (not contained, no area): `onEnded` fires with `refused` and
   * `detail`, which is filed as a refusal rather than as a close the shell chose (GGGGGGGG-4). Idempotent, as `close`.
   */
  readonly refuse: (detail: string) => void;
  /** Whether the connection has ended, for whatever reason. */
  readonly ended: () => boolean;
}

/**
 * @param surfaces The adapters. See {@link EngineHostConnectionSurfaces}.
 * @param options See {@link EngineHostConnectionOptions}.
 * @returns The connection, or the stage that refused and why.
 */
export async function createEngineHostConnection(
  surfaces: EngineHostConnectionSurfaces,
  options: EngineHostConnectionOptions,
): Promise<Result<EngineHostConnection, EngineHostConnectionFailure>> {
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
    /**
     * Set only while {@link connected} is waiting, so an ending that arrives
     * mid-wait is delivered rather than waited out. Cleared by the waiter on
     * every path, including the one where the peer arrived.
     */
    whenEnded: (() => void) | null;
    /** The host's memory sampler, from the moment its process exists. */
    sampler: MemorySampler | null;
    /**
     * An ending THIS module raised — the sampler could not watch the host — recorded before the transport is
     * terminated, because a termination this side asks for otherwise reads as a deliberate close.
     */
    raised: HostTermination | null;
    /** The exit code of a host that ended before it connected, as the sampler read it. */
    exitCode: number | null;
    /** The processor time the host had used when its handles were freed: what {@link ranSoFar} answers after that. */
    ran: ProcessorTime | null;
  } = { client: null, host: null, started: false, end: null, whenEnded: null, sampler: null, raised: null, exitCode: null, ran: null };

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
    const raised = state.client?.termination() ?? state.raised;
    if (raised !== null) return raised;
    // THE SAMPLER'S KILL, read before the ending is named a lost connection: the worker sets its flag before it
    // terminates the host, and this ending arrives only once the host is gone, so a kill is never missed here.
    if (state.sampler?.killed() === true) {
      return {
        code: 'memory-budget',
        detail:
          `the host's private commit reached ${String(options.processMemoryLimitBytes - options.memorySampling.headroomBytes)} ` +
          'bytes, the budget less its headroom, and the memory sampler killed it',
      };
    }
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

    // THE PIPE OUTLIVES THE READER: it is closed when the reader has ended, never before (`dispose`).
    channel.dispose(closePipe);
    state.host?.free();

    // BEFORE the `started` gate, because a connection still being waited on has
    // not started and its waiter is the only thing that will report this.
    state.whenEnded?.();

    // ONLY for a connection that started. A host that never came up reports its
    // failure through the returned `Result`, and calling this as well would
    // report one failure twice — as a refusal and as a death.
    // THE CAUSE IS THE CLIENT'S, read after `fail` above: the call on the wire when it stopped, whichever stopped it,
    // and the last call sent. Whom the ending counts against is the supervisor's to decide (`endingCountsAgainst`).
    if (state.started) {
      options.onEnded({ termination: reason, during: state.client?.during(), last: state.client?.last() });
    }
  };

  const transport = createHostTransport(channel.channel, queue, {
    receive: (chunk) => state.client?.receive(chunk),
    ended,
  });

  const client = createHostClient({
    transport,
    maxInFlight: options.maxInFlight,
    owner: options.owner,
    correlate: options.correlate,
    deadline: options.deadline,
    ...(options.fileAnswers === undefined ? {} : { fileAnswers: options.fileAnswers }),
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

  /**
   * The processor time the host has used, read off its process handle while that is open and kept from the moment it
   * is freed: an ending can free the handles before the connect branch below asks, and a closed handle's value may
   * already name another object.
   */
  const ranSoFar = (): ProcessorTime | null => (state.end === null ? surface.processorTime(host.value.process) : state.ran);

  state.host = {
    pid: host.value.pid,
    free: () => {
      // WHAT IT RAN, before the kill stops the clock and the close takes the handle away: for a host that never
      // connected, whose refusal says it. One that connected is past the only question it answers.
      if (!state.started) state.ran = surface.processorTime(host.value.process);
      // THE SAMPLER FIRST: it holds its own handle to this process, and stopping it before the kill means it never
      // reads a process that is being torn down.
      state.sampler?.stop();
      // TERMINATED BEFORE ANY HANDLE IS CLOSED, which is `engineHostFactory.ts`'s
      // own rule: the job carries `KILL_ON_JOB_CLOSE`, and relying on that makes
      // the kill a side effect of tidying up rather than the thing we asked for.
      surface.terminate(host.value.process);
      surface.close(host.value.process);
      surface.close(host.value.job);
      // AFTER THE HANDLES, so the host cannot be writing to it. Anything worth
      // reading has already been read by the connect branch below, and the
      // startup sweep is what covers a main that never reaches this line.
      surface.discardDiagnostics();
    },
  };

  // THE MEMORY SAMPLER, the moment the process exists (ADR-0023 §3, corrected 2026-10-03). A host it cannot watch is
  // ended rather than left with only the backstop, by the same one teardown path, and with its own name.
  const raise = (reason: HostTermination): void => {
    state.raised ??= reason;
    transport.terminate(reason);
  };
  const sampler = surfaces.sampler.start(
    host.value.pid,
    options.processMemoryLimitBytes - options.memorySampling.headroomBytes,
    options.memorySampling.intervalMs,
  );
  if (sampler === null) {
    raise({ code: 'sampler-failed', detail: 'the memory sampler thread could not be started' });
    return err({ stage: 'host', detail: 'sampler: the memory sampler thread could not be started' });
  }
  state.sampler = sampler;
  sampler.onMessage((message) => {
    if (message.kind === 'failed') raise({ code: 'sampler-failed', detail: message.detail });
    // A HOST THAT ENDED BEFORE IT CONNECTED is told here or nowhere: the reader is blocked on a pipe nobody will open,
    // so without this the connect bound runs out for a process that is already gone. After it connected, the pipe
    // reports the ending and this adds nothing.
    if (message.kind === 'exited' && !state.started) {
      state.exitCode = message.code;
      raise({ code: 'connection-lost', detail: `the host process ended before it connected, exit code 0x${message.code.toString(16)}` });
    }
  });

  // THE PEER, BEFORE THE CLIENT. Everything above built something; this waits
  // for the other end to exist. See {@link HOST_CONNECT_TIMEOUT_MS} for the
  // bound and {@link createEngineHostConnection} for why a client handed out
  // before this point is a defect rather than an optimisation.
  const peer = await connected(channel, state);
  if (!peer.connected) {
    // THE HOST'S OWN FIRST LINE, where there is one. Every diagnostic this
    // branch could compose is about main's side of a pipe that nobody arrived
    // on, and the answer is normally something the child printed before it
    // died — a runtime it could not read, a module it could not resolve.
    //
    // Appended rather than substituted: `peer.detail` separates "the reader
    // ended" from "the bound expired", which the host's output cannot say.
    const said = surface.diagnostics();
    // AND HOW MUCH OF THAT TIME IT RAN: a host that used most of the bound in processor time was computing, and one
    // that used little of it was waiting.
    const used = ranSoFar();
    const ran =
      used === null
        ? ''
        : `. It had used ${String(Math.round(used.userMs))} ms of processor time in its own code and ` +
          `${String(Math.round(used.kernelMs))} ms in the system`;
    // `started` is still false, so this reports itself once — here, as a
    // creation failure with a stage — and not a second time through `onEnded`
    // as a death. That distinction is the whole finding: a host that never
    // connects is not a host that crashed, and `engineSessions` poisons a
    // document at two crashes.
    const detail = `${peer.detail}${ran}${said === null ? '' : `. The host said: ${said}`}`;
    transport.terminate({ code: 'shutdown', detail: `the host never connected: ${detail}` });
    return err(state.exitCode === null ? { stage: 'connect', detail } : { stage: 'connect', detail, exitCode: state.exitCode });
  }

  state.started = true;

  return ok({
    client,
    pid: host.value.pid,
    close: () => {
      if (state.end !== null) return;
      transport.terminate({ code: 'shutdown', detail: 'the shell closed this connection' });
    },
    refuse: (detail) => {
      if (state.end !== null) return;
      // RAISED BEFORE THE ENDING, because the transport says only that we ended it: `reasonFor` reads this first, so the
      // ending is named a refusal and not the `shutdown` every other ending of ours is.
      const refusal: HostTermination = { code: 'refused', detail };
      state.raised ??= refusal;
      transport.terminate(refusal);
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
