import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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
import { signatureFromScan } from '../signatureScan.js';
import { type ImageOptimizer, type InlineImageKeeper, type SignatureScanner, createComposeHandlers } from './composeHandlers.js';
import { ENGINE_SESSION_ID_MAX_CHARS } from './engineChannels.js';
import type { HostArea } from './engineHandlers.js';
import { sessionFileAnswers } from './fileAnswers.js';
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
  const areas = createHostSessions<HostArea>(() => new Uint8Array(TOKEN_BYTES).fill(7));
  const surface = {
    readSnapshot: (directory: string, name: string): Promise<Uint8Array> => {
      const found = files.read.get(`${directory}|${name}`);
      if (found === undefined) return Promise.reject(new Error('no such file'));
      return Promise.resolve(found);
    },
    writeOutput: (directory: string, name: string, bytes: Uint8Array): Promise<number> => {
      files.written.set(`${directory}|${name}`, bytes);
      return Promise.resolve(bytes.length);
    },
    writeOutputStream: (): never => {
      throw new Error('the compose host streams no output');
    },
  };
  const handlers = createComposeHandlers({
    // `optimize`'s recording, for the same reason: what the request named is what the keeper is handed.
    keepInlineImages:
      keeper === null
        ? null
        : (area, from, into, scope) => {
            calls.push(`keep:${area.snapshotDirectory}|${from}->${area.outputDirectory}|${into}:${String(scope)}`);
            return keeper === null ? Promise.reject(new Error('unreachable')) : keeper(area, from, into, scope);
          },
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
    signatureFromScan:
      scanner === null
        ? null
        : (pdf) => {
            calls.push(`scan:${String(pdf.byteLength)}`);
            return scanner === null ? { kind: 'unreadable' } : scanner(pdf);
          },
    areas,
    files: surface,
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
      // THE ENTRY'S OWN RESOLUTION over the same table and files, never a stub of it — `pdfiumHostBody.test.ts`' reason.
      fileAnswers: sessionFileAnswers(areas, surface),
    },
    () => undefined,
  );
  return { calls };
}

/** The one stream every `start` in this file uses, replaced per case. */
let stream = stubStream();

/** The rewriter every `start` binds, set by a case before it opens its area; `null` is none bound. */
let optimizer: ImageOptimizer | null = () => Promise.resolve({ kind: 'optimized', bytes: 1234 });
let keeper: InlineImageKeeper | null = () => Promise.resolve({ kind: 'kept', bytes: 999, converted: 2, left: 1 });
/** The scanned-signature reader every `start` binds: the real one, over the shim the test setup binds; `null` is none. */
let scanner: SignatureScanner | null = signatureFromScan;

/** The response inside one frame, with the header stripped by the contract's constant. */
function answerIn(frame: Uint8Array | undefined): unknown {
  if (frame === undefined) throw new Error('no frame was written');
  return JSON.parse(new TextDecoder().decode(frame.subarray(FRAME_HEADER_BYTES)));
}

/**
 * One request, framed exactly as main frames it — with the answer's file name for a file-answered channel, or with
 * its params staged in the snapshot directory for a file-requested one (ADR-0125 and its addendum).
 */
function request(
  id: string,
  channel: string,
  params: unknown,
  route: { readonly answerInto?: string; readonly paramsIn?: { readonly files: Files; readonly name: string } } = {},
): Uint8Array {
  let carried: Record<string, unknown> = { params };
  if (route.paramsIn !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(params));
    route.paramsIn.files.read.set(`${AREA.snapshotDirectory}|${route.paramsIn.name}`, bytes);
    const session = (params as { readonly session: string }).session;
    carried = { paramsFile: { session, name: route.paramsIn.name, bytes: bytes.byteLength } };
  }
  return encodeFrame(
    new TextEncoder().encode(
      JSON.stringify({ id, channel, ...carried, ...(route.answerInto === undefined ? {} : { answerInto: route.answerInto }) }),
    ),
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
        'engine/keep-inline-images',
        'engine/open',
        'engine/optimize',
        'engine/probe-containment',
        'engine/join-pdfs',
        'engine/pdf-pages',
        'engine/image-size',
        'engine/signature-from-scan',
        'engine/workbook-outline',
        'engine/workbook-part',
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

  it('KEEP-INLINE-IMAGES hands the keeper the area, both names and the scope, and answers its counts (ADR-0126)', async () => {
    const { session, calls } = await openArea(emptyFiles());
    stream.feed(request('k1', 'engine/keep-inline-images', { session, from: IN, into: OUT, scope: 3 }));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({
      body: { ok: true, value: { kind: 'kept', bytes: 999, converted: 2, left: 1 } },
    });
    expect(calls).toStrictEqual([`keep:C:\\snap|${IN}->C:\\out|${OUT}:3`]);
  });

  it('KEEP-INLINE-IMAGES: a missing source is the transport’s, no library is unavailable and calls nothing', async () => {
    keeper = () => Promise.resolve({ kind: 'missing' });
    const first = await openArea(emptyFiles());
    stream.feed(request('k1', 'engine/keep-inline-images', { session: first.session, from: IN, into: OUT, scope: 'all' }));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });

    keeper = null;
    const second = await openArea(emptyFiles());
    stream.feed(request('k2', 'engine/keep-inline-images', { session: second.session, from: IN, into: OUT, scope: 0 }));
    await stream.whenSent(2);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'unavailable' } } });
    expect(second.calls).toStrictEqual([]);
    keeper = () => Promise.resolve({ kind: 'kept', bytes: 999, converted: 2, left: 1 });
  });

  it('KEEP-INLINE-IMAGES takes one page or all, and refuses any other scope a command never makes', () => {
    const params = composeChannels['engine/keep-inline-images'].params;
    const base = { session: 'a'.repeat(TOKEN_BYTES * 2), from: IN, into: OUT };
    expect(params.safeParse({ ...base, scope: 0 }).success).toBe(true);
    expect(params.safeParse({ ...base, scope: 'all' }).success).toBe(true);
    for (const scope of [-1, 1.5, [0, 1], 'some']) {
      expect(params.safeParse({ ...base, scope }).success, JSON.stringify(scope)).toBe(false);
    }
  });

});

/**
 * Decision C's four channels through the body. What a part holds is `workbookParts.test.ts`' subject; here it is which
 * answer each outcome reaches the wire as — the transport's miss, a file's own `unreadable`, and a written count.
 */
describe('the compose host — a workbook in parts (decision C)', () => {
  const WB_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const WB_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const WB_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  /** One visible sheet whose last row is 12. */
  const oneSheet = (): Uint8Array =>
    zipSync({
      '_rels/.rels': strToU8(
        `${WB_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${WB_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      'xl/workbook.xml': strToU8(
        `${WB_XML}<workbook xmlns="${WB_MAIN}" xmlns:r="${WB_REL}"><sheets><sheet name="Only" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `${WB_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${WB_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      'xl/worksheets/sheet1.xml': strToU8(`${WB_XML}<worksheet xmlns="${WB_MAIN}"><sheetData><row r="12"/></sheetData></worksheet>`),
    });
  const pdfOf = async (pages: number): Promise<Uint8Array> => {
    const document = await PDFDocument.create();
    for (let page = 0; page < pages; page += 1) document.addPage([100, 100]);
    return document.save();
  };
  const NOT_A_FILE = new TextEncoder().encode('not a zip and not a PDF');
  const SECOND = 'beadfeed';

  it('outlines a workbook, and answers a file it cannot read as unreadable and a missing one as the transport’s', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, oneSheet());
    files.read.set(`${AREA.snapshotDirectory}|${SECOND}`, NOT_A_FILE);

    stream.feed(request('w1', 'engine/workbook-outline', { session, from: IN }, { answerInto: 'a0a0a0a0' }));
    await stream.whenSent(2);
    stream.feed(request('w2', 'engine/workbook-outline', { session, from: SECOND }, { answerInto: 'a1a1a1a1' }));
    await stream.whenSent(3);
    stream.feed(request('w3', 'engine/workbook-outline', { session, from: 'abad1dea' }, { answerInto: 'a2a2a2a2' }));
    await stream.whenSent(4);

    // THE ANSWER IS IN A FILE (ADR-0125): the outline grows with the workbook, and the frame carries its size.
    const answered = (name: string): unknown => JSON.parse(new TextDecoder().decode(files.written.get(`${AREA.outputDirectory}|${name}`)));
    expect(answerIn(stream.sent[1])).toMatchObject({ id: 'w1', answerFile: {} });
    expect(answered('a0a0a0a0')).toMatchObject({
      ok: true,
      value: { kind: 'outline', sheets: [{ name: 'Only', state: 'visible', lastRow: 12 }] },
    });
    expect(answered('a1a1a1a1')).toMatchObject({ ok: true, value: { kind: 'unreadable' } });
    // A FAILURE STAYS IN THE FRAME, bounded by its schema — `answerCrossesInFile`'s rule.
    expect(answerIn(stream.sent[3])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
  });

  it('writes a part into the output directory and answers its count; a block past the sheet is nothing', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, oneSheet());

    stream.feed(request('p1', 'engine/workbook-part', { session, from: IN, into: OUT, sheet: 0, rows: { from: 1, to: 6 } }));
    await stream.whenSent(2);

    const written = files.written.get(`${AREA.outputDirectory}|${OUT}`);
    expect(written).toBeDefined();
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'written', bytes: written?.length } } });
    expect(strFromU8(unzipSync(written ?? new Uint8Array())['xl/workbook.xml'] ?? new Uint8Array())).toContain("'Only'!$1:$6");
  });

  it('refuses a block that ends before it starts, and a sheet past the bound, at the schema', () => {
    const params = composeChannels['engine/workbook-part'].params;
    const base = { session: 'a'.repeat(TOKEN_BYTES * 2), from: IN, into: OUT, sheet: 0 };
    expect(params.safeParse({ ...base, rows: null }).success).toBe(true);
    expect(params.safeParse({ ...base, rows: { from: 5, to: 5 } }).success).toBe(true);
    expect(params.safeParse({ ...base, rows: { from: 6, to: 5 } }).success).toBe(false);
    expect(params.safeParse({ ...base, rows: { from: 0, to: 5 } }).success).toBe(false);
    expect(params.safeParse({ ...base, sheet: 4096, rows: null }).success).toBe(false);
  });

  it('SIZES A PICTURE attached to a question (ADR-0135): its header’s size, unreadable for bytes that are not one, and a missing file as the transport’s', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    // A JPEG's start-of-frame stating 3024 x 4032, the rest of a file a reader needs nothing more of.
    files.read.set(
      `${AREA.snapshotDirectory}|${IN}`,
      Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xc0, 0x0b, 0xd0, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9),
    );
    files.read.set(`${AREA.snapshotDirectory}|${SECOND}`, NOT_A_FILE);

    stream.feed(request('s1', 'engine/image-size', { session, from: IN, mediaType: 'image/jpeg' }));
    await stream.whenSent(2);
    stream.feed(request('s2', 'engine/image-size', { session, from: SECOND, mediaType: 'image/png' }));
    await stream.whenSent(3);
    stream.feed(request('s3', 'engine/image-size', { session, from: 'abad1dea', mediaType: 'image/png' }));
    await stream.whenSent(4);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'sized', width: 3024, height: 4032 } } });
    expect(answerIn(stream.sent[2])).toMatchObject({ body: { ok: true, value: { kind: 'unreadable' } } });
    expect(answerIn(stream.sent[3])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
  });

  it('makes a SCANNED SIGNATURE PDF a PNG in the output directory, and answers the file’s own refusals and the transport’s miss', async () => {
    const files = emptyFiles();
    const { session, calls } = await openArea(files);
    const scan = await PDFDocument.create();
    scan.addPage([400, 300]).drawRectangle({ x: 100, y: 120, width: 200, height: 40, color: rgb(0.1, 0.1, 0.5) });
    const scanned = await scan.save();
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, scanned);
    files.read.set(`${AREA.snapshotDirectory}|${SECOND}`, await pdfOf(1));

    stream.feed(request('g1', 'engine/signature-from-scan', { session, from: IN, into: OUT }));
    await stream.whenSent(2);
    stream.feed(request('g2', 'engine/signature-from-scan', { session, from: SECOND, into: 'cafe-02' }));
    await stream.whenSent(3);
    stream.feed(request('g3', 'engine/signature-from-scan', { session, from: 'abad1dea', into: 'cafe-03' }));
    await stream.whenSent(4);

    // THE FILE THE REQUEST NAMED is the one read, and the PNG goes under the name it gave.
    expect(calls).toStrictEqual([`scan:${String(scanned.byteLength)}`, expect.stringMatching(/^scan:/u)]);
    const png = files.written.get(`${AREA.outputDirectory}|${OUT}`);
    expect([...(png ?? new Uint8Array()).subarray(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'drawn', bytes: png?.length } } });
    expect(answerIn(stream.sent[2])).toMatchObject({ body: { ok: true, value: { kind: 'blank' } } });
    expect(files.written.has(`${AREA.outputDirectory}|cafe-02`)).toBe(false);
    expect(answerIn(stream.sent[3])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
  });

  it('answers a scanned signature UNAVAILABLE with no library bound, and reads nothing', async () => {
    scanner = null;
    try {
      const files = emptyFiles();
      const { session, calls } = await openArea(files);
      files.read.set(`${AREA.snapshotDirectory}|${IN}`, await pdfOf(1));
      stream.feed(request('g1', 'engine/signature-from-scan', { session, from: IN, into: OUT }));
      await stream.whenSent(2);
      expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'unavailable' } } });
      expect(calls).toStrictEqual([]);
    } finally {
      scanner = signatureFromScan;
    }
  });

  it('counts a PDF’s pages, and answers one it cannot read as unreadable', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, await pdfOf(3));
    files.read.set(`${AREA.snapshotDirectory}|${SECOND}`, NOT_A_FILE);

    stream.feed(request('c1', 'engine/pdf-pages', { session, from: IN }));
    await stream.whenSent(2);
    stream.feed(request('c2', 'engine/pdf-pages', { session, from: SECOND }));
    await stream.whenSent(3);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'counted', pages: 3 } } });
    expect(answerIn(stream.sent[2])).toMatchObject({ body: { ok: true, value: { kind: 'unreadable' } } });
  });

  it('joins the parts in order into the output directory, and names the part it cannot read', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, await pdfOf(2));
    files.read.set(`${AREA.snapshotDirectory}|${SECOND}`, await pdfOf(5));
    files.read.set(`${AREA.snapshotDirectory}|abad1dea`, NOT_A_FILE);

    // ITS PARAMS IN A FILE (ADR-0125's addendum), staged in the snapshot directory as main stages them.
    stream.feed(request('j1', 'engine/join-pdfs', { session, from: [IN, SECOND], into: OUT }, { paramsIn: { files, name: 'b0b0b0b0' } }));
    await stream.whenSent(2);
    stream.feed(
      request('j2', 'engine/join-pdfs', { session, from: [IN, 'abad1dea'], into: 'cafe-02' }, { paramsIn: { files, name: 'b1b1b1b1' } }),
    );
    await stream.whenSent(3);

    const joined = files.written.get(`${AREA.outputDirectory}|${OUT}`);
    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: true, value: { kind: 'joined', bytes: joined?.length, pages: [2, 5] } } });
    expect((await PDFDocument.load(joined ?? new Uint8Array())).getPageCount()).toBe(7);
    expect(answerIn(stream.sent[2])).toMatchObject({ body: { ok: true, value: { kind: 'unreadable', item: 1 } } });
    expect(files.written.has(`${AREA.outputDirectory}|cafe-02`)).toBe(false);
  });

  it('answers a part main did not write as the transport’s, and writes nothing', async () => {
    const files = emptyFiles();
    const { session } = await openArea(files);
    files.read.set(`${AREA.snapshotDirectory}|${IN}`, await pdfOf(2));

    stream.feed(request('j1', 'engine/join-pdfs', { session, from: [IN, 'abad1dea'], into: OUT }, { paramsIn: { files, name: 'b0b0b0b0' } }));
    await stream.whenSent(2);

    expect(answerIn(stream.sent[1])).toMatchObject({ body: { ok: false, error: { code: 'asset-missing' } } });
    expect(files.written.size).toBe(0);
  });
});

describe('the compose host — Optimize’s setting (ADR-0087)', () => {
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
