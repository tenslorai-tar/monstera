import { ENGINE_HOST_FRAME_MAX_BYTES, encodeFrame } from '@monstera/contract';
import { type HostTermination } from '@monstera/kernel';
import { type ReaderMessage } from '@monstera/nodemode';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  type ContainerSid,
  type PipeHandle,
  type SecurityDescriptor,
  type UserSid,
} from './enginePipeFactory.js';
import { type EngineHostConnectionSurfaces, createEngineHostConnection } from './engineHostConnection.js';
import { type ReaderWorkerHandle } from './engineReaderChannel.js';
import { type CreatedProcess, type JobHandle, type ProcessHandle, type ThreadHandle } from './engineHostFactory.js';
import { type PendingWrite } from './hostWriteQueue.js';
import { type StopEvent } from './win32PipeSurface.js';

const USER: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const CONTAINER: ContainerSid = { __sid: 'container', value: 'S-1-15-2-1-2-3' };
const PIPE_NAME = String.raw`\\.\pipe\monstera-test`;

const DESCRIPTOR: SecurityDescriptor = { __handle: 'security-descriptor' };
const INSTANCE: PipeHandle = { __handle: 'pipe' };
const STOP_EVENT: StopEvent = { __handle: 'stop-event' };
const PROCESS: ProcessHandle = { __handle: 'process' };
const THREAD: ThreadHandle = { __handle: 'thread' };
const JOB: JobHandle = { __handle: 'job' };
const CREATED: CreatedProcess = { pid: 4242, process: PROCESS, thread: THREAD };

/**
 * ONE call list across every surface, which is the point rather than a
 * convenience.
 *
 * Every property this file asserts is about ORDER or about how many times
 * something happened — the host created after the reader, the process
 * terminated before its handles close, one host surface built and not two —
 * and per-surface spies would let a composition that did them backwards pass
 * each of them individually.
 */
interface Harness {
  readonly calls: string[];
  readonly surfaces: EngineHostConnectionSurfaces;
  readonly endings: HostTermination[];
  /** Posts a reader message, as the worker thread would. */
  readonly post: (message: ReaderMessage) => void;
  /** Ends the reader thread, as an exit would. */
  readonly exit: (code: number) => void;
}

function harness(
  failures: { pipe?: boolean; stopEvent?: boolean; worker?: boolean; host?: boolean } = {},
): Harness {
  const calls: string[] = [];
  const endings: HostTermination[] = [];
  const sinks: {
    message: ((message: ReaderMessage) => void)[];
    exit: ((code: number) => void)[];
  } = { message: [], exit: [] };

  const worker: ReaderWorkerHandle = {
    onMessage: (sink) => sinks.message.push(sink),
    onError: () => undefined,
    onExit: (sink) => sinks.exit.push(sink),
    terminate: () => calls.push('worker.terminate'),
  };

  const surfaces: EngineHostConnectionSurfaces = {
    pipes: {
      describe: () => {
        calls.push('pipe.describe');
        return DESCRIPTOR;
      },
      createInstance: () => {
        calls.push('pipe.createInstance');
        return failures.pipe === true ? null : INSTANCE;
      },
      freeDescriptor: () => calls.push('pipe.freeDescriptor'),
      close: () => calls.push('pipe.close'),
      lastError: () => 5,
    },
    reader: {
      createStopEvent: () => {
        calls.push('reader.createStopEvent');
        return failures.stopEvent === true ? null : STOP_EVENT;
      },
      signal: () => {
        calls.push('reader.signal');
        return true;
      },
      closeEvent: () => calls.push('reader.closeEvent'),
      addressOf: () => '1234',
      startWorker: () => {
        calls.push('reader.startWorker');
        return failures.worker === true ? null : worker;
      },
      lastError: () => 6,
    },
    writesFor: () => {
      calls.push('writes.for');
      return {
        issue: (): PendingWrite | null => null,
        collect: () => 'completed' as const,
        release: () => undefined,
        abandon: () => calls.push('writes.abandon'),
        lastError: () => 7,
      };
    },
    hostFor: () => {
      calls.push('host.surfaceBuilt');
      return {
        createSuspended: () => {
          calls.push('host.createSuspended');
          return ok(CREATED);
        },
        createJob: () => {
          calls.push('host.createJob');
          return failures.host === true ? null : JOB;
        },
        applyLimits: () => true,
        assignToJob: () => true,
        readJobMembership: () => 'in-job' as const,
        resume: () => 1,
        terminate: () => calls.push('host.terminate'),
        close: (handle) => calls.push(`host.close:${handle.__handle}`),
      };
    },
  };

  return {
    calls,
    surfaces,
    endings,
    post: (message) => {
      for (const sink of sinks.message) sink(message);
    },
    exit: (code) => {
      for (const sink of sinks.exit) sink(code);
    },
  };
}

/**
 * Asserts one call happened before another, and that BOTH happened.
 *
 * The presence half is the whole reason this exists. `indexOf` answers `-1` for
 * a call that never ran, and `-1 < n` is true — so every order assertion in
 * this file would pass for a composition that skipped the earlier step
 * entirely, which is the failure they exist to catch. An absent lookup
 * returning the reassuring answer is item 4b arriving inside a comparison.
 */
function expectOrder(calls: readonly string[], before: string, after: string): void {
  expect(calls).toContain(before);
  expect(calls).toContain(after);
  expect(calls.indexOf(before)).toBeLessThan(calls.indexOf(after));
}

function connect(h: Harness) {
  return createEngineHostConnection(h.surfaces, {
    pipeName: PIPE_NAME,
    user: USER,
    container: CONTAINER,
    readBytes: 8192,
    maxOutstandingWrites: 8,
    maxInFlight: 8,
    processMemoryLimitBytes: 3_221_225_472,
    correlate: () => 'id-1',
    onEnded: (reason) => {
      h.calls.push(`onEnded:${reason.code}`);
      h.endings.push(reason);
    },
  });
}

describe('createEngineHostConnection', () => {
  it('creates the HOST LAST, after the reader is already waiting', () => {
    const h = harness();
    const connection = connect(h);

    expect(connection.ok).toBe(true);
    // The reader issues `ConnectNamedPipe`; a server instance nobody has
    // connected cannot be read. Asserted as an ORDER rather than as presence,
    // because a composition that starts the process first still calls both.
    expectOrder(h.calls, 'reader.startWorker', 'host.createSuspended');
    expectOrder(h.calls, 'pipe.createInstance', 'reader.startWorker');
  });

  it('builds the host surface EXACTLY ONCE, so the kill runs through the adapter that created it', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    // Two would be two opinions about the same handles (B3a), and the second
    // would be the one holding the terminate. This case exists because the
    // first draft of the composition called `hostFor` twice.
    expect(h.calls.filter((call) => call === 'host.surfaceBuilt')).toHaveLength(1);
  });

  it('refuses at the PIPE without starting a reader or a process', () => {
    const h = harness({ pipe: true });
    const connection = connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('pipe');
    expect(h.calls).not.toContain('reader.startWorker');
    expect(h.calls).not.toContain('host.createSuspended');
    expect(h.calls).not.toContain('onEnded:shutdown');
  });

  it('refuses at the READER, closing the pipe and creating no process', () => {
    const h = harness({ worker: true });
    const connection = connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('reader');
    expect(h.calls).toContain('pipe.close');
    expect(h.calls).not.toContain('host.createSuspended');
  });

  /**
   * The double-report property, and the fixture is chosen so the bug cannot
   * satisfy it.
   *
   * A composition that reported the failure BOTH ways — as a refusal and as a
   * death — would still close the pipe, so asserting teardown alone separates
   * nothing. The load-bearing assertion is that `onEnded` was never called
   * while the teardown ran anyway.
   */
  it('refuses at the HOST, tearing down but NOT reporting an ending', () => {
    const h = harness({ host: true });
    const connection = connect(h);

    expect(connection.ok).toBe(false);
    if (connection.ok) return;
    expect(connection.error.stage).toBe('host');
    expect(h.calls).toContain('pipe.close');
    expect(h.calls).toContain('reader.closeEvent');
    expect(h.endings).toEqual([]);
  });

  it('maps a reader that went away to CONNECTION-LOST, not to a framing violation', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);

    // DDDD-15's payoff. Before `connection-lost` existed the only values here
    // were violations, and a host that simply died would have been reported as
    // one — sending its reader to the framing code.
    expect(h.endings.map((reason) => reason.code)).toEqual(['connection-lost']);
    expect(connection.value.ended()).toBe(true);
  });

  it('maps a deliberate close to SHUTDOWN, and reports it rather than staying silent', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    expect(h.endings.map((reason) => reason.code)).toEqual(['shutdown']);
  });

  it('KEEPS a violation the client raised rather than relabelling it as a shutdown', async () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    // An answer for an id nobody sent. The client terminates the transport, so
    // `TransportEnd.by` reads `us` — the same value a deliberate close produces,
    // which is the ambiguity this mapping exists to resolve.
    // A WELL-FORMED response for an id nobody sent, and the shape matters: a
    // malformed one is refused before the correlation is ever looked up, so the
    // case would pass on `malformed-response` and prove a different thing than
    // its name claims. Measured — that is what the first version of this
    // fixture did.
    h.post({ kind: 'chunk', bytes: framed({ id: 'never-sent', body: {} }) });

    expect(h.endings.map((reason) => reason.code)).toEqual(['unknown-correlation']);
    await expect(connection.value.client.invoke('any', {})).rejects.toThrow(/unknown-correlation/u);
  });

  it('TERMINATES the process before closing either handle', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    connection.value.close();

    // `engineHostFactory.ts`'s own rule: the job carries `KILL_ON_JOB_CLOSE`, so
    // closing it would kill the host as a side effect of tidying up — which
    // stops being true in exactly the case where something else went wrong.
    expectOrder(h.calls, 'host.terminate', 'host.close:process');
    expectOrder(h.calls, 'host.terminate', 'host.close:job');
  });

  it('reports the ending AFTER everything is freed, so a caller may rebuild inside it', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);

    for (const freed of ['reader.closeEvent', 'host.terminate', 'pipe.close']) {
      expectOrder(h.calls, freed, 'onEnded:connection-lost');
    }
  });

  it('is IDEMPOTENT on close, and a close after a death frees nothing twice', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    h.exit(1);
    connection.value.close();
    connection.value.close();

    expect(h.endings).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'pipe.close')).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'host.terminate')).toHaveLength(1);
  });

  it('SETTLES a waiting call when the host dies, rather than leaving it pending', async () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    const call = connection.value.client.invoke('any', {});
    h.exit(1);

    // The failure that costs most is the quiet one: the host dies, nothing
    // rejects, and a caller waits for ever holding whatever it was going to do.
    await expect(call).rejects.toThrow(/connection-lost/u);
  });

  it('carries the host PID, which nothing addresses the host by', () => {
    const h = harness();
    const connection = connect(h);
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    expect(connection.value.pid).toBe(4242);
  });
});

/**
 * One framed response, as the host would put it on the pipe.
 *
 * Through `encodeFrame` rather than by writing a length prefix here. A second
 * hand-rolled framing in a test is a second opinion about what a frame is
 * (B3a), and it agrees with the real one right up until the moment the framing
 * changes — at which point this file would pass while the product could not
 * talk to itself.
 */
function framed(response: unknown): Uint8Array {
  return encodeFrame(
    new TextEncoder().encode(JSON.stringify(response)),
    ENGINE_HOST_FRAME_MAX_BYTES,
  );
}
