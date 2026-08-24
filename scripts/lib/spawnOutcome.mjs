// @ts-check
/**
 * What actually happened to a `spawnSync` (finding AAAA-6).
 *
 * ## The 0.0s signature is a process that never started
 *
 * WWW-2's founding observation is a full sweep printing **35 failures at 0.0
 * seconds each**, every one of which passed when run alone. That was recorded
 * with the count and the conclusion and none of the lines, and AAAA-23 asked
 * what those 35 actually printed. The answer is **nothing, and nothing could
 * have been printed**, for a reason that is in the harness rather than in the
 * evidence: `checkLocal.mjs` read `status`, `signal`, `stdout` and `stderr`,
 * and never once read `error` — the only field that says why a spawn produced
 * no process.
 *
 * Measured 2026-08-24 on the machine that produced the founding pass, by
 * timing `spawnSync` around `process.hrtime.bigint()`:
 *
 * | spawn | elapsed | status | output | renders as |
 * |---|---|---|---|---|
 * | executable absent | 3.4ms | `null` | 0 bytes | `0.0s` |
 * | cwd absent | 2.9ms | `null` | 0 bytes | `0.0s` |
 * | node ran and exited 9 | 87.7ms | `9` | 68 bytes | `0.1s` |
 *
 * So a failure to spawn renders **exactly** as those 35 did: `FAILED` at
 * `0.0s`, no diagnostic line, zero bytes.
 *
 * ## And the floor makes it more than a matching shape
 *
 * The harness prints `seconds.toFixed(1)`, so `0.0s` means **under 50ms**. The
 * cheapest possible successful spawn of node on that machine — a script whose
 * entire body is `process.exit(0)` — measured **min 116.0ms, median 129.1ms,
 * max 179.0ms over 15 runs**, and **0 of 15** came in under 50ms.
 *
 * Nothing that started node can render as `0.0s` on that machine. The 35 were
 * not processes that ran and failed; they were processes that did not exist.
 * Which errno is still unknown, and it is unknown because the field naming it
 * was discarded — so this module exists to make the next occurrence say.
 *
 * ## The branch order is a measurement, not a reading of the field names
 *
 * Node's documentation says `error` is set "if the child process failed **or
 * timed out**", and it is: a spawn killed at its timeout returns `signal:
 * 'SIGTERM'` **and** `error: ETIMEDOUT` together (measured the same day). So a
 * classifier that tested `error` first would call every timeout a
 * failure-to-spawn and quietly change the harness's reason for stopping.
 * `signal` is therefore tested first, and that ordering is load-bearing.
 *
 * ## Why the classifier is proven here and not through the harness
 *
 * `checkLocal.mjs` always spawns `process.execPath`, which exists, so the only
 * failure-to-spawn a fixture could reach is an absent `cwd` — and the harness
 * passes its own root. Tried on 2026-08-24: a first script that chdirs away and
 * removes the fixture root, so the second script's spawn has nowhere to run.
 * It does not work, and the reason is the harness being careful — `recordRow`
 * calls `mkdirSync(..., { recursive: true })` for the run log the moment that
 * first script completes, which recreates the whole chain. The second script
 * then starts normally and reports `MODULE_NOT_FOUND` in 0.1s, which is an
 * ordinary failure and not this one.
 *
 * So the classification is asserted here against synthesised `spawnSync`
 * results, and the harness's `didNotStart` branch is reached in production
 * only. That is a STATED gap and not a silent one: the branch that stops the
 * sweep has never executed anywhere, and the first machine to run it will be
 * somebody's, on the day WWW-2 recurs.
 */

/**
 * @typedef {object} SpawnOutcome
 * @property {'ran' | 'timedOut' | 'didNotStart'} kind
 * @property {number | null} exit set only for `ran`
 * @property {string | null} detail a human-readable cause for the two failures
 */

/**
 * @param {{ status: number | null, signal: NodeJS.Signals | null, error?: Error | undefined }} run
 * @returns {SpawnOutcome}
 */
export function classifySpawn(run) {
  // FIRST, because a timeout sets `error` as well — see the header.
  if (run.signal !== null && run.signal !== undefined) {
    return { kind: 'timedOut', exit: null, detail: String(run.signal) };
  }

  const error = run.error;
  if (error !== null && error !== undefined) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    return {
      kind: 'didNotStart',
      exit: null,
      detail: code === undefined ? error.message : `${code} — ${error.message}`,
    };
  }

  return { kind: 'ran', exit: run.status, detail: null };
}
