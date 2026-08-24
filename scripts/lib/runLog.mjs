// @ts-check
/**
 * The run log's naming rule and its retention rule (findings AAAA-25, AAAA-29).
 *
 * ## Why this is a module and not eight lines inside the harness
 *
 * It was those eight lines, and they could not be asserted: `checkLocal.mjs` is
 * a top-level script that runs a sweep on import, so a proof cannot reach any
 * function inside it without starting one. The retention rule is therefore the
 * half of the run log that nothing could look at — while the half a proof CAN
 * reach, the refusal text, has five cases on it.
 *
 * That is AAAA-29's shape one layer down: an audit answered *nothing here runs
 * in CI* about an area where three proofs did, and the genuinely uncovered part
 * turned out to be the run-log FILES. This is the first of the three closable
 * pieces — a decision over a directory listing, which needs no processes, no
 * temporary repository and no kill to assert.
 *
 * ## The rule
 *
 * A run's state is in its FILENAME, because a run this harness killed can never
 * write anything again — not a status field, not a closing brace. `-running` is
 * therefore not a transient state but the permanent record of a run that did
 * not finish, and it is what makes the killed run self-identifying in a
 * listing.
 *
 * Retention follows from what each state is worth: `-ok` runs are ordinary and
 * the newest few are enough, while anything that failed or never finished is
 * EVIDENCE and is kept on its own, much longer budget. An unrecognised name
 * counts as evidence, which is the fail-safe direction — this prunes files, and
 * a name it cannot classify is the last one to delete on a guess.
 *
 * ## The count is arithmetic, not a negative slice
 *
 * `list.slice(0, -keep)` reads as "all but the newest `keep`" and is wrong at
 * `keep === 0`: `-0` is `0`, so `slice(0, 0)` returns nothing and a caller
 * asking to keep NONE keeps everything. The inline version had that shape and
 * was safe only because its one caller passed a literal 5. A pure function
 * takes the number from whoever calls it, so the expression is written as the
 * subtraction it actually is.
 */

/** Newest `-ok` logs to keep. Ordinary green runs; the last few are plenty. */
export const KEEP_OK = 5;

/** A bound on the evidence, so a repeatedly failing sweep cannot fill the cache. */
export const KEEP_EVIDENCE = 40;

/** @typedef {'running' | 'ok' | 'failed'} RunLogState */

/**
 * The one place a run log's name is composed.
 *
 * @param {string} stamp
 * @param {RunLogState} state
 * @returns {string}
 */
export function runLogName(stamp, state) {
  return `${stamp}-${state}.json`;
}

/**
 * The one place a run log's name is READ, so the composer above cannot acquire
 * a second opinion about what it wrote (B3a).
 *
 * @param {string} name
 * @returns {RunLogState | null} null for a name this does not recognise
 */
export function runLogState(name) {
  for (const state of /** @type {RunLogState[]} */ (['running', 'ok', 'failed'])) {
    if (name.endsWith(`-${state}.json`)) return state;
  }
  return null;
}

/**
 * Anything that is not a completed green run, INCLUDING a name this cannot
 * classify. See the fail-safe note in the header.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isEvidence(name) {
  return runLogState(name) !== 'ok';
}

/**
 * Split a directory listing into what survives and what is pruned.
 *
 * Returns both sides rather than the removals alone. Deleting nothing is what
 * every broken version of this produces — a suffix that matches nothing, a
 * listing that arrived empty, a sort that put the newest first — and all of
 * them look like "there was nothing to prune" (item 4b). A caller, and a proof,
 * can only tell those apart by seeing which files were kept.
 *
 * @param {readonly string[]} entries a directory listing, any order
 * @param {{ keepOk?: number, keepEvidence?: number }} [budget]
 * @returns {{ keep: string[], remove: string[] }}
 */
export function retention(entries, budget = {}) {
  const { keepOk = KEEP_OK, keepEvidence = KEEP_EVIDENCE } = budget;

  // Timestamp-prefixed, so a lexical sort is chronological and the TAIL is the
  // newest. The pid suffix disambiguates two runs inside one second and orders
  // them arbitrarily, which is the only ordering available and does not matter:
  // both are the same age to the second.
  const logs = [...entries].filter((name) => name.endsWith('.json')).sort();
  const ok = logs.filter((name) => !isEvidence(name));
  const evidence = logs.filter((name) => isEvidence(name));

  const remove = [
    ...ok.slice(0, Math.max(0, ok.length - keepOk)),
    ...evidence.slice(0, Math.max(0, evidence.length - keepEvidence)),
  ];
  const removed = new Set(remove);
  return { keep: logs.filter((name) => !removed.has(name)), remove };
}
