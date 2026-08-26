// @ts-check
/**
 * Decides what a GitHub Actions runs payload says about one commit.
 *
 * ## Why this is a tracked module and not a shell one-liner
 *
 * The thing that answers *"is `main` green?"* failed twice in one day, three
 * different ways, and every failure printed **"not yet"**:
 *
 *   - a query keyed on a SHORT sha, against a field that carries full ones —
 *     zero runs, indistinguishable from a push that has not registered;
 *   - `grep -A3` for `status` against a payload where `status` sits FIVE lines
 *     below `head_sha` — structurally pinned at zero for a completed run, a
 *     queued run, a cancelled run and a repository that does not exist;
 *   - an HTTP cache serving a response that predated two pushes, which read
 *     exactly like a current board with those commits not yet made.
 *
 * For a waiter, **"not yet" is the reassuring answer** — the same role
 * *"found nothing"* plays for a search (audit item 4b). So the same rule
 * applies: it is not finished until it must locate something known-present on
 * every poll, and that control lives HERE rather than only in the proof,
 * because the proof runs in CI and this gets run by hand on the day someone
 * needs an answer.
 *
 * ## Presence is not enough, and this is where 4b's own remedy runs out
 *
 * A cached payload contains the known-present anchor too. The positive control
 * passes and the answer is still wrong — the one failure in the list above that
 * *"locate something you know is there"* cannot catch.
 *
 * So staleness needs a different assertion: **freshness, not presence.** Two
 * markers, both monotonic, both chosen because they can only move one way:
 *
 *   - the caller asks about a sha it JUST PUSHED. A payload older than that push
 *     cannot contain it, so requiring the sha is a freshness test rather than an
 *     existence test — provided the anchor is the thing you just did, and not
 *     something that was already true before you acted.
 *   - a run's status never goes backwards. `completed` does not become
 *     `in_progress`. A payload that shows a regression against what this caller
 *     has already seen is a stale copy, and is reported as **STALE** rather than
 *     as *not yet* — which is the whole point, because those two are the same
 *     output otherwise.
 *
 * ## No network here, deliberately
 *
 * Fetching lives in `scripts/ci/board.mjs`. This module takes a payload and
 * returns a verdict, so its proof runs over recorded fixtures and makes no live
 * request. A proof that reached github.com would be a third instance of the
 * open finding about checks depending on a live third party, landing in CI.
 */

/**
 * @typedef {{
 *   sha: string,
 *   workflow: string,
 *   runNumber: number,
 *   status: string,
 *   conclusion: string | null,
 *   createdAt: number | null,
 *   completedAt: number | null,
 * }} BoardRun
 *
 * `createdAt` and `completedAt` are epoch milliseconds and are `null` where the
 * payload did not carry a readable timestamp. **No verdict reads them** — only
 * {@link pollDelaySeconds} does, which is why they may be absent without making
 * a run unscoreable.
 */

/**
 * @typedef {'complete' | 'pending' | 'blind' | 'stale'} Verdict
 */

/**
 * The only conclusion that means the board answered YES.
 *
 * Every other value GitHub can report — `cancelled`, `timed_out`, `skipped`,
 * `action_required`, `neutral`, `stale`, and whatever it adds next — is not a
 * pass, and the list is deliberately not enumerated: an allowlist of one cannot
 * acquire a hole when the set of conclusions grows.
 *
 * This exists because the first version did NOT do it this way, and the defect
 * is the exact one this instrument was built to prevent. `board.mjs` decided
 * greenness by substring-matching its own human-readable summary —
 * `reason.includes('=success') && !reason.includes('=failure')` — so any
 * conclusion other than the literal `failure` counted as harmless. Measured on
 * the real strings:
 *
 * ```
 * GREEN      CI=cancelled, Guards=success   <- 9292d1f's exact shape
 * GREEN      CI=timed_out, Guards=success
 * GREEN      CI=skipped,   Guards=success
 * NOT GREEN  CI=failure,   Guards=success
 * ```
 *
 * A cancelled CI run is what this whole module was written after. The instrument
 * would have called it green.
 *
 * Two mechanisms, and the second is why it is here rather than in the shell:
 * greenness is now DERIVED FROM THE DATA rather than from a rendering of it, and
 * it lives in the module that has a proof. The shell prints what it is handed.
 */
const PASSING_CONCLUSION = 'success';

/**
 * How far along a run is. Ranked so a REGRESSION is detectable; the numbers
 * carry no meaning beyond their order.
 *
 * An unrecognised status is not ranked low — it is refused. A status this does
 * not understand means either the parse is wrong or GitHub changed the contract,
 * and ranking it as "not finished yet" would turn both into an indefinite wait
 * that looks exactly like a slow run.
 *
 * @type {Readonly<Record<string, number>>}
 */
const PROGRESS = Object.freeze({
  requested: 1,
  queued: 1,
  waiting: 1,
  pending: 1,
  in_progress: 2,
  completed: 3,
});

/**
 * Reads the runs out of a payload.
 *
 * Throws rather than returning `[]` on anything it cannot read. An empty
 * intermediate result is a broken parse, not a clean input — every caller below
 * would otherwise treat "I could not read this" as "there are no runs", which is
 * the failure this whole module exists about.
 *
 * @param {unknown} payload The decoded body of `/actions/runs`.
 * @returns {BoardRun[]}
 */
export function parseRuns(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new Error(
      `The runs payload is ${payload === null ? 'null' : typeof payload}, not an object. ` +
        `Nothing can be concluded from it — least of all "no runs yet".`,
    );
  }

  const runs = /** @type {{ workflow_runs?: unknown }} */ (payload).workflow_runs;
  if (!Array.isArray(runs)) {
    throw new Error(
      `The runs payload has no \`workflow_runs\` array (got ${typeof runs}). A rate-limit or ` +
        `error body parses as an object perfectly well and carries no runs, which is why this ` +
        `refuses instead of reporting an empty board.`,
    );
  }
  if (runs.length === 0) {
    throw new Error(
      `The runs payload lists zero runs. For this repository that is not a state that occurs — ` +
        `it means the query, the URL or the credentials are wrong. Reported as a fault rather ` +
        `than as "nothing has started yet" (audit item 4b's corollary).`,
    );
  }

  return runs.map((entry, index) => {
    const row = /** @type {Record<string, unknown>} */ (entry ?? {});
    for (const field of /** @type {const} */ (['head_sha', 'name', 'run_number', 'status'])) {
      if (row[field] === undefined) {
        throw new Error(
          `Run ${String(index)} has no \`${field}\`. A payload missing the field a verdict is ` +
            `read from must not be scored — the previous version of this instrument matched a ` +
            `three-line window against a field five lines away and reported "not yet" forever.`,
        );
      }
    }
    return {
      sha: String(row['head_sha']),
      workflow: String(row['name']),
      runNumber: Number(row['run_number']),
      status: String(row['status']),
      conclusion: row['conclusion'] === null ? null : String(row['conclusion']),
      // TIMESTAMPS ARE OPTIONAL AND THE REQUIRED-FIELD CHECK ABOVE DOES NOT
      // COVER THEM, deliberately. A verdict must never depend on them; only the
      // POLL PACING does, and that has a stated fallback. Adding them to the
      // list above would make a payload without them unverdictable, which is
      // trading the answer for the schedule.
      createdAt: epochMs(row['created_at']),
      completedAt: epochMs(row['updated_at']),
    };
  });
}

/**
 * @param {unknown} value an ISO-8601 timestamp, or anything else.
 * @returns {number | null} epoch milliseconds, or `null` where it is unreadable.
 */
function epochMs(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How long to wait before the NEXT poll, derived from the durations the
 * payload's own completed runs took (finding DDDD-28).
 *
 * ## Why this is derived and not a constant
 *
 * The unauthenticated GitHub quota is ~60 requests an hour **per IP**, and both
 * seats on this machine draw on the same 60. One board read polls up to 40
 * times at 30 seconds — a twenty-minute window — while these runs finish in a
 * fraction of that, so most of a read's cost is spent asking about a run that
 * has not finished. That is the part the shared quota cannot afford, and it
 * starves the board check the reviewing seat is required to run.
 *
 * A first-wait constant would be a number nobody chose, and it would go stale as
 * CI gets slower or faster. The payload already carries the answer: every
 * completed run in it reports when it started and when it ended.
 *
 * ## What it does when it cannot derive
 *
 * Returns `fallbackSeconds` and says so in `derivedFrom: 0`. The caller then
 * polls exactly as it did before this existed — the failure direction is *more
 * requests*, never a longer wait, because a pacing bug that delays a verdict is
 * worse than one that spends a poll.
 *
 * ## Measured on its own first read, 2026-08-26
 *
 * `board.mjs --verbose` against `cb5c07f`, quoted from its trace:
 *
 * ```
 * poll 1: PENDING — 0 of 2 complete: Guards=queued, CI=in_progress
 * poll 1: waiting 545s (derived from 6 completed run(s), median 555s)
 * poll 2: COMPLETE — Guards=success, CI=success
 * ```
 *
 * **Two requests where the old cadence would have spent about nineteen** — 555
 * seconds at one poll every thirty. The verdict arrived at the same moment
 * either way; what changed is what the wait cost the shared quota.
 *
 * @param {BoardRun[]} runs
 * @param {{ sha: string, nowMs: number, fallbackSeconds: number }} options
 * @returns {{ seconds: number, derivedFrom: number, medianSeconds: number | null }}
 */
export function pollDelaySeconds(runs, { sha, nowMs, fallbackSeconds }) {
  const durations = runs
    .flatMap((run) => {
      if (run.status !== 'completed') return [];
      if (run.createdAt === null || run.completedAt === null) return [];
      const ms = run.completedAt - run.createdAt;
      return ms > 0 ? [ms] : [];
    })
    .sort((left, right) => left - right);

  if (durations.length === 0) {
    return { seconds: fallbackSeconds, derivedFrom: 0, medianSeconds: null };
  }

  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  const started = runs.flatMap((run) =>
    run.sha === sha && run.createdAt !== null ? [run.createdAt] : [],
  );
  // Nothing for this sha yet is the ordinary first-poll state, and it means the
  // run has not been created — so the full median is the right wait.
  const elapsed = started.length === 0 ? 0 : nowMs - Math.min(...started);

  // CLAMPED BETWEEN THE CALLER'S CADENCE AND THE MEDIAN.
  //
  // THE FLOOR WAS ZERO AND THAT WAS A DEFECT, measured 2026-08-26: a run that
  // outlives the median makes `median - elapsed` negative, the clamp returns
  // 0, and the caller sleeps for no time at all — so the reader polls FLAT OUT
  // exactly when a run is slowest, which is the opposite of what this function
  // is for. Observed: 40 polls exhausted in seconds, `NO VERDICT … gave up
  // after 40 polls`, and 11 of 60 shared requests left.
  //
  // The mechanism is a conflation. *How long until this run is likely done* and
  // *how long to wait before asking again* are the same number only while the
  // estimate holds. Once it is spent there is no estimate — which is the same
  // state as having no data at all, and that state already has a correct answer
  // one branch above: the caller's own cadence. So the floor is that.
  const remaining = Math.min(median, median - elapsed) / 1000;
  const seconds = Math.max(fallbackSeconds, remaining);
  return { seconds, derivedFrom: durations.length, medianSeconds: median / 1000 };
}

/**
 * What this payload says about one commit.
 *
 * @param {unknown} payload
 * @param {{
 *   sha: string,
 *   expect?: number,
 *   seen?: Map<number, number>,
 * }} options
 *   `sha` is the commit the caller just pushed — the anchor, and the freshness
 *   marker, because a payload older than that push cannot contain it. `expect`
 *   is how many runs that push should produce (one per workflow). `seen` is this
 *   caller's high-water mark per run, carried across polls; it is MUTATED, so a
 *   caller keeps one Map for the whole wait.
 * @returns {{ verdict: Verdict, reason: string, runs: BoardRun[], green: boolean }}
 *   `green` is true only for a `complete` verdict in which EVERY run concluded
 *   `success`. It is false for every other verdict, including `stale` and
 *   `blind` — an answer that could not be read is not a passing one.
 */
export function boardVerdict(payload, { sha, expect = 2, seen = new Map() }) {
  if (sha === '') throw new Error('boardVerdict needs a sha to anchor on; "" matches everything.');

  const runs = parseRuns(payload);
  const mine = runs.filter((run) => run.sha.startsWith(sha));

  // THE POSITIVE CONTROL, on every call rather than only in the proof. A wrong
  // sha, a short sha against full ones, a cache older than the push and a
  // truncated page all land here — and none of them is "not yet".
  if (mine.length !== expect) {
    return {
      verdict: 'blind',
      reason:
        `Found ${String(mine.length)} run(s) for ${sha}, expected ${String(expect)}. This is a ` +
        `BROKEN LOOKUP, not a verdict: a cache older than the push, a sha that does not match ` +
        `the field, or a page that does not reach far enough all produce it, and every one of ` +
        `them otherwise reads as "the runs have not started".`,
      runs: mine,
      green: false,
    };
  }

  const unknown = mine.filter((run) => PROGRESS[run.status] === undefined);
  if (unknown.length > 0) {
    return {
      verdict: 'blind',
      reason:
        `Status ${unknown.map((run) => `"${run.status}"`).join(', ')} is not one this understands. ` +
        `Treating it as unfinished would wait forever and look like a slow run.`,
      runs: mine,
      green: false,
    };
  }

  // FRESHNESS, which the control above cannot supply. A run's status only moves
  // forwards; a payload that shows one moving back is a stale copy, and a stale
  // copy answers every presence check correctly.
  for (const run of mine) {
    const rank = PROGRESS[run.status] ?? 0;
    const high = seen.get(run.runNumber) ?? 0;
    if (rank < high) {
      return {
        verdict: 'stale',
        reason:
          `${run.workflow} run ${String(run.runNumber)} reports "${run.status}" after this ` +
          `caller already saw it further along. Status does not go backwards, so this payload ` +
          `is older than one already read — a cached board, which passes every check that asks ` +
          `whether the anchor is PRESENT.`,
        runs: mine,
        green: false,
      };
    }
    seen.set(run.runNumber, rank);
  }

  const finished = mine.filter((run) => run.status === 'completed');
  if (finished.length !== mine.length) {
    return {
      verdict: 'pending',
      reason: `${String(finished.length)} of ${String(mine.length)} complete: ${mine
        .map((run) => `${run.workflow}=${run.status}`)
        .join(', ')}`,
      runs: mine,
      green: false,
    };
  }

  return {
    verdict: 'complete',
    reason: mine.map((run) => `${run.workflow}=${String(run.conclusion)}`).join(', '),
    runs: mine,
    // EVERY run, and equality against one value. See PASSING_CONCLUSION: the
    // predicate this replaces asked whether the rendered summary contained
    // "=success" and not "=failure", which called a cancelled run green.
    green: mine.every((run) => run.conclusion === PASSING_CONCLUSION),
  };
}
