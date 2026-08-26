// @ts-check
/**
 * Proves the board reader can tell "not yet" apart from "cannot see".
 *
 * ## Why this proof exists at all
 *
 * The instrument it covers failed twice in one day and both times printed the
 * reassuring answer. That is audit item 4b's shape with the roles swapped: for a
 * SEARCH the comfortable output is *"found nothing"*, and for a WAITER it is
 * *"not yet"*. Both are what a broken lookup produces.
 *
 * ## Which cases are load-bearing
 *
 * Case `stale`, and it is here because a positive control cannot catch what it
 * covers. Every other failure below is caught by requiring the anchor to be
 * present; a **cached payload contains the anchor too**, so it passes that check
 * and is still wrong. It is separated by freshness instead — a status that moved
 * backwards — and without this case the module's `seen` bookkeeping could be
 * deleted with every other case still green.
 *
 * Case `zero runs`, for the opposite reason: it is the one input where doing
 * nothing looks most reasonable. `[]` is a legal array and reads as an empty
 * board; it is refused, because for this repository it means the query is wrong.
 *
 * ## No network
 *
 * Every fixture is a literal here. Fetching lives in `scripts/ci/board.mjs` and
 * is not exercised by this proof — a proof that reached github.com would be a
 * third instance of the open finding about checks depending on a live third
 * party, and it would land in CI where the other two do not.
 *
 * Usage: node scripts/lib/boardStatus.proof.mjs
 */

import { boardVerdict, parseRuns, pollDelaySeconds } from './boardStatus.mjs';
import { createRoster } from './passRoster.mjs';
import { formatError } from './reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 21 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const MINE = 'a3f4225464391ebd05f8acf300aafcfa554b29e7';
const OTHER = '71e7bd9ef5b7a789a3a4019611eaf108925c7823';

/**
 * One run, shaped as the API returns it.
 *
 * @param {{ sha?: string, name?: string, runNumber?: number, status?: string, conclusion?: string | null }} over
 * @returns {Record<string, unknown>}
 */
function run(over = {}) {
  return {
    head_sha: over.sha ?? MINE,
    name: over.name ?? 'Guards',
    run_number: over.runNumber ?? 161,
    status: over.status ?? 'completed',
    conclusion: over.conclusion === undefined ? 'success' : over.conclusion,
  };
}

/** @param {Record<string, unknown>[]} runs */
function payload(runs) {
  return { workflow_runs: runs };
}

/** Both workflows at MINE, both finished. */
const bothDone = payload([
  run({ name: 'Guards', runNumber: 161 }),
  run({ name: 'CI', runNumber: 155 }),
  run({ sha: OTHER, name: 'Guards', runNumber: 160 }),
  run({ sha: OTHER, name: 'CI', runNumber: 154 }),
]);

/** Guards finished, CI still running. */
const halfDone = payload([
  run({ name: 'Guards', runNumber: 161 }),
  run({ name: 'CI', runNumber: 155, status: 'in_progress', conclusion: null }),
]);

check(
  'both workflows completed reads as COMPLETE',
  boardVerdict(bothDone, { sha: MINE }).verdict === 'complete',
  `got ${boardVerdict(bothDone, { sha: MINE }).verdict}. Two rows for the pushed sha, both ` +
    `completed, is the only state that means the board has answered.`,
);

check(
  'one still running reads as PENDING, not complete',
  boardVerdict(halfDone, { sha: MINE }).verdict === 'pending',
  `got ${boardVerdict(halfDone, { sha: MINE }).verdict}. The concurrency group cancels an ` +
    `IN-PROGRESS run when the next push lands, so treating a started run as an answer is how a ` +
    `commit ends up with a cancelled verdict instead of one.`,
);

// The failure that started this. `?head_sha=` and a short sha silently return
// nothing, and so does querying before the runs register.
check(
  'a sha with no runs reads as BLIND, never as pending',
  boardVerdict(payload([run({ sha: OTHER }), run({ sha: OTHER, name: 'CI' })]), {
    sha: MINE,
  }).verdict === 'blind',
  'zero rows for the pushed sha is a broken lookup. Reporting it as "not started" is the ' +
    'defect this module was built after: a wrong sha, an unreachable API and a push that never ' +
    'landed all produce it.',
);

check(
  'ONE row where two were expected is BLIND, not half-done',
  boardVerdict(payload([run({ name: 'Guards' })]), { sha: MINE }).verdict === 'blind',
  'a page that does not reach far enough truncates the second workflow, and one row of two ' +
    'looks exactly like "the other has not started". The count is the control.',
);

// -----------------------------------------------------------------------------
// THE CASE A POSITIVE CONTROL CANNOT COVER.
//
// A cached payload carries the anchor. Presence is satisfied; the answer is
// still wrong. Only freshness separates it, and status never moves backwards.
// -----------------------------------------------------------------------------
{
  /** @type {Map<number, number>} */
  const seen = new Map();
  const first = boardVerdict(bothDone, { sha: MINE, seen });
  const cached = boardVerdict(halfDone, { sha: MINE, seen });

  check(
    'a payload showing a completed run as in_progress reads as STALE',
    first.verdict === 'complete' && cached.verdict === 'stale',
    `first=${first.verdict}, second=${cached.verdict}. A cache serving a response from before ` +
      `the run finished contains the sha, passes every presence check, and reports "not yet". ` +
      `Status is monotonic, so a regression is the one signal that separates a stale copy from ` +
      `a slow run.`,
  );

  check(
    'CONTROL: without the earlier observation the same payload is merely PENDING',
    boardVerdict(halfDone, { sha: MINE, seen: new Map() }).verdict === 'pending',
    'the stale verdict must come from the REGRESSION and not from the payload itself, or the ' +
      'case above is satisfied by any in-progress board and proves nothing about freshness.',
  );
}

check(
  'zero runs THROWS rather than reading as an empty board',
  (() => {
    try {
      parseRuns(payload([]));
      return false;
    } catch {
      return true;
    }
  })(),
  'an empty intermediate result is a broken parse, not a clean input. `[]` is a legal array ' +
    'and reads as "nothing has run", which for this repository is never true.',
);

check(
  'an error body with no workflow_runs THROWS',
  (() => {
    try {
      parseRuns({ message: 'API rate limit exceeded', documentation_url: 'https://…' });
      return false;
    } catch {
      return true;
    }
  })(),
  'a rate-limit body parses as an object perfectly well and carries no runs. Scoring it would ' +
    'report an empty board for a request that was refused.',
);

check(
  'a run missing `status` THROWS rather than being scored',
  (() => {
    const broken = run();
    delete broken['status'];
    try {
      parseRuns(payload([broken]));
      return false;
    } catch {
      return true;
    }
  })(),
  'the previous instrument matched a three-line window against a field five lines away and ' +
    'read every run as unfinished. A payload missing the field a verdict comes from must not ' +
    'produce a verdict.',
);

check(
  'an unrecognised status reads as BLIND, not as unfinished',
  boardVerdict(
    payload([run({ status: 'hibernating', conclusion: null }), run({ name: 'CI' })]),
    { sha: MINE },
  ).verdict === 'blind',
  'ranking an unknown status as "not finished" waits forever and looks like a slow run. If ' +
    'GitHub adds a state, this says so on the first poll instead of on the tenth minute.',
);

// -----------------------------------------------------------------------------
// GREENNESS, and these cases exist because the first version got it wrong in the
// one way this instrument was built to prevent.
//
// `board.mjs` decided greenness by substring-matching its own rendered summary:
// `reason.includes('=success') && !reason.includes('=failure')`. Measured on the
// real strings, that called `CI=cancelled, Guards=success` GREEN — 9292d1f's
// exact state, and the reason this module exists. `timed_out` and `skipped`
// passed too; only the literal `failure` did not.
//
// The first case below is therefore not a hypothetical: it is a regression test
// for a defect that shipped.
// -----------------------------------------------------------------------------
check(
  'a CANCELLED run is not green, even beside a successful one',
  boardVerdict(
    payload([
      run({ name: 'CI', runNumber: 155, conclusion: 'cancelled' }),
      run({ name: 'Guards', runNumber: 161, conclusion: 'success' }),
    ]),
    { sha: MINE },
  ).green === false,
  'This is 9292d1f: CI cancelled by the next push, Guards green. The predicate this replaces ' +
    'reported GREEN for it — the concurrency-group cancellation this whole module was written ' +
    'after, passed off as an answer.',
);

// `success` BESIDE the bad conclusion, deliberately. The first draft of this
// case paired `timed_out` with `skipped`, and the replaced predicate answers
// that one correctly — no `=success` anywhere, so it reports not-green for the
// wrong reason. A case that agrees with the bug it is guarding against
// separates nothing, which is audit item 4's direction rule applied to a
// FIXTURE rather than to a mutation.
check(
  'nor is a timed-out one beside a success',
  boardVerdict(
    payload([
      run({ name: 'CI', runNumber: 155, conclusion: 'timed_out' }),
      run({ name: 'Guards', runNumber: 161, conclusion: 'success' }),
    ]),
    { sha: MINE },
  ).green === false,
  'Greenness is equality against ONE conclusion, not absence of a bad one. An allowlist of ' +
    'one cannot acquire a hole when GitHub adds a conclusion; a denylist acquires one silently.',
);

check(
  'CONTROL: two successes ARE green',
  boardVerdict(bothDone, { sha: MINE }).green === true,
  'without this the cases above are satisfied by a predicate that reports nothing green, ' +
    'which is the direction rule from audit item 4 — mutate towards the answer the bug also ' +
    'produces, and check the other one too.',
);

check(
  'a verdict that could not be read is never green',
  boardVerdict(payload([run({ sha: OTHER }), run({ sha: OTHER, name: 'CI' })]), { sha: MINE })
    .green === false &&
    boardVerdict(halfDone, { sha: MINE }).green === false,
  'BLIND and PENDING must both report green:false. An answer nobody could read is not a ' +
    'passing one, and a caller that checks `green` without checking `verdict` must not be ' +
    'handed `true` by a board it never saw.',
);

check(
  'an empty sha is refused rather than matching everything',
  (() => {
    try {
      boardVerdict(bothDone, { sha: '' });
      return false;
    } catch {
      return true;
    }
  })(),
  '`startsWith("")` is true of every run, so an unset sha would match the whole page and ' +
    'report the newest unrelated commit as the answer.',
);

// ---------------------------------------------------------------------------
// THE POLL PACING (finding DDDD-28), and item 4a first: an instrument that
// cannot tell two durations apart reports the number somebody hoped for.
// ---------------------------------------------------------------------------
{
  /** @param {number} startedMs @param {number} durationMs */
  const timed = (startedMs, durationMs, over = {}) => ({
    ...run({ ...over, sha: OTHER }),
    created_at: new Date(startedMs).toISOString(),
    updated_at: new Date(startedMs + durationMs).toISOString(),
  });

  const NOW = Date.parse('2026-08-26T12:00:00Z');
  /** @param {Record<string, unknown>[]} rows */
  const pace = (rows, nowMs = NOW) =>
    pollDelaySeconds(parseRuns(payload(rows)), { sha: MINE, nowMs, fallbackSeconds: 30 });

  const fast = pace([timed(NOW - 900_000, 300_000), timed(NOW - 900_000, 300_000)]);
  const slow = pace([timed(NOW - 900_000, 600_000), timed(NOW - 900_000, 600_000)]);
  check(
    'RESOLUTION TEST: two payloads whose runs took different times give different waits',
    fast.seconds === 300 && slow.seconds === 600,
    `fast=${String(fast.seconds)} slow=${String(slow.seconds)}. An instrument that cannot ` +
      `separate a five-minute run from a ten-minute one reports whatever constant it was going ` +
      `to report anyway, and the wait it produces is not derived from anything.`,
  );

  const elapsed = pace(
    [
      timed(NOW - 900_000, 300_000),
      timed(NOW - 900_000, 300_000),
      { ...run({ status: 'in_progress', conclusion: null }), created_at: new Date(NOW - 200_000).toISOString() },
    ],
  );
  check(
    'the wait SUBTRACTS how long this sha has already been running',
    elapsed.seconds === 100,
    `seconds=${String(elapsed.seconds)}, expected 100 — a 300s median minus 200s already ` +
      `elapsed. Without this the reader waits a full run length after the run is nearly done, ` +
      `which is the delay this pacing exists to avoid rather than to introduce.`,
  );

  const overdue = pace([
    timed(NOW - 900_000, 300_000),
    timed(NOW - 900_000, 300_000),
    { ...run({ status: 'in_progress', conclusion: null }), created_at: new Date(NOW - 900_000).toISOString() },
  ]);
  check(
    'CONTROL: a sha already older than the median polls NOW rather than waiting',
    overdue.seconds === 0,
    `seconds=${String(overdue.seconds)}. The lower clamp, and the case that separates ` +
      `"subtract the elapsed time" from "wait the median regardless".`,
  );

  const skewed = pace(
    [timed(NOW - 900_000, 300_000), timed(NOW - 900_000, 300_000),
      { ...run({ status: 'in_progress', conclusion: null }), created_at: new Date(NOW + 600_000).toISOString() }],
  );
  check(
    'CONTROL: a createdAt in the FUTURE cannot produce a wait longer than the median',
    skewed.seconds === 300,
    `seconds=${String(skewed.seconds)}. Clock skew between this machine and GitHub is the ` +
      `ordinary cause, and the upper clamp is the median rather than a chosen multiple of it: ` +
      `never wait longer than a typical run took.`,
  );

  const noTimes = pace([run(), run({ name: 'CI' })]);
  check(
    'THE FALLBACK: with no readable timestamps it returns the caller’s own cadence',
    noTimes.seconds === 30 && noTimes.derivedFrom === 0 && noTimes.medianSeconds === null,
    `seconds=${String(noTimes.seconds)} derivedFrom=${String(noTimes.derivedFrom)}. The ` +
      `failure direction is MORE REQUESTS, never a longer wait — a pacing bug that delays a ` +
      `verdict is worse than one that spends a poll, and \`derivedFrom: 0\` is how a caller ` +
      `tells "derived" from "could not derive" rather than reading it off the number.`,
  );

  const running = pace([
    { ...run({ status: 'in_progress', conclusion: null, sha: OTHER }), created_at: new Date(NOW - 900_000).toISOString(), updated_at: new Date(NOW - 300_000).toISOString() },
    { ...run({ status: 'in_progress', conclusion: null, sha: OTHER }), created_at: new Date(NOW - 900_000).toISOString(), updated_at: new Date(NOW - 300_000).toISOString() },
  ]);
  check(
    'CONTROL: an UNFINISHED run contributes no duration, so it cannot shorten the wait',
    running.derivedFrom === 0 && running.seconds === 30,
    `derivedFrom=${String(running.derivedFrom)} seconds=${String(running.seconds)}. ` +
      `\`updated_at\` moves while a run is in progress, so counting one would measure how long ` +
      `ago it was last touched and call it a duration — a number that reads like a measurement ` +
      `and is not one.`,
  );
}

// ONE writer for the exit code. The first draft here had two — a `process.exitCode
// = 1` in the catch and a second assignment below it — which is the shape that
// silently swallowed a failure in `advisoryRegister.proof.mjs` an hour ago. It
// was harmless in this file because the second line only ever raised the code,
// never lowered it. Written as one assignment anyway: "harmless because of the
// order the two writers happen to run in" is not a property worth relying on.
let reportFailed = false;
try {
  process.stdout.write(
    failures.length > 0
      ? `${failures.length} board-status failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('board-status case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  reportFailed = true;
}
process.exitCode = failures.length > 0 || reportFailed ? 1 : 0;
