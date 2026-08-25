import { describe, expect, it } from 'vitest';

import {
  type ReaderChannel,
  type TransportEnd,
  createHostTransport,
} from './hostTransport.js';
import type { HostWriteQueue, WriteOutcome } from './hostWriteQueue.js';

/**
 * A recording reader channel.
 *
 * ONE list for every call, as the two factories beside it do, because the
 * properties here are about ORDER and about what happens after an ending.
 * Per-member spies would let "stop is signalled once" pass against a transport
 * that signalled it before recording the ending.
 */
interface Recorder extends ReaderChannel {
  readonly calls: string[];
  /** Pretends the reader produced bytes. */
  readonly deliver: (text: string) => void;
  /** Pretends the reader went away. */
  readonly die: (detail: string) => void;
}

function channel(): Recorder {
  const calls: string[] = [];
  let chunkSink: ((chunk: Uint8Array) => void) | null = null;
  let endedSink: ((detail: string) => void) | null = null;

  return {
    calls,
    stop: () => calls.push('stop'),
    onChunk: (sink) => {
      chunkSink = sink;
    },
    onEnded: (sink) => {
      endedSink = sink;
    },
    deliver: (text) => chunkSink?.(new TextEncoder().encode(text)),
    die: (detail) => endedSink?.(detail),
  };
}

/**
 * A recording write queue, sharing the reader's call list.
 *
 * ONE list across both mechanisms deliberately: the properties this file gained
 * are about what happens to the queue relative to the stop signal, and two lists
 * would let "the queue is closed on every ending" pass against a transport that
 * closed it before recording the ending.
 */
interface Queue extends HostWriteQueue {
  /** Makes the next `write` refuse, as an overrun or a broken pipe would. */
  readonly refuseNext: (reason: 'overrun' | 'refused') => void;
}

function writer(calls: string[]): Queue {
  let refusal: 'overrun' | 'refused' | null = null;
  return {
    write: (frame: Uint8Array): WriteOutcome => {
      calls.push(`write(${new TextDecoder().decode(frame)})`);
      if (refusal === null) return { ok: true };
      const reason = refusal;
      refusal = null;
      return { ok: false, refusal: { reason, detail: 'the peer stopped reading' } };
    },
    close: () => calls.push('close'),
    outstanding: () => 0,
    refuseNext: (reason) => {
      refusal = reason;
    },
  };
}

function sinks() {
  const received: string[] = [];
  const endings: TransportEnd[] = [];
  return {
    received,
    endings,
    receive: (chunk: Uint8Array) => received.push(new TextDecoder().decode(chunk)),
    ended: (end: TransportEnd) => endings.push(end),
  };
}

const violation = { code: 'frame', detail: 'length exceeded the maximum' } as const;

describe('createHostTransport', () => {
  it('carries frames out and chunks in while it is running', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    transport.write(new TextEncoder().encode('one'));
    reader.deliver('two');
    transport.write(new TextEncoder().encode('three'));

    expect(reader.calls).toEqual(['write(one)', 'write(three)']);
    expect(out.received).toEqual(['two']);
    expect(out.endings).toEqual([]);
  });

  it('signals the reader exactly once on terminate, and reports the ending as ours', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    transport.terminate(violation);

    // STOP THEN CLOSE, in that order and both of them. The queue holds pinned
    // buffers whatever ended the transport, so an ending that released them on
    // some paths and not others is the shape the next ending gets wrong.
    expect(reader.calls).toEqual(['stop', 'close']);
    expect(out.endings).toEqual([
      { by: 'us', detail: 'frame: length exceeded the maximum' },
    ]);
  });

  it('drops writes and chunks after terminate', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    transport.terminate(violation);
    transport.write(new TextEncoder().encode('too late'));
    // IN FLIGHT WHEN IT STOPPED. The reader posted these before it was told, so
    // they arrive after — which is the case, not an edge of one. Feeding them to
    // a loop that has been told the connection is gone would let a violated
    // stream's remaining frames be processed.
    reader.deliver('also too late');

    // No `write(too late)`: a frame after an ending never reaches the queue,
    // which is what keeps a closed queue's refusal off the diagnostic path.
    expect(reader.calls).toEqual(['stop', 'close']);
    expect(out.received).toEqual([]);
  });

  it('reports the reader going away as the PEER, and does not signal a stop into it', () => {
    const reader = channel();
    const out = sinks();
    createHostTransport(reader, writer(reader.calls), out);

    reader.die('the worker exited with code 1');

    // A dead host and a shutdown produce the same silence on the pipe, and only
    // the first is a defect. One field would have made them one fact.
    expect(out.endings).toEqual([{ by: 'peer', detail: 'the worker exited with code 1' }]);
    // No `stop`: the thread that would receive it is gone. The queue is still
    // closed, because main's own pinned buffers do not go away with the reader.
    expect(reader.calls).toEqual(['close']);
  });

  it('keeps the FIRST cause when the reader dies and terminate follows', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    reader.die('the pipe broke');
    transport.terminate(violation);

    // THE DIRECTION THAT LOSES A DEFECT is relabelling a dead host as a clean
    // shutdown, so the later call must not overwrite. `terminate` arriving after
    // a peer ending is the ordinary path — the runtime loop reacts to the same
    // event — which is why this is not an edge case.
    expect(out.endings).toEqual([{ by: 'peer', detail: 'the pipe broke' }]);
    expect(reader.calls).toEqual(['close']);
  });

  it('reports one ending for two terminates', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    transport.terminate(violation);
    transport.terminate({ code: 'duplicate-id', detail: 'seen already' });

    // VACUITY GUARD for the case above as much as a property of its own: a
    // transport that recorded nothing would satisfy "the first cause wins" and
    // fail here.
    expect(out.endings).toHaveLength(1);
    expect(out.endings[0]?.by).toBe('us');
    expect(reader.calls).toEqual(['stop', 'close']);
  });

  it('ends on a refused write, as the PEER, and stops a reader that is still alive', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    queue.refuseNext('overrun');
    transport.write(new TextEncoder().encode('one'));

    // `peer`, and this is the case that decides what the field means: main is
    // what noticed, and the host stopping consumption is what caused it. The
    // test that picks the value is "is this a defect to report", not "which side
    // of the pipe saw it" — a shutdown labelled here would be a host that stopped
    // reading, reported as something somebody asked for.
    expect(out.endings).toEqual([
      { by: 'peer', detail: 'write overrun: the peer stopped reading' },
    ]);
    // STOP IS SIGNALLED, unlike the dead-reader ending: the thread is still
    // sitting in its wait, and nothing else will ever tell it.
    expect(reader.calls).toEqual(['write(one)', 'stop', 'close']);
  });

  it('drops later frames after a refused write rather than asking the queue again', () => {
    const reader = channel();
    const out = sinks();
    const queue = writer(reader.calls);
    const transport = createHostTransport(reader, queue, out);

    queue.refuseNext('refused');
    transport.write(new TextEncoder().encode('one'));
    transport.write(new TextEncoder().encode('two'));

    // A second `write(...)` in this list would mean the transport asked a closed
    // queue and turned its answer into a second ending — the queue's own
    // `closed` outcome exists for callers that have not learned yet, and this
    // one has.
    expect(reader.calls).toEqual(['write(one)', 'stop', 'close']);
    expect(out.endings).toHaveLength(1);
  });
});
