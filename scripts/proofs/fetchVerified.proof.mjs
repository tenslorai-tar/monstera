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
const roster = createRoster(failures, { cases: 18 });

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

/**
 * A response whose body dies PART WAY THROUGH, after headers arrived.
 *
 * The distinction this exists for (finding DDDD-22): `fetch` rejecting is a
 * **pre-body** failure and is what the ECONNRESET on 2026-08-25 actually was.
 * A socket reset *after* headers surfaces on the body stream instead, and it is
 * an equally ordinary production shape — but it leaves a PARTIAL FILE in the
 * quarantine, which the pre-body shape never does.
 *
 * That is the branch the retry's whole design rests on: *a stream cannot be
 * replayed, so a reset halfway through has to redo the request.* Until this
 * fixture existed, nothing produced one, and gutting that branch left all nine
 * cases green.
 *
 * @param {Buffer} partial Bytes to deliver before the socket dies.
 */
function diesMidStream(partial) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(partial));
        controller.error(new Error('read ECONNRESET'));
      },
    }),
    { status: 200 },
  );
}

/** @typedef {(attempt: number, requested: string) => Response | Error} Answer */

/**
 * A `303` to `location`, as a release host issues one.
 *
 * @param {string} location
 * @param {{ header?: boolean }} [options] `header: false` omits `Location`
 *   entirely, which is the branch a redirect with nowhere to go takes.
 */
function redirectedTo(location, { header = true } = {}) {
  return new Response(null, {
    status: 303,
    headers: header ? { location } : {},
  });
}

/**
 * Distinct destinations, without asking the clock.
 *
 * The first version of this file named the file from `Date.now()`, and two
 * cases entering the same millisecond would have shared a destination — after
 * which "it leaves nothing behind" is a claim about the previous case's file.
 * A counter cannot collide, and it removes a time dependency from a proof.
 */
let destinationSeq = 0;
/** @type {string[]} */
const destinationsUsed = [];

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
  destinationSeq += 1;
  const destination = join(scratch, `out-${String(destinationSeq)}.bin`);
  destinationsUsed.push(destination);
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
        /** @param {string | URL | Request} requested */
        async (requested) => {
          calls += 1;
          const outcomeForAttempt = answer(calls, String(requested));
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
  // THE MID-STREAM CASE, and one fixture carries three claims (finding DDDD-22).
  //
  // The byte comparison is the load-bearing half: attempt 1 leaves a PARTIAL
  // file in the quarantine, so if it survived into attempt 2 the digest would
  // differ and the download would fail. Passing proves the retry happened, that
  // the post-headers branch is reached at all, and that the quarantine is
  // cleared between attempts — which no other case here touches.
  const result = await run((n) => (n === 1 ? diesMidStream(PAYLOAD.subarray(0, 8)) : served(PAYLOAD)));
  check(
    'a stream that dies AFTER headers is retried, and the partial does not contaminate the retry',
    result.ok && result.calls === 2 && readFileSync(result.destination).equals(PAYLOAD),
    `ok=${String(result.ok)} calls=${String(result.calls)} error=${String(result.error?.message)}`,
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
  // THE COUNTER IS THE CLAIM (finding DDDD-23). This case is named "before any
  // request is made", and without counting it proved only that the call threw
  // and nothing landed — which an implementation that fetched FIRST and checked
  // the host afterwards would also satisfy. The timing is the whole point: a
  // security refusal that reaches the network is one that can be raced.
  let requests = 0;
  const denied = await downloadVerified({
    url: 'https://not-the-pinned-host.example/asset.bin',
    allowedHosts: HOSTS,
    sha256: DIGEST,
    maxBytes: 1_000_000,
    destination: join(scratch, 'never.bin'),
    fetchImpl: /** @type {typeof fetch} */ (
      async () => {
        requests += 1;
        return served(PAYLOAD);
      }
    ),
  }).then(
    () => null,
    (error) => (error instanceof Error ? error : new Error(String(error))),
  );
  check(
    'CONTROL: a host outside the allowlist is refused before any request is made',
    denied !== null && requests === 0 && !existsSync(join(scratch, 'never.bin')),
    `requests=${String(requests)} denied=${String(denied?.message).slice(0, 120)}`,
  );
}

// ---------------------------------------------------------------------------
// THE REDIRECT PATH (finding DDDD-25).
//
// This module's first proof was written the day a reset socket reddened `main`,
// so its ten cases are all about the retry rule and none of them reaches
// `fetchChecked`'s redirect loop — four branches, one of which is the allowlist
// re-check on every hop.
//
// THE ORDER OF THE FIRST TWO CASES IS THE POINT. A refusal is worth nothing on
// its own, because "the guard refused it" and "a redirect never works here"
// produce the same observation. So the first case is an input that SUCCEEDS,
// through the same loop, differing only in the host it is sent to.
// ---------------------------------------------------------------------------
{
  const result = await run((n) =>
    n === 1 ? redirectedTo('https://github.com/example/moved.bin') : served(PAYLOAD),
  );
  check(
    'CONTROL: a redirect to an ALLOWED host is FOLLOWED, and the bytes are the answer',
    result.ok && result.calls === 2 && readFileSync(result.destination).equals(PAYLOAD),
    `ok=${String(result.ok)} calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 120)}`,
  );
}

{
  /** @type {string[]} */
  const asked = [];
  const result = await run((n, requested) => {
    asked.push(requested);
    return n === 1 ? redirectedTo('https://evil.example.com/asset.bin') : served(PAYLOAD);
  });
  check(
    'a hop to a host OUTSIDE the allowlist is refused, and the hop is never requested',
    !result.ok &&
      /unlisted host "evil\.example\.com"/u.test(String(result.error?.message)) &&
      result.calls === 1 &&
      asked.every((url) => url.startsWith('https://github.com/')),
    `calls=${String(result.calls)} asked=${asked.join(',')} error=${String(result.error?.message).slice(0, 160)}`,
  );
}

{
  // The ordering the module comments on: `new URL(location, current)` is
  // resolved BEFORE the host check. A relative Location is the ordinary release
  // host's shape and must stay on the allowed host.
  /** @type {string[]} */
  const asked = [];
  const result = await run((n, requested) => {
    asked.push(requested);
    return n === 1 ? redirectedTo('/example/moved.bin') : served(PAYLOAD);
  });
  check(
    'a RELATIVE Location is resolved against the current URL, so the hop stays on the allowed host',
    result.ok && result.calls === 2 && asked[1] === 'https://github.com/example/moved.bin',
    `ok=${String(result.ok)} asked=${asked.join(',')} error=${String(result.error?.message).slice(0, 120)}`,
  );
}

{
  // And the half that makes the ordering load-bearing rather than convenient.
  // A protocol-relative Location has no host until it is resolved, so a check
  // that ran first would have nothing to compare — and `new URL('//evil…')`
  // with no base throws. Resolved, it is a different host and is refused.
  const result = await run((n) =>
    n === 1 ? redirectedTo('//evil.example.com/asset.bin') : served(PAYLOAD),
  );
  check(
    'a PROTOCOL-RELATIVE Location resolves to another host and is refused there',
    !result.ok &&
      /unlisted host "evil\.example\.com"/u.test(String(result.error?.message)) &&
      result.calls === 1,
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 160)}`,
  );
}

{
  const result = await run(() => redirectedTo('https://github.com/x', { header: false }));
  check(
    'a redirect carrying no Location is an ERROR, not a silent stop',
    !result.ok &&
      /carried no Location header/u.test(String(result.error?.message)) &&
      result.calls === 1,
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 160)}`,
  );
}

{
  // MAX_REDIRECTS is 5, and the loop runs hops 0..5 — so six requests are made
  // and the seventh is never sent. The count is what proves the bound is a
  // bound rather than a comment.
  const result = await run((n) => redirectedTo(`https://github.com/hop-${String(n)}`));
  check(
    'an unbounded redirect chain is refused after a BOUNDED number of requests',
    !result.ok && /Exceeded 5 redirects/u.test(String(result.error?.message)) && result.calls === 6,
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 160)}`,
  );
}

{
  const result = await run(() => served(null));
  check(
    'a 200 with no body is an error rather than an empty file',
    !result.ok &&
      /Empty response body/u.test(String(result.error?.message)) &&
      result.calls === 1 &&
      !existsSync(result.destination),
    `calls=${String(result.calls)} error=${String(result.error?.message).slice(0, 160)}`,
  );
}

{
  // A control on this file's own harness rather than on the module. Every case
  // above that asserts "nothing was left behind" is a claim about ONE path, and
  // it would be a claim about the PREVIOUS case's file if two runs could share
  // a destination — which is what naming them from the clock allowed.
  check(
    'CONTROL: no two runs in this file shared a destination',
    new Set(destinationsUsed).size === destinationsUsed.length && destinationsUsed.length > 1,
    `runs=${String(destinationsUsed.length)} distinct=${String(new Set(destinationsUsed).size)}`,
  );
}

rmSync(scratch, { recursive: true, force: true });

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} fetchVerified case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('fetchVerified case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
