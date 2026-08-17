// @ts-check
/**
 * The one place that decides WHICH GIT SCOPE a guard reads, and says why.
 *
 * Two guards had the same defect independently, which is what makes it a class
 * rather than two bugs:
 *
 *   - `guardFiles.mjs` inspected staged BLOBS for every rule except the fixture
 *     provenance one, which read `PROVENANCE.md` off the WORKING TREE. Staging a
 *     PDF with an unstaged declaration passed; staging a declaration whose disk
 *     copy was emptied failed. The verdict followed the working tree in both
 *     directions, for a rule about what a commit will contain.
 *   - `documentConsistency.mjs` read `git ls-files`, which lists only what is
 *     already COMMITTED. A brand-new ADR staged alongside a missing index row
 *     was invisible until after the commit that should have caught it.
 *
 * Both are "the guard asked git a question whose answer is not the thing it is
 * guarding". So the scopes are named once here, with their semantics stated, and
 * a guard picks one deliberately instead of reaching for whichever git command
 * came to mind.
 *
 * ## The scopes
 *
 * - **staged** — what THIS COMMIT will contain. Blobs from the index, so
 *   `git add -p` and edit-after-add are handled correctly: only the staged bytes
 *   matter, never the file on disk.
 * - **commit** — the tree as the commit will leave it: everything already
 *   tracked, plus everything staged. This is what a check about *repository
 *   state* wants, and it is what `ls-files` alone gets wrong.
 * - **tree** — every tracked file at HEAD. The CI mirror.
 * - **history** — every blob reachable in the range, including blobs whose path
 *   no longer exists. Addressed by SHA, because a deleted object has no path.
 *
 * A guard that reads the filesystem directly is choosing a fifth scope —
 * "whatever is on disk right now" — and that is almost never the question.
 *
 * ## Where the scope is rooted
 *
 * Every scope above is a question about THE REPOSITORY. Most git commands answer
 * about the current directory instead: `git ls-files` run from `packages/ui`
 * lists 3 files where the repository has 100. A guard inheriting an arbitrary
 * cwd therefore inspects a subtree and reports "ok" for the 97 files it never
 * looked at — a green check that verifies almost nothing, and one that gets
 * quieter the deeper the caller happens to be.
 *
 * So `git()` roots itself at the repository by default, and a caller wanting a
 * path-limited query has to say so. That ordering is deliberate: the safe
 * question is the one you get for free, and the narrow one costs a keystroke.
 */

import { spawnSync } from 'node:child_process';

/** @type {string | null} */
let cachedRoot = null;

/**
 * The repository, asked of git rather than derived from a script's own location.
 *
 * `resolve(__dirname, '..', '..')` is the tempting alternative and it is a
 * second answer to a question that must have one. It disagrees with git for a
 * linked worktree, for a submodule, and for any invocation where the scripts
 * directory is not two levels below the root — and it disagrees silently,
 * because both forms return a plausible absolute path.
 *
 * @returns {string}
 */
export function repoRoot() {
  if (cachedRoot !== null) return cachedRoot;
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Not inside a git work tree: ${`${result.stderr ?? ''}`.trim()}`);
  }
  cachedRoot = `${result.stdout}`.trim();
  return cachedRoot;
}

/**
 * @param {readonly string[]} args
 * @param {{ input?: string, binary?: boolean, cwd?: string }} [options]
 *   `cwd` defaults to the repository root. Pass it only to ask a deliberately
 *   path-limited question — see the note above on what inheriting the caller's
 *   directory costs.
 * @returns {{ stdout: string | Buffer }}
 */
export function git(args, options = {}) {
  const result = spawnSync('git', [...args], {
    input: options.input,
    cwd: options.cwd ?? repoRoot(),
    encoding: options.binary === true ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run git ${args.join(' ')}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const stderr = result.stderr instanceof Buffer ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${stderr}`);
  }
  return { stdout: result.stdout ?? '' };
}

/**
 * Every path the commit will leave in the tree: tracked plus staged.
 *
 * Use this for any check about repository STATE — "is this ADR indexed", "does
 * every referenced script exist". `git ls-files` alone answers about the
 * previous commit, which means a check can only catch a mistake after the commit
 * that made it.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {string[]}
 */
export function filesInCommit(options = {}) {
  const tracked = `${git(['ls-files', '-z'], options).stdout}`.split('\0');
  const staged = `${
    git(['diff', '--cached', '--name-only', '--diff-filter=d', '-z'], options).stdout
  }`.split('\0');

  return [...new Set([...tracked, ...staged].filter((path) => path.length > 0))];
}

/**
 * The bytes of a path AS STAGED — from the index, never from disk.
 *
 * Returns null when the path is not in the index at all, which a caller must
 * distinguish from "staged and empty": a missing declaration file and an empty
 * one are different failures and deserve different messages.
 *
 * @param {string} path
 * @param {{ cwd?: string }} [options]
 * @returns {Buffer | null}
 */
export function readStagedBlob(path, options = {}) {
  const probe = spawnSync('git', ['cat-file', '-e', `:${path}`], {
    cwd: options.cwd ?? repoRoot(),
  });
  if (probe.status !== 0) return null;

  const { stdout } = git(['cat-file', 'blob', `:${path}`], { ...options, binary: true });
  return stdout instanceof Buffer ? stdout : Buffer.from(stdout);
}
