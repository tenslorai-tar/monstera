import { describe, expect, it } from 'vitest';

import { AzureRecognitionRefused, recogniseThroughAzure } from './ocrAzure.js';

/**
 * The Azure protocol, driven end to end with no network and no key.
 *
 * ## WHAT THESE CASES ASSERT, AND WHAT THEY CANNOT
 *
 * Every fixture here is written **from the documentation**. So what passes is a
 * reading of the documented schema — that this build posts where it says, polls
 * what it is told to poll, waits for `succeeded`, and puts the polygons in the
 * right place. It is **not** evidence that the service behaves this way.
 *
 * That is the row's own open trigger and it is written into the FEATURES body:
 * one run against the live service with a real key. Saying it here too is
 * deliberate — a file of green cases about a cloud API is exactly the shape that
 * reads as verified.
 *
 * ## The coordinate case is the one that could not be written later
 *
 * A word box that lands in the wrong place is invisible to every assertion about
 * text, and the conversion has three inputs the host supplies. So the fixture
 * puts a word at a known pixel and requires the point it was drawn at, **and**
 * requires the mirrored point not to be in it — the same pair `ocrRecognise`'s
 * proof uses, for the same reason: on a centred fixture a flipped sign produces
 * the identical box.
 */

const CREDENTIALS = { endpoint: 'https://example.cognitiveservices.azure.com', key: 'k' };
const POLL_URL = 'https://example.cognitiveservices.azure.com/operations/1';

/** A clock that never waits, so the poll loop runs at test speed. */
const INSTANT = { sleep: (): Promise<void> => Promise.resolve(), now: (): number => 0 };

/**
 * The frame a 200x100 raster of an upright A4-ish page carries.
 *
 * Scale 1 and origin zero, so a pixel's PDF y is `crop.y1 - pixel.y` — an
 * arithmetic a reader can check by eye, which is what makes the mirrored-point
 * assertion below meaningful rather than a second computation of the same thing.
 */
const FRAME = {
  crop: [0, 0, 200, 300] as const,
  rotation: 0 as const,
  origin: [0, 0] as const,
  scale: 1,
};

/** A word's polygon, clockwise from the top-left, as the service answers one. */
function polygon(x0: number, y0: number, x1: number, y1: number): readonly number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/**
 * A scripted service: what the POST answers, then what each poll answers.
 *
 * **The poll answers are THUNKS**, and that is not style. A `Response` body can
 * be read once, so a fixture holding one object and handing it to two polls
 * fails on the second with *body already consumed* — which this module reports
 * as `unreadable-answer`, and which looked exactly like a real defect until the
 * fixture was read. The last thunk repeats, so a case that polls three times
 * writes one `running`.
 */
function service(
  start: Response | Error,
  polls: readonly (() => Response | Error)[],
): { fetchImpl: typeof fetch; asked: string[]; bodies: unknown[] } {
  const asked: string[] = [];
  const bodies: unknown[] = [];
  let poll = 0;
  const fetchImpl = ((url: string | URL, init?: RequestInit): Promise<Response> => {
    // `string | URL` RATHER THAN `fetch`'s OWN UNION, which includes `Request`:
    // a `Request` stringifies to `[object Object]`, and a harness that recorded
    // that would make every URL assertion below pass for a call this module
    // never makes. Narrowing here is honest, because this module passes a string.
    asked.push(url.toString());
    if (asked.length === 1) {
      bodies.push(init?.body);
      return start instanceof Error ? Promise.reject(start) : Promise.resolve(start);
    }
    const next = polls[Math.min(poll, polls.length - 1)];
    poll += 1;
    const answer = next?.() ?? new Response(null, { status: 500 });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as unknown as typeof fetch;
  return { fetchImpl, asked, bodies };
}

/** A 202 naming where to poll. */
function accepted(location: string = POLL_URL): Response {
  return new Response(null, { status: 202, headers: { 'operation-location': location } });
}

/**
 * A poll answer carrying a status and, optionally, an analysis.
 *
 * Returns a THUNK for the reason `service` gives: one `Response` handed to two
 * polls fails on the second, and the failure wears this module's own
 * `unreadable-answer` code.
 */
function polled(status: string, pages?: unknown): () => Response {
  return (): Response =>
    Response.json({ status, ...(pages === undefined ? {} : { analyzeResult: { pages } }) });
}

const PNG = new Uint8Array([137, 80, 78, 71]);

describe('the Azure recogniser', () => {
  it('POSTS to prebuilt-read at the pinned api-version, with the key in a HEADER', async () => {
    const { fetchImpl, asked } = service(accepted(), [
      polled('succeeded', [{ words: [], lines: [] }]),
    ]);
    await recogniseThroughAzure(CREDENTIALS, { png: PNG, ...FRAME, fetchImpl }, INSTANT);

    // THE URL IS THE ASSERTION, in full: a build that dropped the api-version
    // would be answered by whatever the service currently defaults to, and a
    // build that sent the wrong model would answer a different shape entirely.
    expect(asked[0]).toBe(
      'https://example.cognitiveservices.azure.com/documentintelligence/documentModels/' +
        'prebuilt-read:analyze?api-version=2024-11-30',
    );
    // AND THE KEY IS NOT IN IT. A query string reaches logs, proxies and
    // history, which is the whole reason it is in the OS keychain.
    expect(asked[0]).not.toContain(CREDENTIALS.key);
  });

  it('polls the Operation-Location it was given until the status is succeeded', async () => {
    const { fetchImpl, asked } = service(accepted(), [
      polled('notStarted'),
      polled('running'),
      polled('succeeded', [{ words: [], lines: [] }]),
    ]);
    await recogniseThroughAzure(CREDENTIALS, { png: PNG, ...FRAME, fetchImpl }, INSTANT);

    // FOUR CALLS: the POST and three polls. The count is the assertion, because
    // a build that read the first poll's `notStarted` as an answer would produce
    // an empty page and satisfy every case about text.
    expect(asked).toHaveLength(4);
    expect(asked.slice(1)).toStrictEqual([POLL_URL, POLL_URL, POLL_URL]);
  });

  it('PUTS THE WORD WHERE IT WAS DRAWN, in PDF user space', async () => {
    // A word in the raster's upper area: pixels run down, PDF user space runs
    // up, so y 20–40 of a 300-tall crop is user y 260–280.
    const { fetchImpl } = service(accepted(), [
      polled('succeeded', [
        {
          words: [{ content: 'MONSTERA', polygon: polygon(40, 20, 160, 40), confidence: 0.96 }],
          lines: [{ content: 'MONSTERA', polygon: polygon(40, 20, 160, 40) }],
        },
      ]),
    ]);
    const read = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    );

    const box = read.lines[0]?.words[0]?.box;
    expect(box).toBeDefined();
    const [x0, y0, x1, y1] = box ?? [0, 0, 0, 0];
    // CONTAINS THE POINT THE WORD SITS AT.
    expect(x0).toBeLessThanOrEqual(100);
    expect(x1).toBeGreaterThanOrEqual(100);
    expect(y0).toBeLessThanOrEqual(270);
    expect(y1).toBeGreaterThanOrEqual(270);
    // AND NOT THE MIRRORED ONE, which is what makes the four above mean
    // something: a flipped sign puts the box the same distance from the other
    // edge, and the fixture is deliberately off-centre so the two differ.
    expect(y0).toBeGreaterThan(30);
  });

  it('converts confidence from the service’s 0–1 to this build’s 0–100', async () => {
    const { fetchImpl } = service(accepted(), [
      polled('succeeded', [
        {
          words: [{ content: 'A', polygon: polygon(0, 0, 10, 10), confidence: 0.96 }],
          lines: [{ content: 'A', polygon: polygon(0, 0, 10, 10) }],
        },
      ]),
    ]);
    const read = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    );
    expect(read.lines[0]?.words[0]?.confidence).toBe(96);
    expect(read.confidence).toBe(96);
  });

  it('refuses a non-HTTPS endpoint BEFORE anything is sent', async () => {
    // The endpoint is typed by a person, so unlike a pinned download URL it is
    // not a compile-time constant — and this is the only thing between a typo
    // and a document plus a key going out in plaintext. The call count is the
    // claim: a refusal that reached the network is one that can be raced.
    const { fetchImpl, asked } = service(accepted(), [polled('succeeded', [])]);
    await expect(
      recogniseThroughAzure(
        { endpoint: 'http://example.cognitiveservices.azure.com', key: 'k' },
        { png: PNG, ...FRAME, fetchImpl },
        INSTANT,
      ),
    ).rejects.toThrow(/must be HTTPS/u);
    expect(asked).toHaveLength(0);
  });

  it('CONTROL: the same call over https:// reaches the service, so the refusal is the SCHEME', async () => {
    const { fetchImpl, asked } = service(accepted(), [
      polled('succeeded', [{ words: [], lines: [] }]),
    ]);
    await recogniseThroughAzure(CREDENTIALS, { png: PNG, ...FRAME, fetchImpl }, INSTANT);
    expect(asked.length).toBeGreaterThan(0);
  });

  it('reports a rejected KEY as its own reason, not as a failed analysis', async () => {
    // A reader can fix a wrong key and can do nothing about a service that is
    // down, so the two must not arrive as one sentence.
    const { fetchImpl } = service(new Response(null, { status: 401 }), []);
    const refused = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AzureRecognitionRefused);
    expect((refused as AzureRecognitionRefused).reason).toBe('unauthorised');
  });

  it('refuses a 202 that names no Operation-Location rather than polling nothing', async () => {
    const { fetchImpl } = service(new Response(null, { status: 202 }), []);
    await expect(
      recogniseThroughAzure(CREDENTIALS, { png: PNG, ...FRAME, fetchImpl }, INSTANT),
    ).rejects.toThrow(/nothing to poll/u);
  });

  it('reports a service FAILURE as a refusal, never as a page with no text', async () => {
    // THE CASE THAT MATTERS MOST HERE. An empty `RecognisedPage` is a real
    // answer — this region has no writing on it — so a build that folded a
    // failed analysis into one would tell a reader their handwriting is not
    // there.
    const { fetchImpl } = service(accepted(), [polled('failed')]);
    const refused = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    ).catch((error: unknown) => error);
    expect((refused as AzureRecognitionRefused).reason).toBe('rejected');
  });

  it('gives up with a TIMEOUT rather than an empty page, and says so', async () => {
    // The same defect one state along: a run that ran out of time has not
    // learnt that the region is blank.
    let clock = 0;
    const { fetchImpl } = service(accepted(), [polled('running')]);
    const refused = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      {
        sleep: (): Promise<void> => Promise.resolve(),
        now: (): number => {
          clock += 60_000;
          return clock;
        },
      },
    ).catch((error: unknown) => error);
    expect((refused as AzureRecognitionRefused).reason).toBe('timed-out');
  });

  it('refuses a status this build does not know rather than polling until the deadline', async () => {
    // A version mismatch reported as a timeout costs ninety seconds and names
    // the wrong thing. `running` and `notStarted` are the documented
    // non-terminal states and anything else means this build is reading a
    // protocol it does not have.
    const { fetchImpl, asked } = service(accepted(), [polled('inProgress')]);
    const refused = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    ).catch((error: unknown) => error);
    expect((refused as AzureRecognitionRefused).reason).toBe('unreadable-answer');
    // AND IT STOPPED: one POST and one poll.
    expect(asked).toHaveLength(2);
  });

  it('drops a word whose polygon is not four corners rather than placing it at zero', async () => {
    // A box of `[0,0,0,0]` is a real rectangle at the page's corner, so a build
    // that defaulted would put text there — visible, wrong, and nothing about
    // the text itself would look off.
    const { fetchImpl } = service(accepted(), [
      polled('succeeded', [
        {
          words: [
            { content: 'GOOD', polygon: polygon(10, 10, 20, 20), confidence: 0.9 },
            { content: 'BAD', polygon: [1, 2, 3], confidence: 0.9 },
          ],
          lines: [{ content: 'GOOD BAD', polygon: polygon(0, 0, 200, 100) }],
        },
      ]),
    ]);
    const read = await recogniseThroughAzure(
      CREDENTIALS,
      { png: PNG, ...FRAME, fetchImpl },
      INSTANT,
    );
    expect(read.lines[0]?.words.map((word) => word.text)).toStrictEqual(['GOOD']);
  });
});
