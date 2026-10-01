// @ts-check
/**
 * The commit range Guards' history file policy scans: what this change
 * introduces, and nothing older.
 *
 * ## The rule, in the order it is applied
 *
 * 1. **A pull request** scans `base..sha`. The base is the event's own answer.
 * 2. **A push with a previous tip** scans `before..sha`.
 * 3. **A push with NO previous tip** scans `merge-base(origin/<default>, sha)..sha`.
 *
 * Case 3 is two payload shapes, and both reached git as a range it either
 * refuses or answers with nothing:
 *
 * - A push that CREATES the ref has no previous tip, so GitHub sends forty
 *   zeros as `before`. `git rev-list 0000…0..sha` exits 128 with *Invalid
 *   revision range*: the first push of every `work/**` branch went red here and
 *   skipped the secret scan after it (Guards run 36873944916, 2026-10-01, on
 *   `0000…0..82411944`).
 * - `workflow_dispatch` carries no `before` at all. The step then built
 *   `..sha`, which git reads as `HEAD..sha`; the checkout's HEAD IS that sha, so
 *   the range is empty, the scan reads no blob, and it prints *Guard passed*.
 *   That one was green, which is worse: a scan of nothing reporting success.
 *
 * So the test is on the value git is handed, not on a payload field that
 * correlates with it (`created` is true for the first shape and absent for the
 * second). What a branch with no previous tip introduces is what is not on the
 * default branch, and the merge base is where it left it.
 *
 * ## Why this is a module rather than shell in the workflow
 *
 * The step's three branches were inline `if` arms over `${{ }}` substitutions,
 * which nothing can run outside a hosted runner: the zero shape only occurs on
 * the first push of a branch, so a fix to it could not be exercised by the push
 * that carried it. Here the choice is a function a proof calls with each
 * payload shape, against a real repository.
 *
 * An empty merge base is refused rather than returned. `..sha` is exactly the
 * vacuous range case 3 exists to replace, so a lookup that found nothing must
 * not be allowed to look like an answer (audit item 4b's corollary).
 *
 * Usage (from the workflow, with the payload passed through the environment so
 * no event text is interpolated into the shell):
 *
 *   PULL_REQUEST_BASE=… BEFORE=… SHA=… DEFAULT_BRANCH=… node scripts/ci/historyRange.mjs
 *
 * Prints the range on stdout and the rule that chose it on stderr.
 */

import { git } from '../lib/gitScope.mjs';
import { isMain } from '../lib/isMain.mjs';

/**
 * A previous tip that is not one: absent, empty, or git's all-zero null object
 * id (forty zeros for SHA-1, sixty-four for SHA-256).
 *
 * @param {string | undefined} before
 * @returns {boolean}
 */
export function hasNoPreviousTip(before) {
  return before === undefined || before.trim() === '' || /^0+$/.test(before.trim());
}

/**
 * @typedef {{
 *   pullRequestBase?: string | undefined,
 *   before?: string | undefined,
 *   sha: string,
 *   defaultBranch?: string | undefined,
 *   cwd?: string,
 * }} RangeInput
 *   `undefined` is a value each field is read as, not only an omission: an
 *   unset environment variable arrives as one, and historyRange handles each.
 */

/**
 * @param {RangeInput} input
 * @returns {{ range: string, rule: 'pull request' | 'previous tip' | 'merge base' }}
 */
export function historyRange({ pullRequestBase, before, sha, defaultBranch, cwd }) {
  if (sha.trim() === '') {
    throw new Error('historyRange needs the sha being checked; SHA was empty.');
  }

  if (pullRequestBase !== undefined && pullRequestBase.trim() !== '') {
    return { range: `${pullRequestBase.trim()}..${sha}`, rule: 'pull request' };
  }

  if (!hasNoPreviousTip(before)) {
    return { range: `${String(before).trim()}..${sha}`, rule: 'previous tip' };
  }

  if (defaultBranch === undefined || defaultBranch.trim() === '') {
    throw new Error(
      'This push has no previous tip, so the range starts at the merge base with the ' +
        'default branch, and DEFAULT_BRANCH was empty. Refusing rather than guessing a name.',
    );
  }

  const options = cwd === undefined ? {} : { cwd };
  const base = `${git(['merge-base', `origin/${defaultBranch.trim()}`, sha], options).stdout}`.trim();
  if (base === '') {
    throw new Error(
      `git merge-base origin/${defaultBranch.trim()} ${sha} printed nothing. An empty base ` +
        `would make the range "..${sha}", which scans no blob and passes.`,
    );
  }
  return { range: `${base}..${sha}`, rule: 'merge base' };
}

if (isMain(import.meta.url)) {
  const { range, rule } = historyRange({
    pullRequestBase: process.env['PULL_REQUEST_BASE'],
    before: process.env['BEFORE'],
    sha: process.env['SHA'] ?? '',
    defaultBranch: process.env['DEFAULT_BRANCH'],
  });
  process.stderr.write(`History range ${range} (${rule}).\n`);
  process.stdout.write(`${range}\n`);
}
