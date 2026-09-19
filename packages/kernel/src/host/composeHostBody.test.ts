import { afterEach, describe, expect, it } from 'vitest';

import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  FRAME_HEADER_BYTES,
  MAX_IMPORT_IMAGES,
  MAX_PAGE_COORDINATE,
  encodeFrame,
} from '@monstera/contract';

import { type ComposePageSize, ComposeRefused } from '../composeLayout.js';
import type { ImportImage } from '../imageCompose.js';
import { TOKEN_BYTES } from '../token.js';
import { composeChannels } from './composeChannels.js';
import { type ImageOptimizer, createComposeHandlers } from './composeHandlers.js';
import { ENGINE_SESSION_ID_MAX_CHARS } from './engineChannels.js';
import type { HostArea } from './engineHandlers.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The **compose** host's program, driven without a pipe, a container or a layout
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## What this asserts that the other two host-body files cannot
 *
 * `hostBody.test.ts` and `pdfiumHostBody.test.ts` cover framing, termination and
 * session identity through the same body. What is new here is a host that is **not
 * a writer**: its channel set, and how a composer's answer — a PDF, a named refusal,
 * or a fault — reaches the wire. The composer is a stub; what it lays out is
 * `markdownCompose.test.ts`' subject.
 */

/** A stream whose two directions are both inspectable. `hostBody.test.ts`' stub. */
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
          // A REJECTION, never a resolve-anyway: a body that answers nothing and
          // one that answers late are the same observation to a fixed number of
          // drains, so the not-yet outcome has to be the loud one.
          reject(
            new Error(
              `the compose host body wrote ${String(sent.length)} frame(s) in ` +
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

/** File names in the shape `outputNameSchema` demands, which main mints. */
const IN = 'deadbeef';
const OUT = 'cafe-01';

const LETTER: ComposePageSize = { width: 612, height: 792 };

/** The bytes the stubbed composer answers, which nothing else here produces. */
const COMPOSED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x37]);

/**
 * @param files what `readSnapshot` will find, and where `writeOutput` records.
 * @param compose what the stubbed composer does with a source.
 */
function start(
  files: Files,
  compose: (source: Uint8Array, page: ComposePageSize) => Promise<Uint8Array> = () =>
    Promise.resolve(COMPOSED),
  images: (images: readonly ImportImage[]) => Promise<Uint8Array> = async (listed) => {
    for (const image of listed) await image.read();
    return COMPOSED;
  },
) {
  const calls: string[] = [];
  const handlers = createComposeHandlers({
    // THE AREA'S DIRECTORIES, THE TWO NAMES AND THE SETTING, recorded, so a case can assert the
    // handler handed the rewriter what the request named rather than something else.
    optimize:
      optimizer === null
        ? null
        : (area, from, into, setting) => {
            calls.push(
              `optimize:${area.snapshotDirectory}|${from}->${area.outputDirectory}|${into}:` +
                `${String(setting.quality)}/${String(setting.over)}/${String(setting.to)}`,
            );
            return optimizer === null ? Promise.reject(new Error('unreachable')) : optimizer(area, from, into, setting);
          },
    areas: createHostSessions<HostArea>(() => new Uint8Array(TOKEN_BYTES).fill(7)),
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
    composeMarkdown: (source, page) => {
      // THE SOURCE'S BYTES AND THE PAGE, recorded so a case can assert the handler
      // passed what the named file held rather than something else.
      calls.push(`compose:${[...source].join(',')}:${String(page.width)}x${String(page.height)}`);
      return compose(source, page);
    },
    // ITS OWN PREFIX, so a case can say WHICH composer a channel reached. Both answer
    // the same shape, so the answer alone cannot tell them apart.
    composeCsv: (source, page) => {
      calls.push(`csv:${[...source].join(',')}:${String(page.width)}x${String(page.height)}`);
      return compose(source, page);
    },
    // EACH IMAGE'S DECODER AND THE BYTES ITS READ ANSWERED, recorded as the composer reads
    // them — so a case can assert the handler bound each entry to the file it named.
    composeImages: (listed) =>
      images(
        listed.map((image) => ({
          mediaType: image.mediaType,
          read: async () => {
            const bytes = await image.read();
            calls.push(`image:${image.mediaType}:${[...bytes].join(',')}`);
            return bytes;
          },
        })),
      ),
  });

  startEngineHost(
    stream,
    {
      channels: composeChannels,
      handlers,
      // RECORDED, not discarded: an `internal` answer withholds its diagnostic by
      // design, so a case reading only the wire cannot say why a handler threw.
      incidents: (incident) => {
        calls.push(`incident:${incident.channel}`);
      },
      maxInFlight: 4,
    },
    () => undefined,
  );
  return { calls };
}

/** The one stream every `start` in this file uses, replaced per case. */
let stream = stubStream();

/** The rewriter every `start` binds, set by a case before it opens its area; `null` is none bound. */
let optimizer: ImageOptimizer | null = () => Promise.resolve({ kind: 'optimized', bytes: 1234 });

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

/** Starts a host, registers the area, and returns the id the host minted. */
async function openArea(
  files: Files,
  compose?: (source: Uint8Array, page: ComposePageSize) => Promise<Uint8Array>,
  images?: (images: readonly ImportImage[]) => Promise<Uint8Array>,
): Promise<{ session: string; calls: string[] }> {
  stream = stubStream();
  const { calls } = start(files, compose, images);
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

/** Asks the host to compose `IN` into `OUT` at US Letter. */
function composeRequest(session: string): Uint8Array {
  return request('c1', 'engine/compose-markdown', { session, from: IN, into: OUT, page: LETTER });
}

describe('the compose host channel set', () => {
  it('is the probe, the area and composition — and none of the three command channels', () => {
    // A LITERAL, for `engineHostPrograms.test.ts`' reason: a set derived from the
    // map agrees with any change to the map. A host that gained `engine/apply`
    // would be a process answering a writer's question with nothing behind it.
    expect(Object.keys(composeChannels).sort()).toStrictEqual(
      [
        'engine/close',
        'engine/compose-csv',
        'engine/compose-images',
        'engine/compose-markdown',
        'engine/open',
        'engine/optimize',
        'engine/probe-containment',
      ].sort(),
    );
  });

  it('routes each compose channel to its own composer, and never to the other', async () => {
    // THE DECISION IS WHICH PARSER RAN. Both composers answer `composed` with a count,
    // so a handler that sent CSV to the Markdown composer would pass every case that
    // reads the wire; only the call list can tell.
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([97, 44, 98]));

    stream.feed(request('v1', 'engine/compose-csv', { session, from: IN, into: OUT, page: LETTER }));
    await stream.whenSent(2);
    stream.feed(request('m1', 'engine/compose-markdown', { session, from: IN, into: OUT, page: LETTER }));
    await stream.whenSent(3);

    expect(calls).toStrictEqual(['csv:97,44,98:612x792', 'compose:97,44,98:612x792']);
  });

  it('binds each listed image to the file it names, in order, and answers the composition', async () => {
    // TWO FILES, TWO DECODERS, listed in the opposite order to their names: a handler
    // that read one file for both, or lost the list's order, is visible in the calls.
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([1, 2]));
    files.read.set(`${AREA.snapshotDirectory}|${OUT}`, new Uint8Array([3]));

    stream.feed(
      request('i1', 'engine/compose-images', {
        session,
        images: [
          { from: OUT, mediaType: 'image/jpeg' },
          { from: IN, mediaType: 'image/png' },
        ],
        into: 'abc-02',
      }),
    );
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: true, value: { kind: 'composed', bytes: COMPOSED.length } },
    });
    expect(calls).toStrictEqual(['image:image/jpeg:3', 'image:image/png:1,2']);
    expect(files.written.get(`${AREA.outputDirectory}|abc-02`)).toStrictEqual(COMPOSED);
  });

  it('answers an image refusal WITH ITS POSITION, and a missing image as the transport’s', async () => {
    const refusing = emptyFiles();
    const refused = await openArea(refusing, undefined, () =>
      Promise.reject(new ComposeRefused('too-many-pixels', null, 'refused for the case', 2)),
    );
    stream.feed(
      request('i2', 'engine/compose-images', {
        session: refused.session,
        images: [{ from: IN, mediaType: 'image/png' }],
        into: OUT,
      }),
    );
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: true, value: { kind: 'refused', reason: 'too-many-pixels', line: null, item: 2 } },
    });
    expect(refusing.written.size).toBe(0);

    // A NAME THE AREA DOES NOT HOLD: `asset-missing`, and not an incident — main wrote
    // the list, so a missing file is main's fault and a code it can act on.
    const missing = emptyFiles();
    const gone = await openArea(missing);
    stream.feed(
      request('i3', 'engine/compose-images', {
        session: gone.session,
        images: [{ from: IN, mediaType: 'image/png' }],
        into: OUT,
      }),
    );
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
    expect(gone.calls.filter((entry) => entry.startsWith('incident:'))).toStrictEqual([]);
  });

  it('a list at the import’s count, every name at its bound, fits in ONE frame', () => {
    // THE WORST LEGITIMATE REQUEST, `hostProtocol.test.ts`' question for this channel: a
    // bound on the list the frame cannot carry would refuse a 500-image import at the
    // pipe with a framing error rather than an answer. `request` frames with the shipped
    // encoder, which throws past the limit, and the length is asserted besides.
    const name = 'a'.repeat(ENGINE_SESSION_ID_MAX_CHARS);
    const frame = request('i4', 'engine/compose-images', {
      session: 'f'.repeat(ENGINE_SESSION_ID_MAX_CHARS),
      images: Array.from({ length: MAX_IMPORT_IMAGES }, () => ({ from: name, mediaType: 'image/jpeg' })),
      into: name,
    });
    const framed = JSON.parse(new TextDecoder().decode(frame.subarray(FRAME_HEADER_BYTES))) as {
      readonly params: unknown;
    };
    expect(composeChannels['engine/compose-images'].params.safeParse(framed.params).success).toBe(true);
    expect(frame.length).toBeLessThanOrEqual(ENGINE_HOST_FRAME_MAX_BYTES);
  });

  it('bounds the image list at the import’s count, and CONTROL: accepts the count itself', () => {
    const params = composeChannels['engine/compose-images'].params;
    const listOf = (count: number) => ({
      session: 's',
      images: Array.from({ length: count }, () => ({ from: IN, mediaType: 'image/png' })),
      into: OUT,
    });
    expect(params.safeParse(listOf(MAX_IMPORT_IMAGES)).success).toBe(true);
    expect(params.safeParse(listOf(MAX_IMPORT_IMAGES + 1)).success).toBe(false);
    expect(params.safeParse(listOf(0)).success).toBe(false);
  });

  it('bounds the page by the format, and CONTROL: accepts the limit itself', () => {
    const params = composeChannels['engine/compose-markdown'].params;
    const at = (width: number) => ({ session: 's', from: IN, into: OUT, page: { width, height: 792 } });
    expect(params.safeParse(at(MAX_PAGE_COORDINATE)).success).toBe(true);
    expect(params.safeParse(at(MAX_PAGE_COORDINATE + 1)).success).toBe(false);
  });
});

describe('the compose host body', () => {
  it('opens by registering an AREA, reading no file and composing nothing', async () => {
    const files = emptyFiles();
    const { session, calls } = await openArea(files);

    expect(session.length).toBeGreaterThan(0);
    // AN EMPTY CALL LIST rather than *no compose call*, because the second is
    // satisfied by a handler that read the file and threw the bytes away.
    expect(calls).toStrictEqual([]);
    expect(files.written.size).toBe(0);
  });

  it('composes the named source and writes the PDF under the name main chose', async () => {
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([35, 32, 72]));

    stream.feed(composeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: true, value: { kind: 'composed', bytes: COMPOSED.length } },
    });
    // THE BYTES LANDED IN THE GRANTED DIRECTORY, under the output name. The count
    // alone would pass on a handler that wrote nowhere.
    expect(files.written.get(`${AREA.outputDirectory}|${OUT}`)).toStrictEqual(COMPOSED);
    // AND THE COMPOSER SAW THE FILE'S BYTES AND THE PAGE ASKED FOR.
    expect(calls).toStrictEqual(['compose:35,32,72:612x792']);
  });

  it('answers a composer REFUSAL as a refusal with its line, and writes nothing', async () => {
    const files = emptyFiles();
    const { session, calls } = await openArea(files, () =>
      Promise.reject(new ComposeRefused('unencodable-text', 3, 'refused for the case')),
    );
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([1]));

    stream.feed(composeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: true, value: { kind: 'refused', reason: 'unencodable-text', line: 3 } },
    });
    expect(files.written.size).toBe(0);
    // AN ANSWER, not a fault: nothing reached the incident sink.
    expect(calls.filter((entry) => entry.startsWith('incident:'))).toStrictEqual([]);
  });

  it('does NOT dress a composer FAULT up as a refusal — it is internal, with an incident', async () => {
    // THE DECISION IS THE ASSERTION: a handler that caught every error and answered
    // `refused` would tell a person their file was at fault for a defect in this
    // build. So this asserts the incident, which only a propagated throw produces.
    const files = emptyFiles();
    const { session, calls } = await openArea(files, () => Promise.reject(new Error('a layout defect')));
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([1]));

    stream.feed(composeRequest(session));
    await stream.whenSent(2);

    const answer = answerIn(stream.sent[1]) as { body: { ok: boolean; error?: { code: string } } };
    expect(answer.body.ok).toBe(false);
    expect(answer.body.error?.code).toBe('internal');
    expect(calls).toContain('incident:engine/compose-markdown');
    expect(files.written.size).toBe(0);
  });

  it('answers a source that is not there as asset-missing, and never calls the composer', async () => {
    const files = emptyFiles();
    const { session, calls } = await openArea(files);

    stream.feed(composeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: false, error: { code: 'asset-missing' } },
    });
    expect(calls).toStrictEqual([]);
  });

  it('answers an area this host does not hold as no-such-session', async () => {
    const files = emptyFiles();
    await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, new Uint8Array([1]));

    stream.feed(composeRequest('f'.repeat(TOKEN_BYTES * 2)));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: false, error: { code: 'no-such-session' } },
    });
  });
});

describe('the compose host — Optimize, MuPDF’s native image rewriter (ADR-0087)', () => {
  const MEDIUM = { quality: 70, over: 225, to: 150 };
  const optimizeRequest = (session: string, setting: Record<string, number> = MEDIUM): Uint8Array =>
    request('z1', 'engine/optimize', { session, from: IN, into: OUT, ...setting });

  afterEach(() => {
    optimizer = () => Promise.resolve({ kind: 'optimized', bytes: 1234 });
  });

  it('hands the rewriter the AREA, both names and the setting, and answers the count it wrote', async () => {
    const { session, calls } = await openArea(emptyFiles());

    stream.feed(optimizeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'optimized', bytes: 1234 } } });
    expect(calls).toStrictEqual([`optimize:C:\\snap|${IN}->C:\\out|${OUT}:70/225/150`]);
  });

  it('answers MuPDF refusing the document as unreadable, and a missing source as the transport’s', async () => {
    optimizer = () => Promise.resolve({ kind: 'unreadable' });
    const first = await openArea(emptyFiles());
    stream.feed(optimizeRequest(first.session));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'unreadable' } } });

    optimizer = () => Promise.resolve({ kind: 'missing' });
    const second = await openArea(emptyFiles());
    stream.feed(optimizeRequest(second.session));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
  });

  it('answers UNAVAILABLE with no library bound, and calls nothing', async () => {
    optimizer = null;
    const { session, calls } = await openArea(emptyFiles());

    stream.feed(optimizeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'unavailable' } } });
    expect(calls).toStrictEqual([]);
  });

  it('does NOT dress a rewriter FAULT up as an answer — it is internal, with an incident', async () => {
    optimizer = () => Promise.reject(new Error('MuPDF could not save the copy: disk full'));
    const { session, calls } = await openArea(emptyFiles());

    stream.feed(optimizeRequest(session));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: false, error: { code: 'internal' } } });
    expect(calls).toContain('incident:engine/optimize');
  });

  it('refuses a target at or above its threshold, or one without a threshold — and CONTROL: accepts both 0', () => {
    const params = composeChannels['engine/optimize'].params;
    const base = { session: 'a'.repeat(TOKEN_BYTES * 2), from: IN, into: OUT, quality: 70 };
    expect(params.safeParse({ ...base, over: 225, to: 150 }).success).toBe(true);
    expect(params.safeParse({ ...base, over: 0, to: 0 }).success).toBe(true);
    for (const [over, to] of [[150, 150], [150, 225], [0, 150], [225, 0]] as const) {
      expect(params.safeParse({ ...base, over, to }).success, `${String(over)}/${String(to)}`).toBe(false);
    }
    for (const quality of [0, 101, 70.5]) {
      expect(params.safeParse({ ...base, quality, over: 0, to: 0 }).success, String(quality)).toBe(false);
    }
  });
});
