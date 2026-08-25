// @ts-check
/**
 * The one download primitive for provisioned binaries (Part C8).
 *
 * Every native binary this project uses — gitleaks now; mutool, pdfium,
 * Ghostscript and the on-demand OCR runtime later — arrives through here, so
 * the four guarantees below are written once instead of per-downloader:
 *
 *   1. HTTPS only.
 *   2. Host-locked, re-checked on every redirect hop rather than only on the
 *      first request. GitHub release downloads always redirect to a signed
 *      asset host, so a first-hop-only check would leave the hop that actually
 *      delivers the bytes unchecked.
 *   3. Size-bounded by counting received bytes, never by trusting
 *      Content-Length — a header is a claim by the sender, not a limit.
 *   4. SHA-256 verified before any parser or unzipper touches the bytes. The
 *      download streams into a quarantine file that nothing interprets; only
 *      after the digest matches does it move to its destination.
 *
 * Not in scope: the SSRF guard with private-range blocklist and DNS-rebinding
 * pin that Part C8 requires for *user-supplied* URLs. That guard defends a
 * different threat (an attacker choosing the host) and belongs in the kernel
 * beside the feature that accepts URLs. Here the host is a compile-time
 * constant, so host-locking is the guard.
 */

import { TransientFailure, isTransientStatus, retryTransient } from './retryTransient.mjs';

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const MAX_REDIRECTS = 5;

/**
 * A ceiling breach, named so the retry below cannot mistake it for a reset.
 *
 * It surfaces through the same `pipeline` rejection as a dead socket, and the
 * two must not share a classification: a stream that died is nobody answering,
 * a stream that ran past its ceiling is an asset that is not what we pinned.
 */
class DownloadTooLarge extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DownloadTooLarge';
  }
}

/**
 * How many times one download may go unanswered. Three, with a short backoff.
 *
 * `main` went red on 2026-08-25 with `read ECONNRESET` inside
 * `gitleaks.proof.mjs`'s concurrency case — one racer's TLS connection dropped
 * mid-download, on a commit that added eighteen lines to a markdown file. The
 * root cause is outside this repository, which is what makes trying again the
 * correct response rather than a workaround (Rule 0), and the commit that added
 * it names the cause.
 *
 * This is the THIRD consumer of `retryTransient` and the second in one day, so
 * the classification lives there rather than here: only a `TransientFailure` is
 * tried again, and exhausting the attempts throws the last failure rather than
 * returning. What is local to this module is which of ITS failures are
 * transient — see `fetchChecked` and the digest boundary in `downloadVerified`.
 */
const DOWNLOAD_ATTEMPTS = 3;
/** Backoff before attempt `n`. Bounded and short: provisioning blocks a build. */
const downloadBackoffMs = (/** @type {number} */ attempt) => (attempt - 1) * 750;

/**
 * @param {string} url
 * @param {readonly string[]} allowedHosts
 * @returns {URL}
 */
function assertAllowed(url, allowedHosts) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTPS download: ${parsed.protocol}//${parsed.host}`);
  }
  if (!allowedHosts.includes(parsed.host)) {
    throw new Error(
      `Refusing download from unlisted host "${parsed.host}". ` +
        `Allowed: ${allowedHosts.join(', ')}`,
    );
  }
  return parsed;
}

/**
 * Follows redirects manually so each hop's host is checked. `fetch` follows
 * them internally by default, which would hide every hop but the first.
 *
 * Returns the BODY, not the response. The null check lives here, so returning
 * the response would leave the caller holding a `ReadableStream | null` that
 * this function has already proven non-null — a guarantee the type could not
 * express, which is why `pipeline` was being handed a possibly-null source.
 * Returning the narrowed value carries the proof to the caller.
 *
 * @param {string} url
 * @param {readonly string[]} allowedHosts
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
async function fetchChecked(url, allowedHosts, fetchImpl) {
  let current = assertAllowed(url, allowedHosts).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    /** @type {Response} */
    let response;
    try {
      response = await fetchImpl(current, { redirect: 'manual' });
    } catch (cause) {
      // NOBODY ANSWERED. A refused connection, a reset socket or a DNS failure
      // are the same class as a 503 and are re-thrown as transient rather than
      // escaping as themselves.
      throw new TransientFailure(`${current} could not be reached`, { cause });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) {
        throw new Error(`Redirect ${response.status} from ${current} carried no Location header`);
      }
      // Release hosts commonly issue a relative Location; resolve against the
      // current URL before the host check so a relative hop cannot skip it.
      current = assertAllowed(new URL(location, current).toString(), allowedHosts).toString();
      continue;
    }

    if (!response.ok) {
      const message = `HTTP ${response.status} ${response.statusText} for ${current}`;
      // 429 and 5xx are the host saying "not now"; everything else is an answer.
      // A 404 retried three times is a wrong pin that takes three times as long
      // to report, which is how a retry becomes retry-until-green.
      if (isTransientStatus(response.status)) throw new TransientFailure(message);
      throw new Error(message);
    }
    if (response.body === null) {
      throw new Error(`Empty response body for ${current}`);
    }
    return response.body;
  }

  throw new Error(`Exceeded ${MAX_REDIRECTS} redirects starting at ${url}`);
}

/**
 * Downloads a file, verifies its SHA-256, and only then places it at
 * `destination`. Returns the destination path.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {readonly string[]} options.allowedHosts
 * @param {string} options.sha256 Lowercase hex digest of the expected bytes.
 * @param {number} options.maxBytes Hard ceiling on received bytes.
 * @param {string} options.destination Absolute path to place the verified file.
 * @param {typeof fetch} [options.fetchImpl] Injected so the retry boundary can
 *   be driven with an answer of our choosing. Provisioning never passes it; the
 *   proof does. Without a seam here the three branches that decide what is
 *   transient would be exercised only when a release host misbehaves, which is
 *   the gap finding DDDD-14 was about one module over.
 * @returns {Promise<string>}
 */
export async function downloadVerified({
  url,
  allowedHosts,
  sha256,
  maxBytes,
  destination,
  fetchImpl = fetch,
}) {
  const expected = sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`Expected a 64-character hex SHA-256, received "${sha256}"`);
  }

  await mkdir(dirname(destination), { recursive: true });
  const quarantine = `${destination}.unverified`;
  await rm(quarantine, { force: true });

  /**
   * ONE ATTEMPT: fetch, meter, hash, land in quarantine. Retried as a whole.
   *
   * A stream cannot be replayed, so a reset halfway through has to redo the
   * request — which is why the retry wraps this and not just the `fetch`. The
   * quarantine is removed at the top of every attempt rather than only on
   * failure, so a partial file from a dead socket can never be hashed by the
   * attempt that follows it.
   */
  const attempt = async () => {
    await rm(quarantine, { force: true });

    const body = await fetchChecked(url, allowedHosts, fetchImpl);
    const hash = createHash('sha256');
    let received = 0;

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) {
          callback(
            new DownloadTooLarge(
              `Download exceeded its ${maxBytes} byte ceiling at ${received} bytes (${url}). ` +
                `Content-Length is deliberately not trusted for this check.`,
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
      // THE CEILING IS NOT A RESET. It arrives through the same rejection, and
      // trying again would re-download an asset already known to be the wrong
      // size — so it propagates on the first attempt, as itself.
      if (cause instanceof DownloadTooLarge) throw cause;
      throw new TransientFailure(`Download failed: ${url}`, { cause });
    }

    return hash.digest('hex');
  };

  /**
   * **A DIGEST MISMATCH IS NEVER RETRIED, and that is the whole boundary.**
   *
   * It is outside `attempt` deliberately. Retrying a mismatch is *downloading
   * until the hash matches* — on the one check that stands between a pinned
   * asset and whatever the host served instead, which is the check this module
   * exists for. A truncated stream fails at the pipeline above and is retried
   * there; bytes that arrived complete and hash differently are an asset that
   * is not what we pinned, and the answer to that is to stop.
   */
  const actual = await retryTransient(attempt, {
    attempts: DOWNLOAD_ATTEMPTS,
    delayMs: downloadBackoffMs,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  if (actual !== expected) {
    await rm(quarantine, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${url}\n  expected ${expected}\n  received ${actual}\n` +
        `The quarantined file was deleted unread.`,
    );
  }

  await rm(destination, { force: true });
  await rename(quarantine, destination);
  return destination;
}

/**
 * True when `path` exists as a file. Used by provisioning scripts to stay
 * idempotent without pretending an absent binary is present.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    // Any stat failure — ENOENT, ENOTDIR, permission — means "cannot use this
    // file", which is the same answer the caller needs.
    return false;
  }
}

/**
 * @param {string} path
 * @returns {Promise<string>} SHA-256 of the file's bytes, hex.
 */
/**
 * Throws unless a file already on disk matches a pinned digest.
 *
 * ## Why this exists beside `downloadVerified` rather than inside it
 *
 * They answer the same question at different times, and only this one can be
 * asked of a file that arrived by some route other than a download — **a
 * restored CI cache being the case it was written for.** `downloadVerified`
 * hashes the stream as it writes, which is what keeps unverified bytes out of
 * the destination; it cannot be reused for a file that is already there.
 *
 * What must not be duplicated is the *rule*, so the comparison and the message
 * live here and the caller supplies only the context. A provisioner that
 * open-codes `digest === pin` is the second opinion B3a is about.
 *
 * **The file is deleted on mismatch, unread.** A file that fails its pin is not
 * a diagnostic to inspect later; leaving it invites the next run to find it and
 * a human to wonder whether it is fine.
 *
 * @param {{ path: string, sha256: string, context: string }} options
 * @returns {Promise<void>}
 */
export async function verifyFileDigest({ path, sha256, context }) {
  const actual = await digestOf(path);
  if (actual === sha256) return;
  await rm(path, { force: true });
  throw new Error(
    `SHA-256 mismatch for ${context}\n  at       ${path}\n  expected ${sha256}\n` +
      `  received ${actual}\nThe file was deleted unread.`,
  );
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function digestOf(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return `${hash.digest('hex')}`;
}

/**
 * Whether two files hold the same bytes — `same`, `different`, or `unreadable`.
 *
 * ## Why this is three states and not a boolean
 *
 * It exists to answer "does this destination already hold the binary I staged"
 * for a caller that will DESTROY the destination if the answer is no. A boolean
 * would have to fold "they differ" together with "I could not look", and those
 * two license opposite actions: the first is a reason to replace, the second is
 * a reason to touch nothing. Collapsing them is the defect this function was
 * written to remove, one level up — see `publish` in
 * `scripts/provision/gitleaks.mjs`.
 *
 * An unreadable file is therefore never reported as `different`. A failed read
 * is not evidence about content (audit item 4b: an empty result is a broken
 * lookup, not a clean one).
 *
 * ## Why content and not "does it run"
 *
 * Starting a process is a question about the machine at this instant; a virus
 * scanner holding a newly written executable open makes `CreateProcess` fail on
 * a file that is perfectly correct. Reading bytes is a question about the file.
 * Only the second one may gate a destructive step.
 *
 * @param {string} left
 * @param {string} right
 * @returns {Promise<{ kind: 'same' | 'different' } | { kind: 'unreadable', cause: unknown }>}
 */
export async function compareContents(left, right) {
  try {
    const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
    if (leftStat.size !== rightStat.size) return { kind: 'different' };
    const [leftDigest, rightDigest] = await Promise.all([digestOf(left), digestOf(right)]);
    return { kind: leftDigest === rightDigest ? 'same' : 'different' };
  } catch (cause) {
    return { kind: 'unreadable', cause };
  }
}

/**
 * @param {string} root
 * @param {...string} segments
 * @returns {string}
 */
export function toolPath(root, ...segments) {
  return join(root, '.tools', ...segments);
}
