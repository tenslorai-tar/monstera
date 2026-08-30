import { describe, expect, it } from 'vitest';

import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  FRAME_HEADER_BYTES,
  encodeFrame,
} from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import { TOKEN_BYTES } from '../token.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import type { HostTermination } from './runtime.js';

/**
 * The engine host's program, driven without a pipe, a container or a document.
 *
 * Everything here is a property the real process makes **harder** to observe,
 * not easier: a violation arriving mid-stream, main disappearing, and the two
 * of them racing. `hostEntry.ts` is what a case cannot reach, and it is two
 * statements for exactly that reason.
 */

/** A stream whose two directions are both inspectable, and which records closes. */
function stubStream(): HostByteStream & {
  readonly sent: Uint8Array[];
  readonly closes: () => number;
  readonly feed: (bytes: Uint8Array) => void;
  readonly vanish: (detail: string) => void;
  readonly whenSent: (count: number, within?: number) => Promise<void>;
} {
  const sent: Uint8Array[] = [];
  let closed = 0;
  /** Resolves when the body has written `count` frames, or REJECTS. */
  const whenSent = (count: number, within = 2000): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (sent.length >= count) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() - started > within) {
          clearInterval(poll);
          // A REJECTION, never a resolve-anyway. A body that answers nothing
          // and a body that answers late are the same observation to a fixed
          // number of microtask drains, which is what this replaces — and the
          // reassuring answer for a case asserting "it replied" is a reply, so
          // the not-yet outcome is the one that has to be loud.
          reject(
            new Error(
              `the host body wrote ${String(sent.length)} frame(s) in ${String(within)}ms, ` +
                `expected ${String(count)}`,
            ),
          );
        }
      }, 5);
    });
  let data: (chunk: Uint8Array) => void = () => {
    throw new Error('bytes arrived before the body registered a sink');
  };
  let end: (detail: string) => void = () => {
    throw new Error('the stream ended before the body registered a sink');
  };

  return {
    sent,
    whenSent,
    closes: () => closed,
    write: (bytes) => sent.push(bytes),
    onData: (sink) => {
      data = sink;
    },
    onEnd: (sink) => {
      end = sink;
    },
    close: () => {
      closed += 1;
    },
    feed: (bytes) => {
      data(bytes);
    },
    vanish: (detail) => {
      end(detail);
    },
  };
}

function start(stream: HostByteStream) {
  const endings: HostTermination[] = [];
  const body = startEngineHost(
    stream,
    {
      execution: localMupdfExecution,
      // Every engine dependency throws. No case here opens a document, so a
      // body that reached for one fails loudly instead of passing against a
      // surface that happened to work.
      writer: {
        open: () => {
          throw new Error('no case here opens a document');
        },
        serialise: () => {
          throw new Error('no case here serialises');
        },
        close: () => {
          throw new Error('no case here closes');
        },
      },
      files: {
        readSnapshot: () => {
          throw new Error('no case here reads a snapshot');
        },
        writeOutput: () => {
          throw new Error('no case here writes output');
        },
      },
      probe: () =>
        Promise.resolve({
          positive: { kind: 'read', bytes: 64 },
          negative: { kind: 'refused', code: 'EACCES' },
        }),
      geometry: () => {
        throw new Error('no case here reads a page tree');
      },
      tokens: () => new Uint8Array(TOKEN_BYTES).fill(7),
      incidents: () => undefined,
      maxInFlight: 4,
    },
    (reason) => endings.push(reason),
  );
  return { body, endings };
}

/**
 * The response inside one frame.
 *
 * The header is stripped with the contract's own constant rather than a `4`
 * written here: a literal would be this file's second opinion about the framing,
 * and it would keep agreeing right up until the header changed.
 */
function answerIn(frame: Uint8Array | undefined): unknown {
  if (frame === undefined) throw new Error('no frame was written');
  return JSON.parse(new TextDecoder().decode(frame.subarray(FRAME_HEADER_BYTES)));
}

/** One request, framed exactly as main frames it. */
function request(id: string, channel: string, params: unknown): Uint8Array {
  return encodeFrame(
    new TextEncoder().encode(JSON.stringify({ id, channel, params })),
    ENGINE_HOST_FRAME_MAX_BYTES,
  );
}

describe('the engine host body', () => {
  it('serves a containment probe over the framed protocol', async () => {
    const stream = stubStream();
    const { body } = start(stream);

    stream.feed(
      request('c1', 'engine/probe-containment', {
        positive: 'C:\\install\\koffi.node',
        negative: 'C:\\elsewhere\\secret.txt',
      }),
    );
    await stream.whenSent(1);

    expect(body.termination()).toBeNull();
    // The ANSWER, not just a frame: the probe's report crosses back exactly as
    // the surface reported it, with no verdict added on this side.
    expect(answerIn(stream.sent[0])).toMatchObject({
      id: 'c1',
      body: {
        ok: true,
        value: {
          positive: { kind: 'read', bytes: 64 },
          negative: { kind: 'refused', code: 'EACCES' },
        },
      },
    });
  });

  it('ends with connection-lost when main goes away, and closes the stream once', () => {
    const stream = stubStream();
    const { endings } = start(stream);

    stream.vanish('the pipe reported EOF');

    expect(endings).toEqual([
      { code: 'connection-lost', detail: 'the pipe reported EOF' },
    ]);
    expect(stream.closes()).toBe(1);
  });

  it('ends once, keeping the FIRST reason, when a violation is followed by main vanishing', () => {
    const stream = stubStream();
    const { endings } = start(stream);

    // A channel nothing declares is `unknown-channel`, which the loop treats as
    // terminal. Then main goes away, which would otherwise report a second
    // ending — and the case that matters is precisely this one, because the two
    // reasons DIFFER: a violation we raised is not a peer that vanished, and a
    // second report would overwrite the true cause with the consequence.
    stream.feed(request('c1', 'engine/there-is-no-such-channel', {}));
    stream.vanish('the pipe reported EOF');

    expect(endings).toHaveLength(1);
    expect(endings[0]?.code).toBe('unknown-channel');
    expect(stream.closes()).toBe(1);
  });

  it('refuses a session id it did not issue, rather than treating it as absent', async () => {
    const stream = stubStream();
    const { body } = start(stream);

    stream.feed(request('c1', 'engine/close', { session: 'not-an-id-this-host-minted' }));
    await stream.whenSent(1);

    // Answered, not terminated: an id this host does not hold is an ORDINARY
    // outcome — a rebuilt host holds none of the previous one's sessions — and
    // the declared code is what lets the supervisor rebuild instead of reading
    // an opaque `internal`.
    expect(body.termination()).toBeNull();
    expect(answerIn(stream.sent[0])).toMatchObject({
      body: { ok: false, error: { code: 'no-such-session' } },
    });
  });
});
