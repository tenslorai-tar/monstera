// @ts-check
/**
 * Proof that trying again is bounded, fails closed, and never happens for an
 * answer (rule B2).
 *
 * ## The two directions, and the second is the one that matters
 *
 * A retry helper has an obvious property — *it tries again* — and a dangerous
 * one: **it must not try again when the other side answered**. Retrying a 404
 * or an empty result is *retrying until green*, which Rule 0 bans by name, and
 * it is indistinguishable from the useful behaviour unless a case pins it.
 *
 * So the cases are weighted toward refusal: a non-transient failure is thrown
 * after exactly ONE call, exhaustion throws the LAST failure rather than
 * returning anything, and the sleep is not taken when the first attempt works.
 *
 * `sleep` is injected, so this runs in microseconds. A proof that waited its own
 * backoff would be a slow check, and this repository has already learned what
 * happens to those.
 *
 * Usage: node scripts/proofs/retryTransient.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { TransientFailure, isTransientStatus, retryTransient } from '../lib/retryTransient.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** A recorded run: how many times the operation was called and how long it slept. */
function harness() {
  /** @type {number[]} */
  const slept = [];
  return {
    slept,
    sleep: async (/** @type {number} */ ms) => {
      slept.push(ms);
      await Promise.resolve();
    },
    delayMs: (/** @type {number} */ attempt) => attempt * 10,
  };
}

// ---------------------------------------------------------------------------
// IT TRIES AGAIN — the obvious half.
// ---------------------------------------------------------------------------
{
  const run = harness();
  let calls = 0;
  const value = await retryTransient(
    async () => {
      calls += 1;
      await Promise.resolve();
      if (calls < 3) throw new TransientFailure(`HTTP 503 on attempt ${String(calls)}`);
      return 'answered';
    },
    { attempts: 4, delayMs: run.delayMs, sleep: run.sleep },
  );

  check(
    'a transient failure is tried again, and the later answer is the answer',
    value === 'answered' && calls === 3,
    `returned ${JSON.stringify(value)} after ${String(calls)} call(s).`,
  );
  check(
    '  ...and it waited between attempts, not before the first',
    run.slept.length === 2 && run.slept[0] === 20,
    `slept ${JSON.stringify(run.slept)}. A delay before the first attempt is latency added to ` +
      `every successful call, which is the cost nobody notices until it is everywhere.`,
  );
}

{
  const run = harness();
  let calls = 0;
  const value = await retryTransient(
    async () => {
      calls += 1;
      await Promise.resolve();
      return 'first time';
    },
    { attempts: 3, delayMs: run.delayMs, sleep: run.sleep },
  );

  check(
    'CONTROL: an operation that works is called ONCE and never sleeps',
    value === 'first time' && calls === 1 && run.slept.length === 0,
    `${String(calls)} call(s), slept ${JSON.stringify(run.slept)}. Without this, "it retries" is ` +
      `satisfied by a helper that always burns every attempt — which is the same total work for ` +
      `every caller in the repository.`,
  );
}

// ---------------------------------------------------------------------------
// IT DOES NOT TRY AGAIN FOR AN ANSWER — the half that matters.
// ---------------------------------------------------------------------------
{
  const run = harness();
  let calls = 0;
  let thrown = null;
  try {
    await retryTransient(
      async () => {
        calls += 1;
        await Promise.resolve();
        throw new Error('OSV returned no advisories for mupdf');
      },
      { attempts: 5, delayMs: run.delayMs, sleep: run.sleep },
    );
  } catch (error) {
    thrown = error;
  }

  check(
    'THE CONTROL: an ordinary failure is thrown after exactly ONE call',
    calls === 1 && thrown instanceof Error && !(thrown instanceof TransientFailure),
    `${String(calls)} call(s), threw ${String(thrown)}. An empty result set and a 404 are the ` +
      `server ANSWERING, and trying again is hoping it changes its mind — the "retrying until ` +
      `green" reflex Rule 0 bans by name. This is the case that separates the helper from it.`,
  );
  check(
    '  ...and the failure reaches the caller unchanged',
    String(thrown).includes('no advisories'),
    `threw ${String(thrown)}. A wrapper here would bury the sentence the operator needs.`,
  );
  check(
    '  ...and it did not sleep on the way out',
    run.slept.length === 0,
    `slept ${JSON.stringify(run.slept)}. A refusal that costs a backoff is a refusal that gets ` +
      `reported as slowness.`,
  );
}

// ---------------------------------------------------------------------------
// IT FAILS CLOSED when the attempts run out.
// ---------------------------------------------------------------------------
{
  const run = harness();
  let calls = 0;
  let thrown = null;
  try {
    await retryTransient(
      async () => {
        calls += 1;
        await Promise.resolve();
        throw new TransientFailure(`HTTP 503 on attempt ${String(calls)}`);
      },
      { attempts: 3, delayMs: run.delayMs, sleep: run.sleep },
    );
  } catch (error) {
    thrown = error;
  }

  check(
    'exhausting the attempts THROWS, and the count is the bound it was given',
    calls === 3 && thrown instanceof TransientFailure,
    `${String(calls)} call(s), threw ${String(thrown)}. Treating exhaustion as success is the ` +
      `green tick meaning "did not look" — the exact thing the caller this was written for ` +
      `refuses to print.`,
  );
  check(
    '  ...and the LAST failure is the one reported',
    String(thrown).includes('attempt 3'),
    `threw ${String(thrown)}. The first failure is the least informative: by the third the ` +
      `operator wants to know it kept happening, not what it looked like once.`,
  );
}

// AWAITED, not called. `retryTransient` is async, so its guard REJECTS the
// returned promise rather than throwing synchronously — a `try` around an
// un-awaited call catches nothing and the rejection escapes the process. The
// first version of this case did exactly that and killed the run, which is the
// case doing its job at its own expense.
/** @type {number[]} */
const ranAnyway = [];
for (const attempts of [0, -1, 1.5]) {
  try {
    await retryTransient(async () => Promise.resolve(1), {
      attempts,
      delayMs: () => 0,
      sleep: async () => Promise.resolve(),
    });
    ranAnyway.push(attempts);
  } catch {
    // Refused, which is the property.
  }
}

check(
  'a zero or fractional attempt count is refused rather than run',
  ranAnyway.length === 0,
  `${JSON.stringify(ranAnyway)} were accepted. Zero attempts is a call that never happens, and ` +
    `it would report the operation's ABSENCE as its failure — the could-not-look-versus-looked ` +
    `distinction this repository draws everywhere else.`,
);

// ---------------------------------------------------------------------------
// WHICH STATUSES MEAN NOBODY ANSWERED.
// ---------------------------------------------------------------------------
check(
  'a 5xx and a 429 are transient',
  [500, 502, 503, 504, 429].every((status) => isTransientStatus(status)),
  `${JSON.stringify([500, 502, 503, 504, 429].filter((s) => !isTransientStatus(s)))} were not ` +
    `treated as transient. 503 is the one that reddened main; 429 is included because being told ` +
    `to slow down is not being told the thing does not exist.`,
);

check(
  'CONTROL: a 404, a 403 and a 200 are NOT',
  [200, 400, 403, 404].every((status) => !isTransientStatus(status)),
  `${JSON.stringify([200, 400, 403, 404].filter((s) => isTransientStatus(s)))} were treated as ` +
    `transient. A 404 retried three times is a wrong package name that takes three times as long ` +
    `to report — and this is the case that stops the predicate being widened until everything ` +
    `is worth another go.`,
);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} retryTransient case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('retryTransient case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
