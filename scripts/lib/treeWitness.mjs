// @ts-check
/**
 * A third state for any run that reads the working tree: **the tree moved**
 * (finding UUU-3).
 *
 * ## The occurrence, and why care is not the remedy
 *
 * `advisoryRegister.proof.mjs` spawns the checker about twenty times over four
 * minutes, each spawn importing modules from the working tree. On 2026-08-23 a
 * module was edited — mutation-testing something unrelated — while that proof
 * was in flight, and four cases failed. The failures were attributed to the
 * commit under test by the strongest evidence available: the proof passed on a
 * stashed HEAD and failed with the changes applied.
 *
 * **That is worse than a wrong guess. A control produced a false positive, and
 * it was convincing.** The next occurrence will be equally convincing, so the
 * answer is not to be careful — it is to make the run able to say *I cannot be
 * read*.
 *
 * A proof that spawns subprocesses reading the working tree is **non-hermetic by
 * construction**. Its result is a claim about a tree that was assumed to hold
 * still, and nothing was checking.
 *
 * ## Why it belongs beside pass and fail
 *
 * The same reason every other third state in this repository does: *could not
 * look* and *looked and found nothing* must not share an output. Here the pair
 * is *this failed* and *this was measured against something that changed
 * underneath it*, and collapsing them sends someone to debug a defect that does
 * not exist — measured, at the cost of a stash, two four-minute runs and a wrong
 * conclusion held for several minutes.
 *
 * ## What it watches, and the limit
 *
 * `git status --porcelain` covers the index and the working tree, tracked and
 * untracked, which is every way a spawned child's view can change. Ignored files
 * are excluded, deliberately: `.cache/` moves during ordinary runs and is not
 * something a child reads for its answer.
 *
 * Size and mtime are folded in **for every path the status names**, which is the
 * clause that decides what this catches. A file that is already dirty — the
 * occurrence's own case, a new untracked module being mutation-tested — is
 * caught even when its content ends where it started, because the mtime moved.
 *
 * **The limit, and it is narrower than "an edit-and-revert is caught": a CLEAN
 * tracked file, edited and returned to identical content, is invisible.** It
 * appears in no status line before or after, so there is no path to stat and
 * nothing to notice. Also invisible: anything under an ignored path. Neither is
 * reachable by ordinary work, and both are reachable by a script that tries —
 * which is precisely what mutation testing is, so read a clean witness as
 * *nothing obvious moved*, not as *nothing moved*.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { git, repoRoot } from './gitScope.mjs';

/**
 * @typedef {object} TreeWitness
 * @property {string} digest What the tree looked like.
 * @property {string} root The repository this was taken in.
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {TreeWitness}
 */
export function witnessTree(options = {}) {
  const root = options.root ?? repoRoot();
  const status = `${git(['status', '--porcelain'], { cwd: root }).stdout}`;
  const hash = createHash('sha256').update(status);
  for (const line of status.split('\n')) {
    // `XY path`, and for a rename `XY from -> to`. The destination is what a
    // reader would open, and it is the last field either way.
    const path = line.slice(3).split(' -> ').pop()?.trim();
    if (path === undefined || path === '') continue;
    try {
      const stat = statSync(join(root, path.replace(/^"|"$/gu, '')));
      hash.update(String(stat.size));
      hash.update(':');
      hash.update(String(stat.mtimeMs));
    } catch {
      // Deleted between the status and the stat, which is itself movement and
      // is captured by the status line already being in the digest.
    }
  }
  return { digest: hash.digest('hex'), root };
}

/**
 * @param {TreeWitness} before
 * @returns {string | null} What moved, or null when nothing did.
 */
export function treeMovedSince(before) {
  const after = witnessTree({ root: before.root });
  if (after.digest === before.digest) return null;
  return (
    'the working tree or index changed while this run was in flight, so its result is not ' +
    'about the tree you are looking at. Re-run with nothing else touching the repository.'
  );
}
