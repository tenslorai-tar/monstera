// @ts-check
/**
 * Usage: node scripts/proofs/osvQuery.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { TransientFailure } from '../lib/retryTransient.mjs';
import { OSV_ATTEMPTS, osvBackoffMs, queryOsv } from '../security/osvQuery.mjs';

/**
 * Proves that the checker's OSV adapter retries what nobody answered and
 * refuses what OSV answered (finding DDDD-14).
 *
 * ## What this exists for, and what it deliberately does not cover
 *
 * `retryTransient.proof.mjs` covers the retry *mechanism* with hand-built
 * throws. It says nothing about the branches that decide **what is transient
 * when talking to OSV**, and those are the half that would have prevented the
 * red board on 2026-08-25. Before `osvQuery.mjs` existed they could not be
 * covered at all: the checker calls `main()` at import, and
 * `advisoryRegister.proof.mjs` drives it by spawning the real script against the
 * live API, where these branches only execute when OSV misbehaves.
 *
 * ## The load-bearing case is the one that must NOT retry
 *
 * A `queryOsv` that retried everything passes every other case here. Only the
 * 404 separates *retried because nobody answered* from *retried because we did
 * not like the answer* — and the second is the shape that turns a wrong package
 * name into a delay followed by the same failure, then into somebody widening
 * the predicate so it stops failing.
 *
 * Every case counts **attempts**, never elapsed time: the sleep is injected and
 * records rather than waits, so this proof cannot become the slow one nobody
 * runs, and a backoff that regressed to zero would still be visible as a
 * recorded delay of zero rather than as a fast pass.
 */

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * @typedef {{ url: string, body: { package?: { name?: string, ecosystem?: string } } }} RecordedCall
 */

/** A `fetch` that answers from a script, recording every call. */
function fetcher(/** @type {(attempt: number) => Response | Error} */ answer) {
  /** @type {RecordedCall[]} */
  const calls = [];
  return {
    calls,
    impl: /** @type {typeof fetch} */ (
      async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        const outcome = answer(calls.length);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    ),
  };
}

/** One OSV answer. `json` is only read when `ok`. */
function answered(/** @type {number} */ status, /** @type {unknown} */ json) {
  return new Response(JSON.stringify(json ?? {}), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Drives `queryOsv` with a recording sleep, so attempts are counted not waited. */
async function run(/** @type {(attempt: number) => Response | Error} */ answer, overrides = {}) {
  /** @type {number[]} */
  const delays = [];
  const fake = fetcher(answer);
  /** @type {{ ok: boolean, value: import('../security/osvQuery.mjs').OsvVuln[], error: Error | null }} */
  const outcome = { ok: false, value: [], error: null };
  try {
    outcome.value = await queryOsv('mupdf', {
      fetchImpl: fake.impl,
      sleep: async (ms) => {
        delays.push(ms);
      },
      ...overrides,
    });
    outcome.ok = true;
  } catch (error) {
    outcome.error = error instanceof Error ? error : new Error(String(error));
  }
  return { ...outcome, calls: fake.calls, delays };
}

const NO_VULNS = { vulns: [] };
const ONE_VULN = { vulns: [{ id: 'CVE-2024-0001', summary: 'a summary' }] };

/** A 503 is retried, and the answer that eventually arrives is the one returned. */
{
  const result = await run((attempt) => answered(attempt < 3 ? 503 : 200, ONE_VULN));
  check(
    'a 503 is retried and the eventual answer is returned',
    result.ok === true &&
      result.calls.length === 3 &&
      Array.isArray(result.value) &&
      result.value.length === 1 &&
      result.value[0]?.id === 'CVE-2024-0001',
    `ok=${String(result.ok)} calls=${String(result.calls.length)}`,
  );
}

/** A thrown fetch is nobody answering, so it is retried too. */
{
  const result = await run((attempt) =>
    attempt < 2 ? new Error('ECONNRESET') : answered(200, ONE_VULN),
  );
  check(
    'a fetch that THREW is retried, not propagated on the first attempt',
    result.ok === true && result.calls.length === 2,
    `ok=${String(result.ok)} calls=${String(result.calls.length)}`,
  );
}

/**
 * THE CONTROL. A 404 is an answer, and answers are not retried.
 *
 * Without this every other case here passes for an adapter that retries
 * anything — which is how a wrong package name becomes a delay followed by the
 * same failure, and then a widened predicate.
 */
{
  const result = await run(() => answered(404, {}));
  check(
    'a 404 is NOT retried and is reported as itself',
    result.ok === false &&
      result.calls.length === 1 &&
      !(result.error instanceof TransientFailure) &&
      /404/u.test(String(result.error?.message)),
    `calls=${String(result.calls.length)} error=${String(result.error?.message)}`,
  );
}

/** The other half of the control: a 400 is an answer too. */
{
  const result = await run(() => answered(400, {}));
  check(
    'a 400 is NOT retried either, so the rule is about ANSWERED and not about one status',
    result.ok === false && result.calls.length === 1,
    `calls=${String(result.calls.length)}`,
  );
}

/** Exhaustion throws the last failure rather than returning an empty answer. */
{
  const result = await run(() => answered(503, {}));
  check(
    'exhausting the attempts THROWS rather than returning nothing',
    result.ok === false &&
      result.error instanceof TransientFailure &&
      result.calls.length === OSV_ATTEMPTS,
    `calls=${String(result.calls.length)} attempts=${String(OSV_ATTEMPTS)} ok=${String(result.ok)}`,
  );
}

/**
 * An empty result is an ANSWER and reaches the caller unchanged.
 *
 * Deliberately not decided here: the checker knows every watched component has a
 * published history and treats an empty result as a broken query. That
 * judgement belongs where the expectation lives, and a transport that threw on
 * it would take the decision away from the only file that can make it.
 */
{
  const result = await run(() => answered(200, NO_VULNS));
  check(
    'an empty result is returned, not retried and not thrown',
    result.ok === true && Array.isArray(result.value) && result.value.length === 0 && result.calls.length === 1,
    `ok=${String(result.ok)} calls=${String(result.calls.length)}`,
  );
}

/** The query names the package and the ecosystem the checker means. */
{
  const result = await run(() => answered(200, ONE_VULN));
  const sent = result.calls[0]?.body;
  check(
    'the request names the package and the Debian 12 ecosystem',
    sent?.package?.name === 'mupdf' && sent?.package?.ecosystem === 'Debian:12',
    `body=${JSON.stringify(sent)}`,
  );
}

/**
 * The backoff grows and starts at zero.
 *
 * Asserted as a RELATION rather than as the two millisecond values, because the
 * values are a choice and the property is that a first attempt is not delayed
 * and a later one is. A control that pinned the numbers would go red on a
 * deliberate change and stay green on a backoff that stopped growing.
 */
{
  const result = await run(() => answered(503, {}));
  check(
    'the backoff starts at zero and grows',
    osvBackoffMs(1) === 0 &&
      osvBackoffMs(3) > osvBackoffMs(2) &&
      osvBackoffMs(2) > osvBackoffMs(1) &&
      result.delays.length === OSV_ATTEMPTS - 1,
    `delays=${JSON.stringify(result.delays)}`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} osvQuery case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('osvQuery case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
