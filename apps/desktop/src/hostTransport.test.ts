import { describe, expect, it } from 'vitest';

import {
  type ReaderChannel,
  type TransportEnd,
  createHostTransport,
} from './hostTransport.js';

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
    write: (frame) => calls.push(`write(${new TextDecoder().decode(frame)})`),
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
    const transport = createHostTransport(reader, out);

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
    const transport = createHostTransport(reader, out);

    transport.terminate(violation);

    expect(reader.calls).toEqual(['stop']);
    expect(out.endings).toEqual([
      { by: 'us', detail: 'frame: length exceeded the maximum' },
    ]);
  });

  it('drops writes and chunks after terminate', () => {
    const reader = channel();
    const out = sinks();
    const transport = createHostTransport(reader, out);

    transport.terminate(violation);
    transport.write(new TextEncoder().encode('too late'));
    // IN FLIGHT WHEN IT STOPPED. The reader posted these before it was told, so
    // they arrive after — which is the case, not an edge of one. Feeding them to
    // a loop that has been told the connection is gone would let a violated
    // stream's remaining frames be processed.
    reader.deliver('also too late');

    expect(reader.calls).toEqual(['stop']);
    expect(out.received).toEqual([]);
  });

  it('reports the reader going away as the PEER, and does not signal a stop into it', () => {
    const reader = channel();
    const out = sinks();
    createHostTransport(reader, out);

    reader.die('the worker exited with code 1');

    // A dead host and a shutdown produce the same silence on the pipe, and only
    // the first is a defect. One field would have made them one fact.
    expect(out.endings).toEqual([{ by: 'peer', detail: 'the worker exited with code 1' }]);
    // No `stop`: the thread that would receive it is gone.
    expect(reader.calls).toEqual([]);
  });

  it('keeps the FIRST cause when the reader dies and terminate follows', () => {
    const reader = channel();
    const out = sinks();
    const transport = createHostTransport(reader, out);

    reader.die('the pipe broke');
    transport.terminate(violation);

    // THE DIRECTION THAT LOSES A DEFECT is relabelling a dead host as a clean
    // shutdown, so the later call must not overwrite. `terminate` arriving after
    // a peer ending is the ordinary path — the runtime loop reacts to the same
    // event — which is why this is not an edge case.
    expect(out.endings).toEqual([{ by: 'peer', detail: 'the pipe broke' }]);
    expect(reader.calls).toEqual([]);
  });

  it('reports one ending for two terminates', () => {
    const reader = channel();
    const out = sinks();
    const transport = createHostTransport(reader, out);

    transport.terminate(violation);
    transport.terminate({ code: 'duplicate-id', detail: 'seen already' });

    // VACUITY GUARD for the case above as much as a property of its own: a
    // transport that recorded nothing would satisfy "the first cause wins" and
    // fail here.
    expect(out.endings).toHaveLength(1);
    expect(out.endings[0]?.by).toBe('us');
    expect(reader.calls).toEqual(['stop']);
  });
});
