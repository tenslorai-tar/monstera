import type { OcrLanguage } from '@monstera/contract';
import type { PdfPoint, Rotation } from '@monstera/shared';
import { pageTransform, toPdf, viewportPoint } from '@monstera/shared';

import type { RecognisedLine, RecognisedPage, RecognisedWord } from './ocrRecognise.js';

/**
 * Azure Document Intelligence — **the recogniser that runs in `main`**.
 *
 * ## Why it is not in the engine host, where Tesseract is
 *
 * [ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
 * Decision 2 puts recognition beside the rasteriser and gives the reason twice.
 * That is about the **local** engine. Invariant 25 gives the engine host no
 * network at all, so a recogniser whose whole operation is an HTTPS call executes
 * where the network is (the ADR's 2026-09-12 addition).
 *
 * What that gives up is what Decision 2 protects: the raster crosses. It is
 * unavoidable and cheap in those terms — the bytes are leaving the machine
 * regardless, and a local pipe hop is nothing beside the upload.
 *
 * ## THIS MODULE DOES NOT CONVERT COORDINATES BY ITSELF
 *
 * The service answers polygons in the raster's own pixels. Putting those on the
 * page needs the displayed crop, the effective rotation and where the raster's
 * (0, 0) sits — three facts the engine host reads and hands over with the PNG
 * (`RegionSnapshot`). This calls `pageTransform` and `toPdf`, which is the one
 * converter, as a reader. Reconstructing the flip and the turn here would agree
 * on an unrotated page and be wrong on every other, which is finding FFFFFF-1
 * arriving in a third engine.
 *
 * ## What is NOT proven here, and it is the row's own trigger
 *
 * **Nothing in this build has ever run against the live service.** Every fixture
 * is written from the documentation, so what the cases assert is a reading of
 * the documented schema and not the service's behaviour. One run with a real key
 * settles it; until then this module is honest machinery over an unverified
 * premise, and the FEATURES row says so where somebody reads it.
 */

/** The API version this build speaks, pinned rather than floating. */
export const AZURE_API_VERSION = '2024-11-30';

/**
 * Device pixels per PDF point for the raster sent to Azure.
 *
 * **2, which is `OCR_DPI`'s 200 dpi within a rounding** (200/72 = 2.78) and is
 * deliberately not the same number: that one is the input to a local engine and
 * this one is bytes crossing the internet, so the trade is different. At 2 a
 * one-line region of about 340×50 points is 680×100 pixels — a few tens of
 * kilobytes, and comfortably above the resolution the service's own guidance
 * asks for.
 *
 * A constant rather than a setting: a reader has no way to judge it, and the
 * failure it would cause — a recognition that reads badly — looks like the
 * service being poor rather than like a number somebody set.
 *
 * **Here rather than in main's composition root, since 2026-09-13.** The live
 * harness, `scripts/probes/azureLive.mjs`, sends a raster at this scale too, and
 * a second `2` typed there would be a copy nothing compares with this one.
 */
export const AZURE_RASTER_SCALE = 2;

/**
 * The largest raster this build sends, in bytes.
 *
 * *Service quotas and limits* (Microsoft Learn, read 2026-09-18): **Max document size
 * 4 MB on the free tier (F0), 500 MB on the standard tier (S0)**. Which tier a reader's
 * resource is on is not something the application can read, so it keeps to the one
 * limit no resource refuses: a larger raster is shrunk before it is sent, never
 * refused afterwards. 4,000,000 rather than 4,194,304 because the page does not say
 * which megabyte it means.
 */
export const AZURE_MAX_DOCUMENT_BYTES = 4_000_000;

/**
 * Whether Azure accepts a PNG of this many bytes, and if not, the linear factor to
 * shrink its raster by. {@link claudeAcceptsBytes}'s shape, so main treats both alike.
 */
export function azureAcceptsBytes(
  pngBytes: number,
): { readonly ok: true } | { readonly ok: false; readonly shrinkBy: number } {
  if (pngBytes <= AZURE_MAX_DOCUMENT_BYTES) return { ok: true };
  return { ok: false, shrinkBy: Math.sqrt(AZURE_MAX_DOCUMENT_BYTES / pngBytes) * 0.95 };
}

/** The model: text and word boxes, which is what a `RecognisedPage` holds. */
const MODEL = 'prebuilt-read';

/**
 * How long to keep polling before giving up, and how often.
 *
 * The service answers `202` with an `Operation-Location` and the analysis runs
 * asynchronously, so there is no response to await. Ninety seconds at one
 * second is a bound on a single region of a single page — enough for a slow day
 * at the service and short enough that a reader is not left with a control that
 * has been busy for ten minutes.
 *
 * **A timeout is reported as a timeout**, never as an empty recognition: an
 * empty `RecognisedPage` is a real answer meaning *no text here*, and a run that
 * gave up must not be able to produce it.
 */
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 90_000;

/** Why a recognition did not happen. */
export type AzureRefusal =
  | 'not-https'
  | 'unauthorised'
  | 'rejected'
  | 'unreachable'
  | 'timed-out'
  | 'unreadable-answer'
  | 'not-deleted';

/**
 * A refused recognition, carrying which thing refused it.
 *
 * `DownloadRefused`'s shape and its reason: main turns this into a sentence a
 * reader can act on — a wrong key is theirs to fix and a service that is down is
 * not — and parsing a message to find out which is a second opinion about a
 * decision this module already took.
 */
export class AzureRecognitionRefused extends Error {
  readonly reason: AzureRefusal;

  constructor(reason: AzureRefusal, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AzureRecognitionRefused';
    this.reason = reason;
  }
}

/** Where to send the raster, and what to send with it. */
export interface AzureCredentials {
  /** The resource endpoint, e.g. `https://<name>.cognitiveservices.azure.com`. */
  readonly endpoint: string;
  /** The key, from `secretStore.ts`. Never logged and never in a URL. */
  readonly key: string;
}

/** One raster, and the frame the host says it sits in. */
export interface AzureRequest {
  readonly png: Uint8Array;
  /** The page's displayed box, from `RegionSnapshot`. */
  readonly crop: readonly [number, number, number, number];
  readonly rotation: Rotation;
  readonly origin: readonly [number, number];
  /** Device pixels per PDF point — the scale the raster was made at. */
  readonly scale: number;
  /**
   * Injected so the cases can drive the protocol without a network or a key.
   * The application never passes it.
   */
  readonly fetchImpl?: typeof fetch;
}

/** What the service answers, as much of it as this build reads. */
interface AnalyzeAnswer {
  readonly status?: unknown;
  readonly analyzeResult?: {
    readonly pages?: readonly {
      readonly words?: readonly {
        readonly content?: unknown;
        readonly polygon?: readonly unknown[];
        readonly confidence?: unknown;
      }[];
      readonly lines?: readonly {
        readonly content?: unknown;
        readonly polygon?: readonly unknown[];
      }[];
    }[];
  };
}

/**
 * The endpoint, checked before anything is sent to it.
 *
 * **HTTPS only**, which is invariant 9's first guarantee applied to the other
 * direction of travel: that one governs what this build downloads, and a key and
 * a reader's document going out over plaintext is the same rule with more at
 * stake. The endpoint is a setting a person types, so unlike a pinned download
 * URL it is not a compile-time constant and this is the only thing standing
 * between a typo and a plaintext upload.
 */
function analyzeUrl(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch (cause) {
    throw new AzureRecognitionRefused(
      'not-https',
      `"${endpoint}" is not a URL, so there is nowhere to send the page.`,
      { cause },
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new AzureRecognitionRefused(
      'not-https',
      `Refusing to send a page to ${parsed.protocol}//${parsed.host}: the endpoint must be HTTPS.`,
    );
  }
  const base = parsed.toString().replace(/\/+$/u, '');
  return `${base}/documentintelligence/documentModels/${MODEL}:analyze?api-version=${AZURE_API_VERSION}`;
}

/**
 * Starts the analysis and answers where to poll.
 *
 * A `202` with an `Operation-Location` header is the documented success, and
 * this refuses everything else rather than guessing: a `200` with a body would
 * be a different API version, and reading one would be this build inventing a
 * protocol the service does not have.
 */
async function startAnalysis(
  url: string,
  credentials: AzureCredentials,
  png: Uint8Array,
  fetchImpl: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        // THE KEY IN A HEADER, never in the URL: a query string reaches logs,
        // proxies and a browser's history, and this one is a secret the OS
        // keychain is holding for exactly that reason.
        'Ocp-Apim-Subscription-Key': credentials.key,
        'Content-Type': 'image/png',
      },
      body: new Uint8Array(png),
    });
  } catch (cause) {
    throw new AzureRecognitionRefused('unreachable', 'The service could not be reached.', {
      cause,
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new AzureRecognitionRefused(
      'unauthorised',
      'The service refused the key. Check the endpoint and the key in settings.',
    );
  }
  if (response.status !== 202) {
    throw new AzureRecognitionRefused(
      'rejected',
      `The service answered ${String(response.status)} ${response.statusText} rather than the ` +
        `202 an analysis starts with.`,
    );
  }

  const location = response.headers.get('operation-location');
  if (location === null || location === '') {
    throw new AzureRecognitionRefused(
      'unreadable-answer',
      'The service accepted the page and named no Operation-Location, so there is nothing to poll.',
    );
  }
  return location;
}

/**
 * Polls until the analysis succeeds, fails, or this gives up.
 *
 * **Every terminal state is separated.** `succeeded` is the answer; `failed` is
 * the service saying it could not read the page, which is a refusal a reader can
 * act on; running out of time is neither, and reporting it as an empty page
 * would be a run that gave up wearing the shape of a page with no text.
 */
async function pollUntilDone(
  location: string,
  credentials: AzureCredentials,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<AnalyzeAnswer> {
  const deadline = now() + POLL_TIMEOUT_MS;

  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(location, {
        headers: { 'Ocp-Apim-Subscription-Key': credentials.key },
      });
    } catch (cause) {
      throw new AzureRecognitionRefused('unreachable', 'The service stopped answering.', { cause });
    }
    if (!response.ok) {
      throw new AzureRecognitionRefused(
        'rejected',
        `Polling answered ${String(response.status)} ${response.statusText}.`,
      );
    }

    let body: AnalyzeAnswer;
    try {
      body = (await response.json()) as AnalyzeAnswer;
    } catch (cause) {
      throw new AzureRecognitionRefused(
        'unreadable-answer',
        'The service answered something that is not JSON.',
        { cause },
      );
    }

    if (body.status === 'succeeded') return body;
    if (body.status === 'failed') {
      throw new AzureRecognitionRefused('rejected', 'The service could not analyse this page.');
    }

    // NOT A RECOGNISED STATE IS A REFUSAL, not another poll. `running` and
    // `notStarted` are the documented ones; anything else means this build is
    // reading a protocol it does not know, and looping on it would spend ninety
    // seconds to report a timeout for what is actually a version mismatch.
    if (body.status !== 'running' && body.status !== 'notStarted') {
      throw new AzureRecognitionRefused(
        'unreadable-answer',
        `The service reported a status this build does not know: ${JSON.stringify(body.status)}.`,
      );
    }

    if (now() >= deadline) {
      throw new AzureRecognitionRefused(
        'timed-out',
        `The analysis did not finish within ${String(POLL_TIMEOUT_MS / 1000)} seconds.`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Asks the service to delete the stored result, and answers why not, or `null` once it has.
 *
 * *Delete Analyze Result*, `DELETE …/documentModels/{modelId}/analyzeResults/{resultId}`,
 * answering `204` (Microsoft Learn, REST reference for api-version 2024-11-30, read
 * 2026-09-18). That path is the `Operation-Location` the analysis handed back, so the
 * URL deleted is the URL polled — the one the service itself named — and no second
 * spelling of the path exists here to drift from it.
 *
 * **The owner's rule** (2026-09-18): the service keeps no copy of what a reader sent
 * once the read is over. So this is called on every path an analysis STARTED, not only
 * on success — a failed or timed-out analysis still left a result behind.
 */
async function deleteResult(
  location: string,
  credentials: AzureCredentials,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(location, {
      method: 'DELETE',
      headers: { 'Ocp-Apim-Subscription-Key': credentials.key },
    });
  } catch {
    return 'the service could not be reached to delete its copy of the result';
  }
  // 204 AND ONLY 204. A 200 would be a different API version, and reading it as a
  // deletion is this build inventing a protocol — the rule `startAnalysis` keeps
  // for its 202.
  if (response.status === 204) return null;
  return (
    `the service answered ${String(response.status)} ${response.statusText} when asked to ` +
    'delete its copy of the result'
  );
}

/** A polygon's eight numbers, or `null` for anything else. */
function cornersOf(polygon: readonly unknown[] | undefined): readonly number[] | null {
  if (polygon === undefined || polygon.length < 8) return null;
  const numbers = polygon.filter((value): value is number => typeof value === 'number');
  return numbers.length < 8 ? null : numbers;
}

/**
 * A polygon in raster pixels to a box in PDF user space.
 *
 * The service answers **four corners**, clockwise from the top-left, and a
 * rotated line's corners are not axis-aligned. What a `RecognisedWord` holds is
 * a box, so this takes the extent of all four after conversion rather than the
 * first and third — which for a line at an angle would be a box that does not
 * contain its own text.
 */
function boxOf(
  corners: readonly number[],
  toPage: (x: number, y: number) => PdfPoint,
): readonly [number, number, number, number] {
  const points = [0, 2, 4, 6].map((at) => toPage(corners[at] ?? 0, corners[at + 1] ?? 0));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Sends one region's raster to the service and answers a `RecognisedPage`.
 *
 * @throws {@link AzureRecognitionRefused} for every way this does not happen.
 */
export async function recogniseThroughAzure(
  credentials: AzureCredentials,
  request: AzureRequest,
  clock: { sleep: (ms: number) => Promise<void>; now: () => number } = {
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
  },
): Promise<RecognisedPage> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const url = analyzeUrl(credentials.endpoint);
  const location = await startAnalysis(url, credentials, request.png, fetchImpl);

  let answer: AnalyzeAnswer;
  try {
    answer = await pollUntilDone(location, credentials, fetchImpl, clock.sleep, clock.now);
  } catch (cause) {
    // THE ANALYSIS FAILED, AND ITS RESULT IS DELETED ANYWAY. The poll's refusal is the
    // one a reader needs, so it keeps its reason; a delete that also failed is added to
    // its sentence rather than lost, because it is the part they cannot see.
    const undeleted = await deleteResult(location, credentials, fetchImpl);
    if (undeleted === null || !(cause instanceof AzureRecognitionRefused)) throw cause;
    throw new AzureRecognitionRefused(cause.reason, `${cause.message} And ${undeleted}.`, {
      cause,
    });
  }

  // A SUCCESSFUL READ WHOSE COPY STAYED ON THE SERVICE IS REFUSED, not returned. Handing
  // back the text while saying nothing would be the one outcome a reader could not
  // learn about, and the owner's rule is that no copy stays. The text is not kept: a
  // second try sends the region again, which the reader can choose; a copy they were
  // not told about is nothing they can choose.
  const undeleted = await deleteResult(location, credentials, fetchImpl);
  if (undeleted !== null) {
    throw new AzureRecognitionRefused(
      'not-deleted',
      `Azure read the region, but ${undeleted}, so it may still hold a copy. The text was ` +
        'not used.',
    );
  }

  // THE ONE CONVERTER, built from the host's own three facts. Nothing about the
  // flip, the crop origin or the turn is stated here.
  const transform = pageTransform(
    { x0: request.crop[0], y0: request.crop[1], x1: request.crop[2], y1: request.crop[3] },
    request.rotation,
    request.scale,
  );
  const toPage = (x: number, y: number): PdfPoint =>
    toPdf(viewportPoint(x + request.origin[0], y + request.origin[1]), transform);

  const page = answer.analyzeResult?.pages?.[0];
  const words: RecognisedWord[] = [];
  for (const word of page?.words ?? []) {
    const corners = cornersOf(word.polygon);
    if (corners === null || typeof word.content !== 'string') continue;
    words.push({
      text: word.content,
      box: boxOf(corners, toPage),
      // THE SERVICE'S SCALE IS 0 TO 1 and a `RecognisedWord`'s is 0 to 100, so
      // this is a unit conversion rather than a rescaling of somebody's
      // judgement. A missing confidence is 0 rather than a guess.
      confidence: typeof word.confidence === 'number' ? Math.round(word.confidence * 100) : 0,
    });
  }

  const lines: RecognisedLine[] = [];
  for (const line of page?.lines ?? []) {
    const corners = cornersOf(line.polygon);
    if (corners === null || typeof line.content !== 'string') continue;
    const box = boxOf(corners, toPage);
    lines.push({
      text: line.content,
      box,
      // THE WORDS THIS LINE CONTAINS, by geometry, because the service answers
      // the two lists SEPARATELY and joins them by `spans` into a flat string
      // this build does not carry. Containment of a word's centre is the join
      // that needs no second structure — and a word that matches no line still
      // reaches the text layer through the line it is inside, never silently
      // dropped.
      words: words.filter((word) => {
        const x = (word.box[0] + word.box[2]) / 2;
        const y = (word.box[1] + word.box[3]) / 2;
        return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
      }),
    });
  }

  return {
    lines,
    confidence:
      words.length === 0
        ? 0
        : Math.round(words.reduce((sum, word) => sum + word.confidence, 0) / words.length),
    // `prebuilt-read` DETECTS THE LANGUAGE and this build does not ask for one.
    // `eng` is what the answer names because a `RecognisedPage` must name
    // something from a closed set of fourteen, and claiming the language the
    // reader's OCR setting happens to hold would be inventing a fact about a
    // service that was never asked.
    language: 'eng' satisfies OcrLanguage,
  };
}
