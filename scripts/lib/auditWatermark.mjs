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

import { changedPaths, git, repoRoot } from './gitScope.mjs';

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
  return parseWatermark(readFileSync(join(root, WATERMARK_PATH), 'utf8'), WATERMARK_PATH);
}

/**
 * An immutable commit id — never a ref.
 *
 * `HEAD`, `main` and `@` all resolve as git revisions, so a watermark holding
 * one passes `merge-base --is-ancestor` and reports a zero-commit range: an
 * audit gate that permits everything, quietly. Measured on all three.
 */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/u;

/**
 * The ONE definition of a valid watermark, taken by both readers.
 *
 * There were two, and only one checked. `readWatermark` has always required
 * {@link COMMIT_SHA}; `watermarkAt` accepted any string that parsed as JSON with
 * a string `commit`. That did not matter while every path went through
 * `readWatermark` — and then {@link pendingAuditScope} began injecting the
 * watermark to fix a scope bug, which routed the gate through the reader without
 * the check. **A fail-closed became a fail-open on the path the fix created**,
 * and the two readers disagreeing is the finding rather than either one.
 *
 * Both entry points go through {@link asCommitSha}: the file readers via
 * `parseWatermark`, and the injected `watermark` parameter at its own seam.
 *
 * @param {string} value
 * @returns {string}
 */
function asCommitSha(value) {
  if (!COMMIT_SHA.test(value)) {
    throw new Error(
      `${JSON.stringify(value)} is not a commit id. A REF resolves and reports a range of zero, ` +
        `so an audit gate handed one permits every commit while looking like it measured.`,
    );
  }
  return value;
}

/**
 * @param {string} text
 * @param {string} source For the message — a path, or a `git show` argument.
 * @returns {Watermark}
 */
function parseWatermark(text, source) {
  /** @type {{ commit?: unknown, audited?: unknown }} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${source} does not name a commit: it is not readable JSON.`, { cause });
  }

  if (typeof parsed.commit !== 'string') {
    throw new Error(
      `${source} does not name a commit (found ${JSON.stringify(parsed.commit)}). An unreadable ` +
        `watermark makes the unaudited range unknowable, and "unknown" must never be allowed to ` +
        `read as "empty".`,
    );
  }
  try {
    return { commit: asCommitSha(parsed.commit), audited: `${parsed.audited ?? ''}` };
  } catch (cause) {
    throw new Error(`${source} does not name a commit.`, { cause });
  }
}

/**
 * The unaudited range, and whether it has grown past one batch.
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string} [options.head]
 * @param {boolean} [options.churn] False skips the per-proof churn figures, which
 *   cost two git invocations each and are read by the report, not by a gate.
 * @param {string} [options.watermark] The commit to measure from, when the caller
 *   already knows it from the scope its decision is about. Omitted, this reads
 *   the working tree — correct for the report, which describes the tree a human
 *   is looking at, and wrong for a gate reasoning about the index. See
 *   {@link pendingAuditScope}.
 * @returns {{
 *   watermark: string,
 *   commits: number,
 *   files: string[],
 *   proofsAdded: string[],
 *   proofsModified: string[],
 *   proofsRemoved: string[],
 *   proofChurn: Array<{
 *     path: string,
 *     net: { added: number, removed: number },
 *     perCommit: { added: number, removed: number },
 *   }>,
 *   newScripts: string[],
 *   overBudget: string[],
 * }}
 */
export function auditScope({ root = repoRoot(), head = 'HEAD', churn = true, watermark } = {}) {
  // Validated AT THE SEAM, not only by whoever injects it. There is no live
  // defect — `pendingAuditScope` is the only injector and it validates upstream
  // — and that is exactly the state this parameter's own finding started in: a
  // definition existed, and the path that bypassed it did not consult it. The
  // next injector repeats it, and on this repository's record it will be
  // introduced by a fix.
  const commit = watermark === undefined ? readWatermark(root).commit : asCommitSha(watermark);

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

  return buildScope({ commit, range, commits, root, churn });
}

/**
 * The watermark recorded in one tree-ish, or `null` if it cannot be read there.
 *
 * `:path` is the index entry, which exists for any tracked file whether or not
 * this commit changes it — so the two calls below compare "what this commit will
 * record" against "what is recorded now".
 *
 * @param {string} root
 * @param {'HEAD:' | ':'} ref The `git show` prefix, colon included — `HEAD:` for
 *   the last commit, `:` for the index.
 * @returns {string | null}
 */
function watermarkAt(root, ref) {
  /** @type {string} */
  let text;
  try {
    text = `${git(['show', `${ref}${WATERMARK_PATH}`], { cwd: root }).stdout}`;
  } catch {
    // NOT TRACKED IN THIS SCOPE, which is the only thing `null` may mean. The
    // bare catch here used to cover the parse as well, so a watermark that was
    // present and invalid was indistinguishable from one that was absent —
    // "absent is not broken" applied to a case that was broken.
    return null;
  }
  return parseWatermark(text, `${ref}${WATERMARK_PATH}`).commit;
}

/**
 * The watermark **as recorded in the index**, or `null` if it is not tracked
 * there.
 *
 * For a check whose other inputs come from the index, and there is one:
 * `documentConsistency.mjs` reads every document it compares through
 * `readStagedBlob`, then used to ask `auditScope` for the range with no
 * watermark — which falls back to `readFileSync` and answers from the **working
 * tree**. Two documents, two scopes, one decision.
 *
 * That is finding OO-3a, and it is Z-2's mechanism in the sibling caller: Z-2
 * converted `pendingAuditScope` to hand `auditScope` a watermark it had read
 * from the right scope, and left this one reading the file. The rule the header
 * of this module already states — *a gate's inputs all come from the scope its
 * decision is about* — was written for that fix and applied to one of its two
 * callers.
 *
 * **Its symptom is a false POSITIVE, and that is how it was found:** the check
 * failed on a pair no commit would ever contain — a journal read from the index
 * beside a watermark read from an unstaged edit.
 *
 * **What this does NOT fix, because the first draft of this comment said it
 * did.** A journal entry staged beside an unstaged advance exits 0 both before
 * and after — measured both ways. The check's only property is that the
 * watermark's sha appears *somewhere* in the journal, and with the advance
 * unstaged the index carries the old sha, which appears in its own older entry.
 * Reading both documents from one scope changes which sha is compared; it does
 * not let the comparison tell the two cases apart. That is OO-3b, open: the gate
 * is one-directional, catching an advance without a record and never a record
 * without an advance, since every sha the journal has ever named stays in it.
 *
 * @param {string} [root]
 * @returns {string | null}
 */
export function stagedWatermark(root = repoRoot()) {
  return watermarkAt(root, ':');
}

/**
 * The audit range **as this commit will leave it**, for a gate that runs before
 * the commit exists.
 *
 * ## Why the committed range is the wrong number at pre-commit
 *
 * `auditScope` measures `watermark..HEAD`, and at pre-commit **HEAD is the
 * parent** — the commit being made is not in it. So the commit that takes a
 * range past one batch is invisible to the gate by construction, and the board
 * goes red one push later. Measured: `check:docs` reported 8/8 immediately
 * before `8130551`, and CI reported the gate red at `8130551`.
 *
 * "Run `audit:scope` before pushing" is not a repair. A rule you must recall at
 * the moment of composing a command is not a defence — that is the argument the
 * escape-resolving-write hook exists to make, demonstrated seven times.
 *
 * So: commits + 1, and the file set unioned with what is staged. A path already
 * in the range and staged again counts once, which is why this is a set.
 *
 * ## The one commit it must never block
 *
 * The commit that records an audit advances the watermark, and it is made while
 * the range is at its largest — so a naive budget makes the single commit that
 * closes the finding the one commit that can never be made. It is recognised by
 * what it does rather than by anything it says: the staged watermark names a
 * different sha from the committed one.
 *
 * ## Why that is not an escape hatch
 *
 * It looks like one. Any staged change to the watermark earns the exemption, so
 * a bogus advance would buy a commit through this gate — and nothing here
 * checks that an audit was performed.
 *
 * Nothing here has to. `check:docs` requires the watermark's sha to appear in
 * `docs/JOURNAL.md`, so a watermark advanced without a record turns the board
 * red on the next run. The cheat costs one commit and buys nothing: it does not
 * clear the finding, it converts a blocked commit into a red build with the
 * cheater's name on it.
 *
 * **The coupling is what makes the exemption safe**, which means the two gates
 * are one mechanism in two places rather than two independent checks. Weakening
 * either — dropping the journal requirement, or widening this to any watermark
 * touch — re-opens the hatch that neither has on its own.
 *
 * ## One decision, one scope
 *
 * **A gate's inputs all come from the scope its decision is about.** This
 * function models *the index applied to HEAD*, so every input is read from the
 * index or from HEAD — which is why `auditScope` is handed `pending` rather than
 * left to read the file.
 *
 * It used to read three scopes for one decision: `recordsAudit` from HEAD and
 * the index, and the RANGE from the **working tree**, because `auditScope` falls
 * back to `readFileSync`. Measured with nothing staged at all — index
 * `9303bb5`, working tree `8519e64` — the hook exited 0, where the identical
 * invocation minutes earlier had refused. Editing the watermark and forgetting
 * to `git add` it did not fail loudly; it collapsed the measured range and waved
 * the commit through.
 *
 * **The exemption is not what fired, and that matters for whoever fixes this
 * next.** With an unstaged advance `recorded === pending`, so `recordsAudit` is
 * `false` — the gate passed because the range vanished. Hardening the exemption
 * would not have touched it.
 *
 * `pending ?? recorded` rather than `pending`: a staged *deletion* of the
 * watermark leaves no index blob, and the last recorded audit is still the
 * honest place to measure from. `check:docs` turns red on the deletion itself.
 *
 * @param {{ root?: string }} [options]
 * @returns {{
 *   watermark: string,
 *   commits: number,
 *   files: string[],
 *   recordsAudit: boolean,
 *   overBudget: string[],
 * }}
 */
export function pendingAuditScope({ root = repoRoot() } = {}) {
  const recorded = watermarkAt(root, 'HEAD:');
  const pending = watermarkAt(root, ':');

  // A repository that tracks no watermark is not running this mechanism at all
  // — the pre-commit proof's scratch fixtures, or a fresh repository before the
  // first audit. There is nothing to measure and nothing to block.
  //
  // ABSENT IS NOT BROKEN, and the difference decides which way to fail. If the
  // file IS tracked and cannot be read, `auditScope` throws below and the hook
  // reports a guard that failed, which is what tampering should look like.
  // Deleting the watermark to escape the gate therefore does not quietly work:
  // it stops being tracked only by a deletion that `check:docs` turns red, and
  // an unreadable one blocks here.
  if (recorded === null && pending === null) {
    return { watermark: '', commits: 0, files: [], recordsAudit: false, overBudget: [] };
  }

  const committed = auditScope({ root, churn: false, watermark: pending ?? recorded ?? undefined });

  const staged = `${git(['diff', '--cached', '--name-only', '-z'], { cwd: root }).stdout}`
    .split('\0')
    .filter((path) => path !== '');

  const files = new Set([...committed.files, ...staged]);
  const commits = committed.commits + 1;

  return {
    watermark: committed.watermark,
    commits,
    files: [...files],
    recordsAudit: recorded !== null && pending !== null && recorded !== pending,
    overBudget: [
      ...(commits > BATCH.commits ? [`${commits} commits (one batch is ${BATCH.commits})`] : []),
      ...(files.size > BATCH.files ? [`${files.size} files (one batch is ${BATCH.files})`] : []),
    ],
  };
}

/**
 * @param {{ watermark: string, commits: number, files: string[], overBudget: string[] }} scope
 * @returns {string}
 */
export function explainAuditBudget(scope) {
  return (
    `\nCommit blocked — this commit takes the unaudited range past one batch.\n\n` +
    `  ${scope.watermark}..HEAD plus this commit: ${scope.overBudget.join('; ')}\n\n` +
    `Run \`npm run audit:scope\` and apply CLAUDE.md's stage audit to that range, then record ` +
    `the findings in docs/JOURNAL.md and advance docs/audit-watermark.json in the SAME commit. ` +
    `That commit is exempt from this gate, because it is the one that closes the finding.\n\n` +
    `Blocked here rather than reported later on purpose. check:docs measures the range against ` +
    `HEAD, and at this moment HEAD is the parent — so the commit that crosses is invisible to ` +
    `it and the board goes red one push after the fact.\n\n` +
    `The threshold is the MEDIAN of batches 4-7, not the maximum: the maximum was batch 7, the ` +
    `one stretch that was plainly too large to audit as a unit.\n\n`
  );
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
 * ## A rename hides churn from a pathspec, which is a trap inside this fix
 *
 * `git log --numstat <range> -- <path>` stops at the rename: every commit before
 * the move touched a different path and is not matched. So the column that told
 * an auditor to read a proof's whole diff would have handed them the tail of it,
 * with everything before the move silently missing — and the figures would still
 * look like figures.
 *
 * The per-commit walk uses `--follow`, which is why it takes exactly one
 * pathspec, and the net diff is asked about both endpoints. `--follow` also
 * carries a chain (a → b → c) that naming two endpoints would miss, since the
 * range diff reports only the ends.
 *
 * @param {string} range
 * @param {string} path
 * @param {string} root
 * @param {string | null} [from] The pre-rename path, when the entry is a rename
 *   or a copy.
 * @returns {{ net: { added: number, removed: number }, perCommit: { added: number, removed: number } }}
 */
function churnFor(range, path, root, from = null) {
  const endpoints = from === null || from === path ? [path] : [from, path];

  /** @param {readonly string[]} args @param {readonly string[]} pathspec */
  const sum = (args, pathspec) => {
    let added = 0;
    let removed = 0;
    for (const line of `${git([...args, '--', ...pathspec], { cwd: root }).stdout}`.split('\n')) {
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
    net: sum(['diff', '--numstat', range], endpoints),
    // `log --numstat` walks each commit, so a line added then rewritten counts
    // in both directions rather than cancelling.
    perCommit: sum(['log', '--follow', '--numstat', '--format=', range], [path]),
  };
}

/**
 * @param {{ commit: string, range: string, commits: number, root: string, churn?: boolean }} input
 * @returns {ReturnType<typeof auditScope>}
 */
function buildScope({ commit, range, commits, root, churn = true }) {

  // Added and modified are reported apart because they mean opposite things for
  // a proof. A NEW proof is coverage arriving. A MODIFIED one is a check whose
  // meaning changed, and a fix that quietly loosened it looks exactly like one
  // that corrected it — only the diff tells them apart. That column is the
  // reason this report exists in this shape.
  // Parsed by the shared reader in gitScope.mjs, which is the fix for this
  // function having had a SECOND opinion about `--name-status`: it split on tab
  // with no `-z`, so a rename became one entry whose path was two paths joined
  // by a tab, and a proof moved and edited landed in no column at all.
  const status = changedPaths([range], { cwd: root });

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

  /** Where source that can be an instrument lives. */
  const isSource = (/** @type {string} */ path) =>
    /^scripts\/|^packages\/[^/]+\/src\/|^apps\/[^/]+\/src\//u.test(path);

  // A rename belongs in the MODIFIED column, not outside every column. `R090`
  // is a check that changed address AND meaning, which is the exact case the
  // column's "read each diff" instruction is written for; `R100` is a move,
  // which an auditor still wants told about. The source path is carried so the
  // churn figures can span the rename.
  const modified = status.filter(
    (e) => (e.state === 'M' || e.state === 'R' || e.state === 'C') && isProof(e.path),
  );

  return {
    watermark: commit,
    commits,
    files: status.map((entry) => entry.path),
    proofsAdded: status.filter((e) => e.state === 'A' && isProof(e.path)).map((e) => e.path),
    proofsModified: modified.map((e) => e.path),
    // Coverage LEAVING, which the classifier used to drop with every other state
    // it did not name. The modified column exists because a check whose meaning
    // changed must be visible to an auditor; a check that vanished is the limit
    // case of that, and unlike rename it can fire today.
    proofsRemoved: status.filter((e) => e.state === 'D' && isProof(e.path)).map((e) => e.path),
    // Two git invocations per modified proof, which is the expensive half of
    // this function and the half a budget gate does not read. Skipped for the
    // pre-commit path so the hook stays fast enough not to be worked around —
    // and skipped by OPTION rather than by a second implementation, because the
    // gate and the report must not drift about what counts as a file.
    proofChurn: churn
      ? modified.map((entry) => ({
          path: entry.path,
          ...churnFor(range, entry.path, root, entry.from),
        }))
      : [],
    // Instruments are not a directory, and scoping this to `scripts/` was W-1's
    // blind spot one folder over. Measured on the range that found it: a new
    // filesystem probe landed in `packages/kernel/src/`, doing exactly what
    // items 4a and 4b are about — answering a question whose wrong answer
    // silently disables the assertions that depend on it — and this column,
    // which exists to say "resolution-test this", did not mention it.
    //
    // Widened to new non-test source in the three places source lives. That
    // lists a handful of ordinary modules per range too, and the auditor
    // filters; a column that misses the instrument is worse than one that also
    // names its neighbours.
    newScripts: status
      .filter((e) => e.state === 'A' && !isProof(e.path) && isSource(e.path))
      .map((e) => e.path),
    overBudget: [
      ...(commits > BATCH.commits ? [`${commits} commits (one batch is ${BATCH.commits})`] : []),
      ...(status.length > BATCH.files ? [`${status.length} files (one batch is ${BATCH.files})`] : []),
    ],
  };
}
