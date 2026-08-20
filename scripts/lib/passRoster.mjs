// @ts-check
/**
 * The roster of what a check actually ran, so its `ok` lines cannot outlive it.
 *
 * ## Why this exists, measured rather than reasoned
 *
 * Four scripts here accumulated failures and then, if the failure list was
 * empty, printed a **fixed block of `ok` lines and a hand-written total**.
 * Neither was derived from anything. So a deleted case left its line printing:
 * replacing one comparison in `gitleaks.proof.mjs` with `if (false)`, so it
 * could not execute at all, still printed
 *
 * ```
 *   ok  an unreadable destination is neither same nor different
 *
 * 10 provisioning cases passed.
 * ```
 *
 * and exited 0. That is the display-only defect this project bans in its UI,
 * living inside the proofs — a green check asserting something nothing checked.
 *
 * `documentConsistency.mjs` had the live instance rather than the hypothetical
 * one. Its threat-model section applies only when a threat model exists, and
 * the fixed block claimed `ok` for it either way.
 *
 * ## The shape
 *
 * A label is recorded by the section that earns it, against a mark taken when
 * that section started. Deleting a section takes its label with it, because the
 * label is an argument to the call that concludes it — there is no second list
 * to keep in step. That is the difference between a roster that is true and one
 * that is true so far.
 *
 * `ran` is what separates *passed* from *not applicable*. A section with
 * nothing to check has not verified anything, and saying so is the whole point:
 * "no problems found" and "did not look" are the same output otherwise, which
 * is audit item 4b one level up.
 */

/**
 * @typedef {{
 *   mark: () => number,
 *   record: (mark: number, label: string, ran?: boolean) => void,
 *   passed: readonly string[],
 *   skipped: readonly string[],
 *   format: (noun: string) => string,
 * }} Roster
 */

/**
 * @param {readonly string[]} failures
 *   The live failure list. Held by reference on purpose: a section that pushed
 *   a failure is reported by that failure and must not also get a line saying
 *   it passed, and comparing lengths is how the roster knows without every
 *   caller having to remember to say so.
 * @returns {Roster}
 */
export function createRoster(failures) {
  /** @type {string[]} */
  const passed = [];
  /** @type {string[]} */
  const skipped = [];

  return {
    mark: () => failures.length,

    record(mark, label, ran = true) {
      if (failures.length !== mark) return;
      (ran ? passed : skipped).push(label);
    },

    passed,
    skipped,

    format(noun) {
      return (
        `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
        skipped.map((label) => `  --  ${label} — nothing to check\n`).join('') +
        `\n${String(passed.length)} ${noun}${passed.length === 1 ? '' : 's'} passed` +
        (skipped.length > 0 ? `, ${String(skipped.length)} not applicable` : '') +
        `.\n`
      );
    },
  };
}
