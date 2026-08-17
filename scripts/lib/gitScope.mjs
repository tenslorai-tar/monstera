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
 */

import { spawnSync } from 'node:child_process';

/**
 * @param {readonly string[]} args
 * @param {{ input?: string, binary?: boolean, cwd?: string }} [options]
 * @returns {{ stdout: string | Buffer }}
 */
export function git(args, options = {}) {
  const result = spawnSync('git', [...args], {
    input: options.input,
    cwd: options.cwd,
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
  const probe = spawnSync('git', ['cat-file', '-e', `:${path}`], { cwd: options.cwd });
  if (probe.status !== 0) return null;

  const { stdout } = git(['cat-file', 'blob', `:${path}`], { ...options, binary: true });
  return stdout instanceof Buffer ? stdout : Buffer.from(stdout);
}
