import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  HOST_CORRELATION_ID_MAX_CHARS,
  channel,
  encodeFrame,
} from '@monstera/contract';
import { type Result, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type HostTermination, createHostRuntime } from './runtime.js';

/**
 * The loop's own fixture channels, not the application's.
 *
 * A test against `channels` would go red the day a real channel is added or its
 * schema changes — coupling this file to a registry it is not about. What it IS
 * about is the join between framing and dispatch, and that needs two channels:
 * one that succeeds and one that reports a declared failure, so "a failure
 * crossed" is distinguishable from "nothing crossed".
 */
const fixture = {
  'fixture.echo': channel(
    'echoes its text back',
    z.object({ text: z.string() }),
    z.object({ text: z.string() }),
  ),
  'fixture.refuse': channel('always reports a declared failure', z.object({}), z.object({}), [
    'declined',
  ]),
  'fixture.big': channel(
    'returns a result whose size the caller picks',
    z.object({ size: z.number() }),
    z.object({ blob: z.string() }),
  ),
} as const;

const handlers = {
  'fixture.echo': ({ text }: { text: string }) => Promise.resolve(ok({ text })),
  'fixture.refuse': () => Promise.resolve(err({ code: 'declined' as const })),
  'fixture.big': ({ size }: { size: number }) => Promise.resolve(ok({ blob: 'x'.repeat(size) })),
};

const encoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface Harness {
  readonly runtime: ReturnType<typeof createHostRuntime>;
  /** Frames the loop wrote, decoded back into objects. */
  readonly written: () => readonly { id: string; body: unknown }[];
  readonly terminations: () => readonly HostTermination[];
  /** Frames a request and feeds it in, in one chunk. */
  readonly send: (request: unknown) => void;
  readonly sendBytes: (payload: Uint8Array) => void;
}

function harness(options: { maxFrameBytes?: number; maxInFlight?: number } = {}): Harness {
  const frames: Uint8Array[] = [];
  const terminations: HostTermination[] = [];
  const maxFrameBytes = options.maxFrameBytes ?? ENGINE_HOST_FRAME_MAX_BYTES;

  const runtime = createHostRuntime({
    channels: fixture,
    handlers: handlers,
    incidents: () => undefined,
    maxFrameBytes,
    maxInFlight: options.maxInFlight ?? 8,
    transport: {
      write: (frame) => frames.push(frame),
      terminate: (reason) => terminations.push(reason),
    },
  });

  const written = (): readonly { id: string; body: unknown }[] =>
    frames.map((frame) => {
      // Strip the four-byte header the loop wrote, and read what is under it.
      const body = frame.subarray(4);
      return JSON.parse(textDecoder.decode(body)) as { id: string; body: unknown };
    });

  return {
    runtime,
    written,
    terminations: () => terminations,
    send: (request) => {
      runtime.receive(encodeFrame(encoder.encode(JSON.stringify(request)), maxFrameBytes));
    },
    sendBytes: (payload) => {
      runtime.receive(encodeFrame(payload, maxFrameBytes));
    },
  };
}

/** Lets every already-resolved handler promise settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the host runtime loop', () => {
  it('dispatches a framed request and frames the answer back', async () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.echo', params: { text: 'hello' } });
    await settle();

    expect(h.terminations()).toStrictEqual([]);
    expect(h.written()).toStrictEqual([{ id: 'c1', body: { ok: true, value: { text: 'hello' } } }]);
  });

  it('carries a DECLARED failure as a result, not as a violation', async () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.refuse', params: {} });
    await settle();

    // The whole point of the distinction: a channel saying no is an answer, and
    // the connection survives it. Only a protocol violation is terminal.
    expect(h.terminations()).toStrictEqual([]);
    expect(h.written()).toStrictEqual([{ id: 'c1', body: { ok: false, error: { code: 'declined' } } }]);
  });

  it('validates params through the channel schema, not through a second parse', async () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.echo', params: { text: 42 } });
    await settle();

    // `wrapHandler` turns invalid params into an INTERNAL failure with an
    // incident id, main-side. That is the existing discipline doing the work —
    // this loop added no opinion about what a channel accepts.
    expect(h.terminations()).toStrictEqual([]);
    const [response] = h.written();
    expect(response?.id).toBe('c1');
    expect(response?.body).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('reassembles a request split across chunks, and answers once', async () => {
    const h = harness();
    const framed = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'c1', channel: 'fixture.echo', params: { text: 'ab' } })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    for (const byte of framed) h.runtime.receive(Uint8Array.of(byte));
    await settle();

    expect(h.written()).toHaveLength(1);
    expect(h.terminations()).toStrictEqual([]);
  });

  it('answers several requests arriving in ONE chunk', async () => {
    const h = harness();
    const one = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'a', channel: 'fixture.echo', params: { text: '1' } })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const two = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'b', channel: 'fixture.echo', params: { text: '2' } })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const both = new Uint8Array(one.byteLength + two.byteLength);
    both.set(one);
    both.set(two, one.byteLength);
    h.runtime.receive(both);
    await settle();

    expect(h.written().map((entry) => entry.id)).toStrictEqual(['a', 'b']);
  });
});

describe('every protocol violation is terminal', () => {
  it('a frame violation stops the loop and carries the codec\'s own reason', () => {
    const h = harness({ maxFrameBytes: 64 });
    // Declared length above the maximum, refused on the header.
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 1000, false);
    h.runtime.receive(header);

    expect(h.terminations()).toHaveLength(1);
    expect(h.terminations()[0]?.code).toBe('frame');
    expect(h.terminations()[0]?.detail).toContain('frame-too-large');
  });

  it('a frame that is not UTF-8 JSON stops the loop', () => {
    const h = harness();
    h.sendBytes(Uint8Array.of(0xff, 0xfe, 0xfd));

    expect(h.terminations()[0]?.code).toBe('not-utf8-json');
  });

  it('a frame that is JSON but not a request stops the loop', () => {
    const h = harness();
    h.send({ id: 'c1', params: {} });

    expect(h.terminations()[0]?.code).toBe('malformed-request');
  });

  it('an extra field on the request stops the loop, because the schema is strict', () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.echo', params: { text: 'a' }, extra: true });

    expect(h.terminations()[0]?.code).toBe('malformed-request');
  });

  it('an over-long correlation id stops the loop', () => {
    const h = harness();
    h.send({
      id: 'x'.repeat(HOST_CORRELATION_ID_MAX_CHARS + 1),
      channel: 'fixture.echo',
      params: { text: 'a' },
    });

    // An id is echoed, so an unbounded one is the peer choosing how many bytes
    // of our response it writes.
    expect(h.terminations()[0]?.code).toBe('malformed-request');
  });

  it('an unknown channel stops the loop rather than being answered', () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.absent', params: {} });

    expect(h.terminations()[0]?.code).toBe('unknown-channel');
    expect(h.written()).toStrictEqual([]);
  });

  it('a repeated correlation id stops the loop', async () => {
    const h = harness();
    h.send({ id: 'same', channel: 'fixture.echo', params: { text: 'a' } });
    h.send({ id: 'same', channel: 'fixture.echo', params: { text: 'b' } });

    // Sent before the first has settled, so the id is genuinely in flight.
    expect(h.terminations()[0]?.code).toBe('duplicate-id');
    await settle();
  });

  it('CONTROL: and the same id REUSED after its answer is not a violation', async () => {
    const h = harness();
    h.send({ id: 'same', channel: 'fixture.echo', params: { text: 'a' } });
    await settle();
    h.send({ id: 'same', channel: 'fixture.echo', params: { text: 'b' } });
    await settle();

    // Without this, "a repeated id is refused" is satisfied by a loop that
    // never forgets an id — which leaks a set for the life of the connection
    // and refuses a peer doing nothing wrong.
    expect(h.terminations()).toStrictEqual([]);
    expect(h.written()).toHaveLength(2);
  });

  it('more calls in flight than the cap stops the loop', () => {
    const h = harness({ maxInFlight: 2 });
    h.send({ id: 'a', channel: 'fixture.echo', params: { text: '1' } });
    h.send({ id: 'b', channel: 'fixture.echo', params: { text: '2' } });
    h.send({ id: 'c', channel: 'fixture.echo', params: { text: '3' } });

    expect(h.terminations()[0]?.code).toBe('too-many-in-flight');
  });

  it('a response too large to frame is reported as OUR defect, not the peer\'s', async () => {
    const h = harness({ maxFrameBytes: 512 });
    h.send({ id: 'c1', channel: 'fixture.big', params: { size: 4096 } });
    await settle();

    // The code is what matters: a reader following "the peer violated the
    // protocol" would go and read the peer, and the bug is a channel whose
    // declared result can exceed the frame maximum.
    expect(h.terminations()[0]?.code).toBe('unsendable-response');
    expect(h.written()).toStrictEqual([]);
  });

  it('refuses a maxInFlight that is not a positive integer', () => {
    expect(() => harness({ maxInFlight: 0 })).toThrow(RangeError);
    expect(() => harness({ maxInFlight: 1.5 })).toThrow(RangeError);
  });
});

describe('after termination the loop is over', () => {
  it('drops later chunks, and terminates exactly once', () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.absent', params: {} });
    h.send({ id: 'c2', channel: 'fixture.echo', params: { text: 'a' } });
    h.send({ id: 'c3', channel: 'fixture.echo', params: { text: 'b' } });

    expect(h.terminations()).toHaveLength(1);
    expect(h.written()).toStrictEqual([]);
    expect(h.runtime.termination()?.code).toBe('unknown-channel');
  });

  it('does not answer a request that was already in flight when it stopped', async () => {
    const h = harness();
    h.send({ id: 'live', channel: 'fixture.echo', params: { text: 'a' } });
    // Same chunk would be simpler, but this is the real ordering: a call is
    // dispatched, and the violation arrives while its handler is still pending.
    h.send({ id: 'bad', channel: 'fixture.absent', params: {} });
    await settle();

    expect(h.terminations()[0]?.code).toBe('unknown-channel');
    expect(h.written()).toStrictEqual([]);
    // Stated rather than hidden: the handler still RAN. This loop cannot cancel
    // a promise it did not create, and the property it does have is that the
    // answer never reaches the pipe.
    expect(h.runtime.inFlight()).toBe(0);
  });

  /**
   * TERMINATION IS IDEMPOTENT, and nothing proved it until the stage audit
   * (finding NNN-2).
   *
   * Every other caller of `stop` is behind an `isStopped()` check — `receive`,
   * the frame loop, `answer`. The handler REJECTION path is not, so the guard
   * inside `stop` is the only thing standing between a late rejection and a
   * second `transport.terminate`. Deleting that guard reddened no case.
   *
   * What it costs is worse than a double call. `state.stopped` would be
   * overwritten, so a peer's protocol violation would be reported as
   * `unsendable-response` — this build blaming itself for the peer's frame, and
   * sending whoever reads the log to the wrong side of the pipe, which is the
   * exact confusion that code names a separate termination code to avoid.
   *
   * Reaching the rejection path needs the WRAPPER to throw, not the handler:
   * `wrapHandler` catches a handler's throw and turns it into an incident. So
   * the handler throws AND the incident sink throws, which is where `record`
   * runs — outside the wrapper's try.
   */
  const rejectingRuntime = (): {
    runtime: ReturnType<typeof createHostRuntime>;
    terminations: HostTermination[];
  } => {
    const terminations: HostTermination[] = [];
    const runtime = createHostRuntime({
      channels: fixture,
      handlers: {
        ...handlers,
        'fixture.echo': () => {
          throw new Error('the handler failed');
        },
      },
      incidents: () => {
        throw new Error('and recording that failure failed too');
      },
      maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      maxInFlight: 4,
      transport: { write: () => undefined, terminate: (reason) => terminations.push(reason) },
    });
    return { runtime, terminations };
  };

  const frameOf = (request: unknown): Uint8Array =>
    encodeFrame(encoder.encode(JSON.stringify(request)), ENGINE_HOST_FRAME_MAX_BYTES);

  it('CONTROL: a rejecting wrapper does terminate, so the path below is live', async () => {
    const { runtime, terminations } = rejectingRuntime();
    runtime.receive(frameOf({ id: 'c1', channel: 'fixture.echo', params: { text: 'a' } }));
    await settle();

    // Without this, the case below passes on a build where the wrapper never
    // rejects at all — one termination, and the second one never attempted.
    expect(terminations).toHaveLength(1);
    expect(terminations[0]?.code).toBe('unsendable-response');
  });

  it('keeps the FIRST reason when a late rejection tries to terminate again', async () => {
    const { runtime, terminations } = rejectingRuntime();
    runtime.receive(frameOf({ id: 'c1', channel: 'fixture.echo', params: { text: 'a' } }));
    // Synchronous, so the violation lands while that handler is still pending.
    runtime.receive(frameOf({ id: 'c2', channel: 'fixture.absent', params: {} }));
    await settle();

    expect(terminations).toHaveLength(1);
    expect(terminations[0]?.code).toBe('unknown-channel');
    expect(runtime.termination()?.code).toBe('unknown-channel');
  });

  /**
   * The assertion is that the second frame's HANDLER never ran.
   *
   * The first version asserted one termination and no output, and it separated
   * nothing: a loop that finishes the chunk still calls `stop` (guarded, so
   * still one termination) and still refuses to write (guarded, so still no
   * output). Measured — with the in-chunk check deleted, all twenty-two cases
   * passed. Item 4's other half: never build a fixture the defect also handles
   * correctly.
   *
   * What differs between the two loops is only observable inside the handler,
   * so that is where the observation goes.
   */
  it('does not even DISPATCH the frames after a violation in the same chunk', () => {
    const reached: string[] = [];
    const frames: Uint8Array[] = [];
    const terminations: HostTermination[] = [];
    const runtime = createHostRuntime({
      channels: fixture,
      handlers: {
        ...handlers,
        'fixture.echo': ({ text }: { text: string }) => {
          reached.push(text);
          return Promise.resolve(ok({ text }));
        },
      },
      incidents: () => undefined,
      maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      maxInFlight: 4,
      transport: {
        write: (frame) => frames.push(frame),
        terminate: (reason) => terminations.push(reason),
      },
    });

    const bad = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'a', channel: 'fixture.absent', params: {} })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const good = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'b', channel: 'fixture.echo', params: { text: 'after' } })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const both = new Uint8Array(bad.byteLength + good.byteLength);
    both.set(bad);
    both.set(good, bad.byteLength);
    runtime.receive(both);

    expect(reached).toStrictEqual([]);
    expect(terminations).toHaveLength(1);
    expect(frames).toStrictEqual([]);
  });

  it('CONTROL: and the same second frame IS dispatched when the first is fine', () => {
    const reached: string[] = [];
    const runtime = createHostRuntime({
      channels: fixture,
      handlers: {
        ...handlers,
        'fixture.echo': ({ text }: { text: string }) => {
          reached.push(text);
          return Promise.resolve(ok({ text }));
        },
      },
      incidents: () => undefined,
      maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      maxInFlight: 4,
      transport: { write: () => undefined, terminate: () => undefined },
    });

    const first = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'a', channel: 'fixture.refuse', params: {} })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const second = encodeFrame(
      encoder.encode(JSON.stringify({ id: 'b', channel: 'fixture.echo', params: { text: 'after' } })),
      ENGINE_HOST_FRAME_MAX_BYTES,
    );
    const both = new Uint8Array(first.byteLength + second.byteLength);
    both.set(first);
    both.set(second, first.byteLength);
    runtime.receive(both);

    // Without this, "the second frame was not dispatched" is satisfied by a
    // loop that never reads past the first frame in a chunk at all.
    expect(reached).toStrictEqual(['after']);
  });
});

describe('CONTROL: the fixture is not satisfied by a loop that does nothing', () => {
  it('an untouched loop has no termination and no output', () => {
    const h = harness();
    expect(h.runtime.termination()).toBeNull();
    expect(h.written()).toStrictEqual([]);
    expect(h.runtime.inFlight()).toBe(0);
  });

  it('and a well-formed request produces exactly one framed answer with a header', async () => {
    const h = harness();
    h.send({ id: 'c1', channel: 'fixture.echo', params: { text: 'hello' } });
    await settle();

    // Asserted on the BYTES, because every other case here reads the decoded
    // object and would pass against a loop that wrote an unframed payload.
    const frames: Uint8Array[] = [];
    const check = createHostRuntime({
      channels: fixture,
      handlers: handlers,
      incidents: () => undefined,
      maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      maxInFlight: 4,
      transport: { write: (frame) => frames.push(frame), terminate: () => undefined },
    });
    check.receive(
      encodeFrame(
        encoder.encode(JSON.stringify({ id: 'c1', channel: 'fixture.echo', params: { text: 'x' } })),
        ENGINE_HOST_FRAME_MAX_BYTES,
      ),
    );
    await settle();

    expect(frames).toHaveLength(1);
    const [frame] = frames;
    expect(frame).toBeDefined();
    if (frame === undefined) return;
    const declared = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(
      0,
      false,
    );
    expect(declared).toBe(frame.byteLength - 4);
  });
});

describe('a handler that never settles', () => {
  it('is counted as in flight, and does not block the ones after it', async () => {
    const frames: Uint8Array[] = [];
    let release: ((value: Result<{ text: string }, never>) => void) | undefined;
    const slow = {
      ...handlers,
      'fixture.echo': () =>
        new Promise<Result<{ text: string }, never>>((resolve) => {
          release = resolve;
        }),
    };
    const runtime = createHostRuntime({
      channels: fixture,
      handlers: slow,
      incidents: () => undefined,
      maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
      maxInFlight: 4,
      transport: { write: (frame) => frames.push(frame), terminate: () => undefined },
    });

    runtime.receive(
      encodeFrame(
        encoder.encode(JSON.stringify({ id: 'slow', channel: 'fixture.echo', params: { text: 'a' } })),
        ENGINE_HOST_FRAME_MAX_BYTES,
      ),
    );
    runtime.receive(
      encodeFrame(
        encoder.encode(JSON.stringify({ id: 'also', channel: 'fixture.refuse', params: {} })),
        ENGINE_HOST_FRAME_MAX_BYTES,
      ),
    );
    await settle();

    // The second call answered while the first is still pending. A loop that
    // served requests one at a time would have written nothing.
    expect(frames).toHaveLength(1);
    expect(runtime.inFlight()).toBe(1);

    release?.(ok({ text: 'a' }));
    await settle();
    expect(frames).toHaveLength(2);
    expect(runtime.inFlight()).toBe(0);
  });
});
