// @ts-check
/**
 * Proof that the one download primitive retries what nobody answered and
 * REFUSES to retry what it verified (rule B2).
 *
 * ## The boundary this exists to pin
 *
 * `downloadVerified` gained a retry on 2026-08-25, after `main` went red with
 * `read ECONNRESET` inside the provisioning concurrency case — one racer's TLS
 * connection dropped mid-download, on a commit that added eighteen lines to a
 * markdown file. The root cause is outside this repository, which is what makes
 * trying again the correct response rather than a workaround.
 *
 * **A retry on a verified download is dangerous in exactly one direction**, and
 * that direction is the reason this file exists: retrying a DIGEST MISMATCH is
 * *downloading until the hash matches*, on the one check standing between a
 * pinned asset and whatever a host served instead. So the load-bearing cases
 * here are the refusals — a mismatch, a ceiling breach, a 404 — and a version
 * that retried everything passes every other case in the file.
 *
 * The digest is deliberately outside the retried attempt in the module, and the
 * case below asserts the observable consequence: exactly ONE request.
 *
 * Usage: node scripts/proofs/fetchVerified.proof.mjs
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { downloadVerified } from '../lib/fetchVerified.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-fetchverified-'));
const URL_UNDER_TEST = 'https://github.com/example/asset.bin';
const HOSTS = ['github.com'];
const PAYLOAD = Buffer.from('the pinned bytes, and nothing else');
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');

/**
 * A response carrying `bytes`, as the release host would send it.
 *
 * @param {Buffer | null} bytes
 * @param {number} [status]
 */
function served(bytes, status = 200) {
  return new Response(status === 200 ? bytes : null, { status });
}

/** @typedef {(attempt: number) => Response | Error} Answer */

/**
 * Drives `downloadVerified` with a scripted `fetch`, counting requests.
 *
 * The count is the whole instrument: every claim below is about HOW MANY times
 * the network was asked, which is the only externally visible difference
 * between "retried" and "refused".
 */
async function run(
  /** @type {Answer} */ answer,
  /** @type {{ sha256?: string, maxBytes?: number }} */ { sha256 = DIGEST, maxBytes = 1_000_000 } = {},
) {
  let calls = 0;
  const destination = join(scratch, `out-${String(Math.abs(Date.now() % 100000))}-${String(calls)}.bin`);
  /** @type {{ ok: boolean, error: Error | null, calls: number, destination: string }} */
  const outcome = { ok: false, error: null, calls: 0, destination };
  try {
    await downloadVerified({
      url: URL_UNDER_TEST,
      allowedHosts: HOSTS,
      sha256,
      maxBytes,
      destination,
      fetchImpl: /** @type {typeof fetch} */ (
        async () => {
          calls += 1;
          const outcomeForAttempt = answer(calls);
          if (outcomeForAttempt instanceof Error) throw outcomeForAttempt;
          return outcomeForAttempt;
        }
      ),
    });
    outcome.ok = true;
  } catch (error) {
    outcome.error = error instanceof Error ? error : new Error(String(error));
  }
  outcome.calls = calls;
  return outcome;
}

// ---------------------------------------------------------------------------
// IT TRIES AGAIN — the obvious half.
// ---------------------------------------------------------------------------
{
  const result = await run((n) => (n < 3 ? new Error('read ECONNRESET') : served(PAYLOAD)));
  check(
    'a reset connection is retried, and the eventual bytes are the answer',
    result.ok && result.calls === 3 && readFileSync(result.destination).equals(PAYLOAD),
    `ok=${String(result.ok)} calls=${String(result.calls)} error=${String(result.error?.message)}`,
  );
}

{
  const result = await run((n) => (n < 2 ? served(null, 503) : served(PAYLOAD)));
  check(
    'a 503 is retried',
    result.ok && result.calls === 2,
    `ok=${String(result.ok)} calls=${String(result.calls)}`,
  );
}

{
  const result = await run(() => new Error('read ECONNRESET'));
  check(
    'exhausting the attempts THROWS rather than landing a file',
    !result.ok && result.calls === 3 && !existsSync(result.destination),
    `ok=${String(result.ok)} calls=${String(result.calls)} landed=${String(existsSync(result.destination))}`,
  );
}

// ---------------------------------------------------------------------------
// IT REFUSES — the half that matters, and the reason this file exists.
// ---------------------------------------------------------------------------
{
  // THE LOAD-BEARING CASE. Bytes that arrived complete and hash differently are
  // an asset that is not what we pinned. Retrying that is downloading until the
  // hash matches.
  const wrong = Buffer.from('not the pinned bytes at all');
  const result = await run(() => served(wrong));
  check(
    'CONTROL: a DIGEST MISMATCH is not retried — exactly one request',
    !result.ok && result.calls === 1 && /SHA-256 mismatch/u.test(String(result.error?.message)),
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 120)}`,
  );
}

{
  const wrong = Buffer.from('not the pinned bytes at all');
  const result = await run(() => served(wrong));
  check(
    '  ...and it leaves nothing behind for a caller to pick up',
    !existsSync(result.destination) && !existsSync(`${result.destination}.unverified`),
    `destination=${String(existsSync(result.destination))} quarantine=${String(existsSync(`${result.destination}.unverified`))}`,
  );
}

{
  const result = await run(() => served(PAYLOAD), { maxBytes: 4 });
  check(
    'CONTROL: a ceiling breach is not retried, though it arrives as the same rejection',
    !result.ok && result.calls === 1 && /ceiling/u.test(String(result.error?.message)),
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 120)}`,
  );
}

{
  const result = await run(() => served(null, 404));
  check(
    'CONTROL: a 404 is not retried — a wrong pin must not take three times as long to report',
    !result.ok && result.calls === 1,
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 120)}`,
  );
}

{
  const result = await run(() => served(null, 403));
  check(
    'CONTROL: a 403 is not retried either, so the rule is ANSWERED rather than one status',
    !result.ok && result.calls === 1,
    `calls=${String(result.calls)}`,
  );
}

{
  // The host allowlist is a SECURITY refusal, and a security refusal that is
  // retried is one that gets three chances to be raced.
  const result = await run(() => served(PAYLOAD));
  const denied = await downloadVerified({
    url: 'https://not-the-pinned-host.example/asset.bin',
    allowedHosts: HOSTS,
    sha256: DIGEST,
    maxBytes: 1_000_000,
    destination: join(scratch, 'never.bin'),
    fetchImpl: /** @type {typeof fetch} */ (async () => served(PAYLOAD)),
  }).then(
    () => null,
    (error) => (error instanceof Error ? error : new Error(String(error))),
  );
  check(
    'CONTROL: a host outside the allowlist is refused before any request is made',
    denied !== null && !existsSync(join(scratch, 'never.bin')) && result.ok,
    `denied=${String(denied?.message).slice(0, 120)}`,
  );
}

rmSync(scratch, { recursive: true, force: true });

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} fetchVerified case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('fetchVerified case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
