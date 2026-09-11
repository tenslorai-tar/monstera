import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * The SHIPPED APPLICATION's form of invariant 9's four download guarantees.
 *
 *   1. HTTPS only.
 *   2. Host-locked, re-checked on every redirect hop.
 *   3. Size-bounded by counting received bytes, never by trusting
 *      `Content-Length`.
 *   4. SHA-256 verified in quarantine before any parser touches the bytes, and
 *      a mismatch is never retried.
 *
 * ## Why this exists beside `scripts/lib/fetchVerified.mjs`
 *
 * Because neither layer can import the other, and the reason is `ARCHITECTURE`
 * §1.1 rather than convenience: `scripts/` holds *"the code that runs before
 * dependencies exist"*, so it cannot import a built package — measured on the
 * ordering, where CI provisions at a step before it builds and the Guards job
 * never installs at all. An on-demand model download is the opposite case: it
 * runs here, at a user's request, long after every build.
 *
 * So this is invariant 27's situation and takes its rule — **copy only where
 * the reader cannot reach the source, and a copy that exists must be proven
 * equal.** `docs/ARCHITECTURE.md` invariant 9 is the writer of record for the
 * four guarantees and `proof:verifieddownload` drives both forms through one
 * table of cases, equal in what each **refuses** (ADR-0053).
 *
 * What is pinned is those four and nothing else. The differences below are this
 * form's own, and each is a difference the proof does not report:
 *
 * - **No automatic retry.** Provisioning blocks a build with nobody watching,
 *   so it retries a dead socket three times; a download here was started by a
 *   person who is still there and can start it again. A retry loop that a user
 *   cannot see is also one more path that ends at the digest boundary, which is
 *   the one place in this module where trying again is *downloading until the
 *   hash matches*.
 * - **A refusal carries a `reason`**, because main has to turn one into a
 *   sentence a reader understands, and parsing a message to find out what
 *   happened is a second opinion about a decision this module already took.
 */

/** Why a download was refused. The first four are invariant 9's guarantees. */
export type DownloadRefusal =
  | 'not-https'
  | 'unlisted-host'
  | 'too-large'
  | 'digest-mismatch'
  | 'too-many-redirects'
  | 'http-error'
  | 'unreachable';

/**
 * A refused or failed download, carrying which rule stopped it.
 *
 * The class exists for the discriminant, not for the message: a caller deciding
 * what to show a reader reads `reason`, and a caller writing a log reads
 * `message`. Both were available from the text alone and only by parsing it.
 */
export class DownloadRefused extends Error {
  readonly reason: DownloadRefusal;

  constructor(reason: DownloadRefusal, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DownloadRefused';
    this.reason = reason;
  }
}

/** How many hops a download may take before it is a loop. */
const MAX_REDIRECTS = 5;

/**
 * Guarantees 1 and 2 for one URL.
 *
 * Applied to **every** hop rather than to the first, which is what makes it
 * guarantee 2 rather than a scheme check with a host check beside it: a release
 * download redirects to a signed asset host, so a first-hop-only check leaves
 * the request that delivers the bytes unchecked.
 */
function assertAllowed(url: string, allowedHosts: readonly string[]): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new DownloadRefused(
      'not-https',
      `Refusing non-HTTPS download: ${parsed.protocol}//${parsed.host}`,
    );
  }
  if (!allowedHosts.includes(parsed.host)) {
    throw new DownloadRefused(
      'unlisted-host',
      `Refusing download from unlisted host "${parsed.host}". Allowed: ${allowedHosts.join(', ')}`,
    );
  }
  return parsed;
}

/**
 * Follows redirects by hand and returns the body.
 *
 * `fetch` follows them internally by default, which would hide every hop but
 * the first — so `redirect: 'manual'` is what guarantee 2 is made of, and the
 * next host is checked **before** it is requested rather than after.
 *
 * Returns the body rather than the response because the null check happens
 * here: handing back the response would leave the caller holding a
 * `ReadableStream | null` this function has already proven non-null.
 */
async function fetchChecked(
  url: string,
  allowedHosts: readonly string[],
  fetchImpl: typeof fetch,
): Promise<ReadableStream<Uint8Array>> {
  let current = assertAllowed(url, allowedHosts).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: 'manual' });
    } catch (cause) {
      throw new DownloadRefused('unreachable', `${current} could not be reached`, { cause });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) {
        throw new DownloadRefused(
          'http-error',
          `Redirect ${String(response.status)} from ${current} carried no Location header`,
        );
      }
      // Resolved against the current URL before the check, because a release
      // host commonly issues a RELATIVE Location and a relative hop that
      // skipped the check would be guarantee 2 with a hole in it.
      current = assertAllowed(new URL(location, current).toString(), allowedHosts).toString();
      continue;
    }

    if (!response.ok) {
      throw new DownloadRefused(
        'http-error',
        `HTTP ${String(response.status)} ${response.statusText} for ${current}`,
      );
    }
    if (response.body === null) {
      throw new DownloadRefused('http-error', `Empty response body for ${current}`);
    }
    return response.body;
  }

  throw new DownloadRefused(
    'too-many-redirects',
    `Exceeded ${String(MAX_REDIRECTS)} redirects starting at ${url}`,
  );
}

export interface VerifiedDownload {
  /** An absolute `https:` URL on one of `allowedHosts`. */
  url: string;
  /** Hosts this download may touch, on the first request and on every hop. */
  allowedHosts: readonly string[];
  /** Lowercase hex digest of the exact bytes expected. */
  sha256: string;
  /** Hard ceiling on RECEIVED bytes. Never compared against `Content-Length`. */
  maxBytes: number;
  /** Absolute path to place the verified file. Its directory is created. */
  destination: string;
  /**
   * Injected so the proof can drive each guarantee with an answer of its
   * choosing. The application never passes it.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Downloads one file, verifies its SHA-256, and only then places it at
 * `destination`. Returns the destination path.
 *
 * **The bytes never reach `destination` unverified.** They stream into a
 * quarantine file beside it that nothing interprets, and only a matching digest
 * renames it into place — which is what makes guarantee 4 a property of the
 * pipeline rather than an instruction to callers.
 *
 * A digest mismatch deletes the quarantined file **unread**. A file that failed
 * its pin is not a diagnostic to inspect later; leaving it invites the next run
 * to find it and a person to wonder whether it is fine.
 */
export async function downloadVerified({
  url,
  allowedHosts,
  sha256,
  maxBytes,
  destination,
  fetchImpl = fetch,
}: VerifiedDownload): Promise<string> {
  const expected = sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expected)) {
    throw new DownloadRefused(
      'digest-mismatch',
      `Expected a 64-character hex SHA-256, received "${sha256}"`,
    );
  }

  await mkdir(dirname(destination), { recursive: true });
  const quarantine = `${destination}.unverified`;
  // Removed BEFORE the download rather than only after a failure, so a partial
  // file left by a dead socket can never be hashed by the run that follows it.
  await rm(quarantine, { force: true });

  const body = await fetchChecked(url, allowedHosts, fetchImpl);
  const hash = createHash('sha256');
  let received = 0;

  // GUARANTEE 3, and it is a meter rather than a header read. `Content-Length`
  // is a claim by the sender: a response that lies about its size, or omits the
  // header, or is chunked, would pass a check against it while delivering
  // anything at all. What is counted is what arrived.
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(
          new DownloadRefused(
            'too-large',
            `Download exceeded its ${String(maxBytes)} byte ceiling at ${String(received)} ` +
              `bytes (${url}). Content-Length is deliberately not trusted for this check.`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(body, meter, createWriteStream(quarantine));
  } catch (cause) {
    await rm(quarantine, { force: true });
    // The ceiling arrives through the same rejection as a dead socket and must
    // not be re-labelled as one: a stream that died is nobody answering, a
    // stream past its ceiling is an asset that is not what we pinned.
    if (cause instanceof DownloadRefused) throw cause;
    throw new DownloadRefused('unreachable', `Download failed: ${url}`, { cause });
  }

  const actual = hash.digest('hex');
  if (actual !== expected) {
    await rm(quarantine, { force: true });
    throw new DownloadRefused(
      'digest-mismatch',
      `SHA-256 mismatch for ${url}\n  expected ${expected}\n  received ${actual}\n` +
        `The quarantined file was deleted unread.`,
    );
  }

  await rm(destination, { force: true });
  await rename(quarantine, destination);
  return destination;
}
