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
 * }} BoardRun
 */

/**
 * @typedef {'complete' | 'pending' | 'blind' | 'stale'} Verdict
 */

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
    };
  });
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
 * @returns {{ verdict: Verdict, reason: string, runs: BoardRun[] }}
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
    };
  }

  return {
    verdict: 'complete',
    reason: mine.map((run) => `${run.workflow}=${String(run.conclusion)}`).join(', '),
    runs: mine,
  };
}
