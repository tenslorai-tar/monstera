import type { ReaderMessage, ReaderWorkerData } from '@monstera/nodemode';
import { describe, expect, it } from 'vitest';

import {
  type ReaderHostSurface,
  type ReaderWorkerHandle,
  createEngineReaderChannel,
} from './engineReaderChannel.js';
import type { PipeHandle } from './enginePipeFactory.js';
import type { StopEvent } from './win32PipeSurface.js';

const PIPE: PipeHandle = { __handle: 'pipe' };
const READ_BYTES = 4096;

/**
 * A recording surface and worker.
 *
 * ONE call list across both, as the factories beside this do, because the
 * properties here are about ORDER — the stop event before the worker, the event
 * closed when the worker refuses — and per-member spies would let each of those
 * pass against a factory that did them backwards.
 */
interface Recorder extends ReaderHostSurface {
  readonly calls: string[];
  /** The `workerData` the surface was asked to start a thread with. */
  readonly started: ReaderWorkerData[];
  /** Pretends the reader posted something. */
  readonly post: (message: ReaderMessage) => void;
  /** Pretends the thread threw. */
  readonly throwFrom: (message: string) => void;
  /** Pretends the thread ended. */
  readonly exit: (code: number) => void;
}

function surface(options: { noEvent?: boolean; noWorker?: boolean } = {}): Recorder {
  const calls: string[] = [];
  const started: ReaderWorkerData[] = [];
  let messageSink: ((message: ReaderMessage) => void) | null = null;
  let errorSink: ((error: Error) => void) | null = null;
  let exitSink: ((code: number) => void) | null = null;

  const worker: ReaderWorkerHandle = {
    onMessage: (sink) => {
      messageSink = sink;
    },
    onError: (sink) => {
      errorSink = sink;
    },
    onExit: (sink) => {
      exitSink = sink;
    },
    terminate: () => calls.push('terminate'),
  };

  return {
    calls,
    started,
    createStopEvent: () => {
      calls.push('createStopEvent');
      const event: StopEvent = { __handle: 'stop-event' };
      return options.noEvent === true ? null : event;
    },
    signal: () => {
      calls.push('signal');
      return true;
    },
    closeEvent: () => calls.push('closeEvent'),
    addressOf: (handle) => (handle === PIPE ? '111' : '222'),
    startWorker: (data) => {
      calls.push('startWorker');
      if (options.noWorker === true) return null;
      started.push(data);
      return worker;
    },
    lastError: () => 6,
    post: (message) => messageSink?.(message),
    throwFrom: (message) => errorSink?.(new Error(message)),
    exit: (code) => exitSink?.(code),
  };
}

function sinks() {
  const chunks: string[] = [];
  const endings: string[] = [];
  return {
    chunks,
    endings,
    receive: (chunk: Uint8Array) => chunks.push(new TextDecoder().decode(chunk)),
    ended: (detail: string) => endings.push(detail),
  };
}

describe('createEngineReaderChannel', () => {
  it('creates the stop event BEFORE starting the worker, and hands it both addresses', () => {
    const host = surface();

    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);

    expect(made.ok).toBe(true);
    // The order is the property: a reader started without a stop address is a
    // reader nothing can stop, and the only remedy left is killing the thread.
    expect(host.calls).toEqual(['createStopEvent', 'startWorker']);
    expect(host.started[0]).toEqual({ pipeAddress: '111', stopAddress: '222', readBytes: READ_BYTES });
  });

  it('refuses when the stop event cannot be created, and starts nothing', () => {
    const host = surface({ noEvent: true });

    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);

    expect(made.ok).toBe(false);
    expect(!made.ok && made.error).toContain('stop event');
    // NOT STARTED. A worker begun with a null stop address would run and be
    // unstoppable, which is worse than not running.
    expect(host.calls).toEqual(['createStopEvent']);
  });

  it('closes the stop event when the worker cannot be started', () => {
    const host = surface({ noWorker: true });

    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);

    expect(made.ok).toBe(false);
    // A refusal that leaked a handle would cost something every time it was
    // taken, on the path least likely to be exercised.
    expect(host.calls).toEqual(['createStopEvent', 'startWorker', 'closeEvent']);
  });

  it('forwards chunks and the ending the reader posts', () => {
    const host = surface();
    const out = sinks();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);
    made.value.channel.onChunk(out.receive);
    made.value.channel.onEnded(out.ended);

    host.post({ kind: 'chunk', bytes: new TextEncoder().encode('one') });
    host.post({ kind: 'ended', detail: 'stopped while waiting for bytes' });

    expect(out.chunks).toEqual(['one']);
    expect(out.endings).toEqual(['stopped while waiting for bytes']);
    expect(made.value.finished()).toBe(true);
  });

  it('drops chunks that arrive after the ending', () => {
    const host = surface();
    const out = sinks();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);
    made.value.channel.onChunk(out.receive);
    made.value.channel.onEnded(out.ended);

    host.post({ kind: 'ended', detail: 'stopped' });
    // IN FLIGHT WHEN IT STOPPED. The layer above drops these too; dropping them
    // here as well is what stops the two layers disagreeing about whether a
    // chunk arrived after the end.
    host.post({ kind: 'chunk', bytes: new TextEncoder().encode('too late') });

    expect(out.chunks).toEqual([]);
  });

  it('reports an exit with nothing said before it as the ending', () => {
    const host = surface();
    const out = sinks();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);
    made.value.channel.onEnded(out.ended);

    host.exit(1);

    // A reader that vanished without a word is a dead host, and silence is
    // exactly what a missing case here would produce.
    expect(out.endings).toHaveLength(1);
    expect(out.endings[0]).toContain('exited with code 1');
  });

  it('keeps the FIRST cause when a throw is followed by an exit', () => {
    const host = surface();
    const out = sinks();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);
    made.value.channel.onEnded(out.ended);

    host.throwFrom('koffi could not bind');
    host.exit(1);

    // A thread that threw produces an error AND an exit. Forwarding both makes
    // one ending look like two, and the later one is the less informative.
    expect(out.endings).toEqual(['the reader thread threw: koffi could not bind']);
  });

  it('signals the stop event once, however many times stop is called', () => {
    const host = surface();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);

    made.value.channel.stop();
    made.value.channel.stop();

    // VACUITY GUARD as much as a property: a channel that signalled nothing
    // would satisfy "signals once" by doing it never.
    expect(host.calls.filter((call) => call === 'signal')).toEqual(['signal']);
  });

  it('does NOT terminate the thread on stop — the stop event is the mechanism', () => {
    const host = surface();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);

    made.value.channel.stop();

    // A terminate here would mask a reader that could not be stopped, which is
    // the failure the two-handle wait exists to make impossible. Measured at
    // 15ms for the real reader; a kill would have looked identical.
    expect(host.calls).not.toContain('terminate');
  });

  it('disposes a running reader by terminating it and closing the event', () => {
    const host = surface();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);

    made.value.dispose();
    made.value.dispose();

    expect(host.calls.filter((call) => call === 'terminate')).toEqual(['terminate']);
    expect(host.calls.filter((call) => call === 'closeEvent')).toEqual(['closeEvent']);
  });

  it('CONTROL: disposing after the reader ended closes the event and terminates NOTHING', () => {
    const host = surface();
    const made = createEngineReaderChannel(host, PIPE, READ_BYTES);
    if (!made.ok) throw new Error(made.error);

    host.post({ kind: 'ended', detail: 'stopped' });
    made.value.dispose();

    // Without this, "dispose terminates" is satisfied by a dispose that
    // terminates unconditionally — and a terminate on an ended thread is the
    // call that lets somebody later conclude the terminate is what stops it.
    expect(host.calls).not.toContain('terminate');
    expect(host.calls).toContain('closeEvent');
  });

  it('refuses a read size that is not a whole number of bytes', () => {
    const host = surface();

    expect(createEngineReaderChannel(host, PIPE, 0).ok).toBe(false);
    expect(createEngineReaderChannel(host, PIPE, 1.5).ok).toBe(false);
    // AND THE CONTROL: 1 is legal, so the guard is not simply refusing.
    expect(createEngineReaderChannel(host, PIPE, 1).ok).toBe(true);
  });
});
