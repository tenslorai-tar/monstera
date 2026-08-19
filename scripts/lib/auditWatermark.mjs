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
 * ## The watermark never equals HEAD, and that is structural
 *
 * The commit that records an audit is written *after* the range it audits, so it
 * cannot be inside it. Advancing the watermark to HEAD in that same commit would
 * claim the recording commit had been audited by the audit it contains.
 *
 * So a gap of one or two commits after an audit is the mechanism working, not a
 * defect. Do not raise it as a finding, and do not try to close it with a
 * bookkeeping commit — that commit becomes the new tail and produces the same
 * gap again, one commit further along. The regress has to stop somewhere, and
 * the honest place is the next range: the recording commits get audited by the
 * audit that follows them.
 *
 * {@link BATCH} tolerates this by design — the thresholds are batch-sized, so a
 * two-commit tail is nowhere near them. That tolerance is deliberate rather than
 * incidental, which is why it is written down here.
 *
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
 *   proofChurn: Array<{
 *     path: string,
 *     net: { added: number, removed: number },
 *     perCommit: { added: number, removed: number },
 *   }>,
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

  return buildScope({ commit, range, commits, root });
}

/**
 * @typedef {{
 *   path: string,
 *   net: { added: number, removed: number },
 *   perCommit: { added: number, removed: number },
 * }} ProofChurn
 */

/**
 * Insertions and deletions for one path, **as the range reports them and as the
 * commits actually made them** (audit finding U-2).
 *
 * The two differ, and the difference is the whole point of measuring both. A
 * range diff shows the NET change: a line added in one commit and rewritten in a
 * later one appears as a single insertion, so the deletion is invisible.
 *
 * That matters for exactly one column. The modified-proofs column exists because
 * *a loosened check looks like a corrected one*, and it tells an auditor to read
 * each diff. Reporting the net range diff makes it **a tree-wide sweep at
 * smaller scale** — the same shape and the same blindness as the whole-tree
 * audit this project replaced, one level down. The instrument built to stop an
 * auditor trusting a clean end state was presenting a clean end state of its
 * own.
 *
 * **The blind spot's exact limit, so nobody overclaims it:** it needs an *exact
 * revert* within the range. A loosening replaced by a *different* tightening
 * still shows in the net diff, because the lines differ. That is narrow — and
 * narrow in precisely the way "the end state is clean" is narrow.
 *
 * Measured on the range that produced the finding: `contract.proof.mjs` reported
 * `+191 −0` net and `+72 −0` then `+133 −14` per commit, so fourteen deletions —
 * including a `because` matcher being re-anchored — appeared nowhere.
 *
 * @param {string} range
 * @param {string} path
 * @param {string} root
 * @returns {{ net: { added: number, removed: number }, perCommit: { added: number, removed: number } }}
 */
function churnFor(range, path, root) {
  /** @param {readonly string[]} args */
  const sum = (args) => {
    let added = 0;
    let removed = 0;
    for (const line of `${git([...args, '--', path], { cwd: root }).stdout}`.split('\n')) {
      const [a = '', r = ''] = line.trim().split('\t');
      // A binary file reports `-`, which is not zero and must not be counted as
      // zero — Number('-') is NaN, and a NaN total would print as a churn of
      // NaN rather than as a silent 0.
      if (a === '-' || r === '') continue;
      added += Number(a);
      removed += Number(r);
    }
    return { added, removed };
  };

  return {
    net: sum(['diff', '--numstat', range]),
    // `log --numstat` walks each commit, so a line added then rewritten counts
    // in both directions rather than cancelling.
    perCommit: sum(['log', '--numstat', '--format=', range]),
  };
}

/**
 * @param {{ commit: string, range: string, commits: number, root: string }} input
 * @returns {ReturnType<typeof auditScope>}
 */
function buildScope({ commit, range, commits, root }) {

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

  // A CHECK, not a file naming convention — and the distinction cost a whole
  // range. This matched `*.proof.mjs` and `proofs/` only, so it was blind to
  // every `*.test.ts` in the workspace, which is where most of this project's
  // controls actually live: §9's path assertions, the composition point's
  // ordering control, every mutation-tested pair. Measured on the range that
  // found it — 254 lines of new test carrying that range's strongest control,
  // and `boundary.test.ts` at +312/−77 changing what several controls assert —
  // reported as "proofs ADDED: none" with nothing in the MODIFIED column.
  //
  // That is item 4b exactly: the output is "found nothing", and an auditor
  // cannot tell it from "there was nothing to find". It is also the column this
  // report calls load-bearing, so its blind spot was the report's own subject.
  //
  // `scripts/` keeps a second door because a proof there need not be named
  // `.proof.mjs` if it sits under `proofs/`.
  const isProof = (/** @type {string} */ path) =>
    /\.proof\.mjs$|proofs\/|\.test\.[cm]?tsx?$|\.test\.[cm]?jsx?$/u.test(path);

  const modified = status.filter((e) => e.state === 'M' && isProof(e.path)).map((e) => e.path);

  return {
    watermark: commit,
    commits,
    files: status.map((entry) => entry.path),
    proofsAdded: status.filter((e) => e.state === 'A' && isProof(e.path)).map((e) => e.path),
    proofsModified: modified,
    proofChurn: modified.map((path) => ({ path, ...churnFor(range, path, root) })),
    newScripts: status
      .filter((e) => e.state === 'A' && e.path.startsWith('scripts/') && !isProof(e.path))
      .map((e) => e.path),
    overBudget: [
      ...(commits > BATCH.commits ? [`${commits} commits (one batch is ${BATCH.commits})`] : []),
      ...(status.length > BATCH.files ? [`${status.length} files (one batch is ${BATCH.files})`] : []),
    ],
  };
}
