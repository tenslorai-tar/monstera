// @ts-check
/**
 * The range a stage audit is owed for, and the thresholds that say when.
 *
 * Separated from the reporting script so `check:docs` can enforce the gate
 * without running the report, and so a proof can exercise the thresholds
 * without a repository shaped to trip them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, repoRoot } from './gitScope.mjs';

const WATERMARK_PATH = 'docs/audit-watermark.json';

/**
 * What one batch has actually been, measured from this repository's own history
 * rather than picked as a round number.
 *
 * Batches 4 to 7, by commits and by files touched:
 *
 * | batch | commits | files |
 * |---|---|---|
 * | 4 | 7 | 13 |
 * | 5 | 7 | 23 |
 * | 6 | 11 | 26 |
 * | 7 | 31 | 69 |
 *
 * The threshold is the MEDIAN, not the maximum. Batch 7 is the outlier, and it
 * is the outlier this mechanism exists to stop recurring — a single stretch that
 * absorbed a licence rewrite, two ADRs, an invariant and four instrument
 * rebuilds before anything was audited. Setting the bar at 31 would enshrine the
 * one batch that was plainly too large to audit as a unit.
 *
 * Two dimensions because they fail differently: a run of small commits and a
 * single sweeping one are both past the point where the checklist can be applied
 * carefully, and neither number alone catches both.
 */
export const BATCH = { commits: 9, files: 24 };

/**
 * @typedef {{ commit: string, audited: string }} Watermark
 * @returns {Watermark}
 */
export function readWatermark(root = repoRoot()) {
  /** @type {{ commit?: unknown, audited?: unknown }} */
  const parsed = JSON.parse(readFileSync(join(root, WATERMARK_PATH), 'utf8'));

  if (typeof parsed.commit !== 'string' || !/^[0-9a-f]{7,40}$/u.test(parsed.commit)) {
    throw new Error(
      `${WATERMARK_PATH} does not name a commit. An unreadable watermark makes the unaudited ` +
        `range unknowable, and "unknown" must never be allowed to read as "empty".`,
    );
  }
  return { commit: parsed.commit, audited: `${parsed.audited ?? ''}` };
}

/**
 * The unaudited range, and whether it has grown past one batch.
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string} [options.head]
 * @returns {{
 *   watermark: string,
 *   commits: number,
 *   files: string[],
 *   proofsAdded: string[],
 *   proofsModified: string[],
 *   newScripts: string[],
 *   overBudget: string[],
 * }}
 */
export function auditScope({ root = repoRoot(), head = 'HEAD' } = {}) {
  const { commit } = readWatermark(root);

  // An unreachable watermark is a rewritten history or a bad sha, and reporting
  // an empty range for it would say "nothing to audit" — the reassuring answer.
  try {
    git(['merge-base', '--is-ancestor', commit, head], { cwd: root });
  } catch {
    throw new Error(
      `The audit watermark ${commit} is not an ancestor of ${head}. Either it names a commit that ` +
        `no longer exists, or the branch has moved sideways. Resolve it deliberately — an ` +
        `unresolvable watermark reports an empty range, which is indistinguishable from a clean one.`,
    );
  }

  const range = `${commit}..${head}`;
  const commits = Number(`${git(['rev-list', '--count', range], { cwd: root }).stdout}`.trim());

  // Added and modified are reported apart because they mean opposite things for
  // a proof. A NEW proof is coverage arriving. A MODIFIED one is a check whose
  // meaning changed, and a fix that quietly loosened it looks exactly like one
  // that corrected it — only the diff tells them apart. That column is the
  // reason this report exists in this shape.
  const status = `${git(['diff', '--name-status', range], { cwd: root }).stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [state = '', ...rest] = line.split('\t');
      return { state: `${state}`.charAt(0), path: rest.join('\t') };
    });

  const isProof = (/** @type {string} */ path) => /\.proof\.mjs$|proofs\//u.test(path);

  return {
    watermark: commit,
    commits,
    files: status.map((entry) => entry.path),
    proofsAdded: status.filter((e) => e.state === 'A' && isProof(e.path)).map((e) => e.path),
    proofsModified: status.filter((e) => e.state === 'M' && isProof(e.path)).map((e) => e.path),
    newScripts: status
      .filter((e) => e.state === 'A' && e.path.startsWith('scripts/') && !isProof(e.path))
      .map((e) => e.path),
    overBudget: [
      ...(commits > BATCH.commits ? [`${commits} commits (one batch is ${BATCH.commits})`] : []),
      ...(status.length > BATCH.files ? [`${status.length} files (one batch is ${BATCH.files})`] : []),
    ],
  };
}
