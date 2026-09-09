import { describe, expect, it } from 'vitest';

import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  FRAME_HEADER_BYTES,
  encodeFrame,
} from '@monstera/contract';

import type { ByteImage } from '../engineSeam.js';
import { TOKEN_BYTES } from '../token.js';
import type { HostArea } from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { pdfiumChannels } from './pdfiumChannels.js';
import { createPdfiumHandlers } from './pdfiumHandlers.js';

/**
 * The **PDFium** host's program, driven without a pipe, a container or a
 * library.
 *
 * ## What this asserts that `hostBody.test.ts` cannot
 *
 * That file drives the same body with MuPDF's channels and handlers, so
 * everything about framing, termination and session identity is already
 * covered. What is new here is the **byte-image protocol**, and it is a
 * different protocol rather than the same one with different names:
 *
 * - a write NAMES its input and its output file and answers a **count**, where
 *   a live-session write names neither and answers nothing;
 * - `engine/open` registers an area and keeps **no parse**;
 * - `engine/serialise` does not exist, because a host holding nothing has
 *   nothing to hand back (ADR-0048's correction of 2026-09-09).
 *
 * Every engine dependency below throws or is a stub with no PDFium in it, for
 * `hostBody.test.ts`'s reason: `packages/kernel` is the host body, and deciding
 * whether these handlers are correct must not need a native library. What the
 * library actually does is `proof:pdfiumcommand`'s subject.
 */

/** A stream whose two directions are both inspectable. `hostBody.test.ts`'s stub. */
function stubStream(): HostByteStream & {
  readonly sent: Uint8Array[];
  readonly feed: (bytes: Uint8Array) => void;
  readonly whenSent: (count: number, within?: number) => Promise<void>;
} {
  const sent: Uint8Array[] = [];
  const whenSent = (count: number, within = 2000): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (sent.length >= count) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() - started > within) {
          clearInterval(poll);
          // A REJECTION, never a resolve-anyway: a body that answers nothing
          // and one that answers late are the same observation to a fixed
          // number of drains, and the reassuring answer for "it replied" is a
          // reply — so the not-yet outcome has to be the loud one.
          reject(
            new Error(
              `the PDFium host body wrote ${String(sent.length)} frame(s) in ` +
                `${String(within)}ms, expected ${String(count)}`,
            ),
          );
        }
      }, 5);
    });
  let data: (chunk: Uint8Array) => void = () => {
    throw new Error('bytes arrived before the body registered a sink');
  };

  return {
    sent,
    whenSent,
    write: (bytes) => sent.push(bytes),
    onData: (sink) => {
      data = sink;
    },
    onEnd: () => undefined,
    close: () => undefined,
    feed: (bytes) => {
      data(bytes);
    },
  };
}

/** What a stubbed filesystem holds, so a case can inspect what the host wrote. */
interface Files {
  readonly read: Map<string, Uint8Array>;
  readonly written: Map<string, Uint8Array>;
}

const AREA = { snapshotDirectory: 'C:\\snap', outputDirectory: 'C:\\out' };

/**
 * File names, in the shape the host's own schema demands.
 *
 * `outputNameSchema` is `/^[0-9a-f-]+$/`, because `sessionDirectoryName` mints
 * these and main is the only thing that names one. Readable words were the
 * first spelling here and every call after `engine/open` came back `internal`
 * — which is the boundary refusing a malformed message, correctly, and is why
 * the incident sink below records rather than discards: an `internal` withholds
 * its diagnostic by design, so a case reading only the wire cannot tell a
 * handler that threw from a message that never reached one.
 */
const IN = 'deadbeef';
const OUT = 'cafe-01';

/**
 * @param files what `readSnapshot` will find, and where `writeOutput` records.
 * @param applied what the stubbed execution's `apply` answers.
 */
function start(files: Files, applied: ByteImage = new Uint8Array([9, 9, 9])) {
  const calls: string[] = [];
  const handlers = createPdfiumHandlers({
    areas: createHostSessions<HostArea>(() => new Uint8Array(TOKEN_BYTES).fill(7)),
    execution: {
      apply: (image) => {
        // THE IMAGE THIS HANDLER READ, recorded so a case can assert the
        // handler passed the file's bytes rather than something else. A case
        // asserting only that `apply` ran would pass on a handler that read the
        // wrong file.
        calls.push(`apply:${[...image].join(',')}`);
        // A SINGLE BYTE 0 IS A DOCUMENT THIS ENGINE CANNOT READ. The stub
        // refuses it the way the real execution does — by throwing out of a
        // parse — so the `engine-refused` case exercises the handler's catch
        // rather than a branch written for the test.
        if (image.length === 1) throw new Error('PDFium refused the document');
        return Promise.resolve(applied);
      },
      capture: (image) => {
        calls.push(`capture:${[...image].join(',')}`);
        if (image.length === 1) throw new Error('PDFium refused the document');
        return Promise.resolve({
          captured: true,
          prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] },
        } as never);
      },
      invert: (image) => {
        calls.push(`invert:${[...image].join(',')}`);
        return Promise.resolve(applied);
      },
    },
    files: {
      readSnapshot: (directory, name) => {
        const found = files.read.get(`${directory}|${name}`);
        if (found === undefined) return Promise.reject(new Error('no such file'));
        return Promise.resolve(found);
      },
      writeOutput: (directory, name, bytes) => {
        files.written.set(`${directory}|${name}`, bytes);
        return Promise.resolve(bytes.length);
      },
    },
    probe: () =>
      Promise.resolve({
        positive: { kind: 'read', bytes: 64 },
        negative: { kind: 'refused', code: 'EACCES' },
        loopback: { kind: 'refused', code: 'ETIMEDOUT' },
      }),
    textRuns: (image, page) => {
      calls.push(`text-runs:${String(page)}:${[...image].join(',')}`);
      return Promise.resolve({
        runs: [
          { index: 1, text: 'ONE', bottom: 229.9, top: 238.0 },
          { index: 3, text: 'TWO', bottom: 189.9, top: 198.0 },
        ],
        truncated: false,
      });
    },
  });

  const body = startEngineHost(
    stubStreamOf(),
    {
      channels: pdfiumChannels,
      handlers,
      // RECORDED, not discarded. An `internal` answer withholds its diagnostic
      // by design, so a case that only reads the wire cannot say why a handler
      // threw — and *the handler threw* is exactly the failure these cases are
      // most likely to produce while being written.
      incidents: (incident) => {
        calls.push(`incident:${incident.channel}:${JSON.stringify(incident.diagnostic)}`);
      },
      maxInFlight: 4,
    },
    () => undefined,
  );
  return { body, calls };
}

/** The one stream every `start` in this file shares, so a case can feed it. */
let stream = stubStream();
function stubStreamOf(): HostByteStream {
  return stream;
}

/** The response inside one frame, with the header stripped by the contract's constant. */
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

/** Registers the area and returns the id the host minted. */
async function openArea(files: Files): Promise<{ session: string; calls: string[] }> {
  const { calls } = start(files);
  stream.feed(
    request('o1', 'engine/open', {
      snapshotDirectory: AREA.snapshotDirectory,
      outputDirectory: AREA.outputDirectory,
    }),
  );
  await stream.whenSent(1);
  const opened = answerIn(stream.sent[0]) as { body: { ok: boolean; value: { session: string } } };
  expect(opened.body.ok, JSON.stringify(opened)).toBe(true);
  return { session: opened.body.value.session, calls };
}

function emptyFiles(): Files {
  return { read: new Map(), written: new Map() };
}

describe('the PDFium host body', () => {
  it('opens by registering an AREA, touching no file and parsing nothing', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session, calls } = await openArea(files);

    expect(session.length).toBeGreaterThan(0);
    // NOTHING RAN (ADR-0048's withdrawn Decision 3). The area is a transfer
    // buffer whose lifetime is the host's, and at this moment there is no
    // document — so an open that read or parsed anything would be doing work
    // for a document that has not been named.
    //
    // Asserted as an EMPTY call list rather than as *no parse call*, because
    // the second is satisfied by a handler that reads the file and throws the
    // bytes away.
    expect(calls).toStrictEqual([]);
    expect(files.read.size, 'the fixture holds no file, so a reading open would have failed').toBe(
      0,
    );
  });

  it('refuses a document the engine cannot read at the call that needed it, not at open', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session } = await openArea(files);
    // A FILE THAT EXISTS AND DOES NOT PARSE, which is the distinction this case
    // is about: a missing file answers `asset-missing` and is a different
    // outcome with a different owner. Using one here would pass against a host
    // that never reached the engine at all.
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([0]));

    stream.feed(
      request('a1', 'engine/apply', {
        session,
        command: {
          kind: 'replaceTextObject',
          page: 0,
          replacements: [{ index: 2, text: 'hi' }],
          version: 1,
        },
        from: IN,
        into: OUT,
      }),
    );
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: false, error: { code: 'engine-refused' } },
    });
    // AND NOTHING WAS WRITTEN. A half-written output under a name main is about
    // to read is the state the write-outside-the-try ordering exists to
    // prevent, and asserting the code alone would pass without it.
    expect(files.written.size).toBe(0);
  });

  it('applies from the named file and writes the result into the granted directory', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([4, 5]));

    stream.feed(
      request('a1', 'engine/apply', {
        session,
        command: {
          kind: 'replaceTextObject',
          page: 0,
          replacements: [{ index: 2, text: 'hi' }],
          version: 1,
        },
        from: IN,
        into: OUT,
      }),
    );
    await stream.whenSent(2);

    // A COUNT, which is `engine/serialise`'s own answer — this handler is that
    // channel's job and this engine's apply in one call.
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { bytes: 3 } } });
    // AND THE BYTES LANDED IN THE GRANTED DIRECTORY, under the name main chose.
    // Asserting the count alone would pass on a handler that wrote nowhere.
    expect(files.written.get(`${AREA.outputDirectory}|${OUT}`)).toStrictEqual(
      new Uint8Array([9, 9, 9]),
    );
    // AND THE EXECUTION SAW THE FILE'S BYTES, not the ones the open read. A
    // handler that passed the opening image would produce the same count and
    // the same file, and every assertion above would still hold.
    expect(calls).toStrictEqual(['apply:4,5']);
    expect(calls.filter((entry) => entry.startsWith('incident:'))).toStrictEqual([]);
  });

  it('refuses an apply whose input file is gone, as asset-missing rather than internal', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session } = await openArea(files);

    stream.feed(
      request('a1', 'engine/apply', {
        session,
        command: {
          kind: 'replaceTextObject',
          page: 0,
          replacements: [{ index: 2, text: 'hi' }],
          version: 1,
        },
        // A WELL-FORMED NAME NOTHING WROTE. It has to satisfy the schema, or
        // the refusal under test would be the boundary's rather than the
        // handler's — the two produce different codes and only one of them is
        // this case's subject.
        from: 'fadedface',
        into: OUT,
      }),
    );
    await stream.whenSent(2);

    // OURS RATHER THAN THE DOCUMENT'S, and a declared code rather than a throw:
    // an `internal` would reach the supervisor as evidence of a sick host, and
    // main writing the image and losing it is a defect on our side of the pipe.
    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: false, error: { code: 'asset-missing' } },
    });
    expect(files.written.size, 'nothing may be written when the input was never read').toBe(0);
  });

  it('captures prior state from the named file and writes nothing', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    // TWO BYTES, because the stubbed execution refuses a one-byte image as a
    // document it cannot parse. A fixture the engine would refuse is a fixture
    // this case's own subject cannot be observed through.
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([6, 6]));

    stream.feed(
      request('c1', 'engine/capture', {
        session,
        command: {
          kind: 'replaceTextObject',
          page: 0,
          replacements: [{ index: 2, text: 'hi' }],
          version: 1,
        },
        from: IN,
      }),
    );
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: {
        ok: true,
        value: {
          captured: true,
          value: {
            kind: 'replaceTextObject',
            prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] },
          },
        },
      },
    });
    // A CAPTURE PRODUCES NO BYTES, which is why its params carry no `into`.
    // Asserting the answer alone would pass on a handler that also wrote.
    expect(files.written.size).toBe(0);
    expect(calls).toStrictEqual(['capture:6,6']);
  });

  it('answers the page’s text runs, from the named file', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([7]));

    stream.feed(request('t1', 'engine/text-runs', { session, from: IN, page: 3 }));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: {
        ok: true,
        // THE TEXT AND THE EXTENT CROSS, not merely the indices. The wire
        // carried numbers alone until 2026-09-09, and a `toMatchObject` on the
        // index would pass against a host that had dropped both — which is
        // exactly the answer the line grouping and the chooser need.
        value: {
          runs: [
            { index: 1, text: 'ONE', bottom: 229.9, top: 238.0 },
            { index: 3, text: 'TWO', bottom: 189.9, top: 198.0 },
          ],
          truncated: false,
        },
      },
    });
    // THE PAGE REACHED THE READER. Without this the case passes on a handler
    // that hard-codes a page, and the answer would be right for page 0 for ever.
    expect(calls).toStrictEqual(['text-runs:3:7']);
  });

  it('has NO engine/serialise, because a host holding nothing has nothing to hand back', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session } = await openArea(files);

    // A CHANNEL NOTHING DECLARES IS TERMINAL, which is the body's rule — so
    // this asserts the ABSENCE through the protocol rather than by reading the
    // map's keys, which `coreChannels.test.ts` already does. The two are
    // different claims: one is about what the object holds and this is about
    // what the running host refuses.
    stream.feed(request('s1', 'engine/serialise', { session, into: OUT }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(files.written.size).toBe(0);
  });

  it('forgets an area on close, and a later call through it is refused', async () => {
    stream = stubStream();
    const files = emptyFiles();
    const { session } = await openArea(files);

    stream.feed(request('x1', 'engine/close', { session }));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true } });

    stream.feed(request('t1', 'engine/text-runs', { session, from: IN, page: 0 }));
    await stream.whenSent(3);
    // ORDINARY, NOT TERMINAL: a rebuilt host holds none of the previous one's
    // areas, so an id it does not hold is an outcome the supervisor answers
    // rather than an opaque `internal`.
    expect(answerIn(stream.sent[2])).toMatchObject({
      body: { ok: false, error: { code: 'no-such-session' } },
    });
  });
});
