// @ts-check
/**
 * ZZZZZ-4's other half: a `.test.ts` whose case set shrinks, noticed.
 *
 * ## The gap, and why widening `check:proofanchors` does not close it
 *
 * `check:proofanchors` requires every `scripts/proofs/*.proof.mjs` to declare a
 * case count, so a proof that loses a case reports a total that no longer
 * matches its own declaration and goes red. That mechanism does not transfer to
 * a `.test.ts`: **an `it()` block is counted by the RUNNER rather than by
 * itself**, so vitest's total is derived from the cases that exist and agrees
 * with any collection, including one that has quietly shrunk. That is finding
 * YYYYY-1's shape — a proof went 29 cases to 26 and reported success on both
 * matrix legs — living in the 89 files where most of this project's controls
 * actually are.
 *
 * ## The anchor is the PREVIOUS COMMIT, which the shrinking edit cannot reach
 *
 * `CLAUDE.md` item 4c: *derive from a set only when the failure you fear makes
 * that set BIGGER; when it makes the set SMALLER, the count must come from
 * somewhere the failure cannot reach.* A count computed from the file being
 * edited is the circular version. The count in `HEAD`'s copy of that file is
 * not: deleting a case changes the working blob and leaves `HEAD` alone, so the
 * two disagree exactly when a case has left.
 *
 * That is why this compares blobs rather than asking each file to declare a
 * number.
 *
 * ## The count is STATIC, and it does not have to equal vitest's
 *
 * It counts `it(`, `it.each(`, `test(` and their `.skip`/`.only`/`.fails`
 * spellings. That is not the runner's answer — `it.each` produces one case per
 * row and this sees one call — and it does not need to be. **Both sides of the
 * comparison are counted the same way**, so an `it.each` contributes 1 to the
 * before and 1 to the after and cancels. What the comparison needs is a proxy
 * that MOVES when a case is deleted, not one that agrees with the runner.
 *
 * Measured 2026-09-03: `npx vitest list --json` takes **102 seconds** over this
 * repository and answers 1192 cases. A check in the pre-commit set cannot cost
 * that, and one that costs it is one somebody removes — which is how the class
 * ends up unwatched for a second time.
 *
 * ## What it CANNOT see, stated rather than left to be discovered
 *
 * - a row leaving an `it.each` table. The call is still there, so the count
 *   does not move. Four files use `it.each` (measured 2026-09-03:
 *   `frame.test.ts`, `containment.test.ts`, `sessionDirectories.test.ts`,
 *   `windowPolicy.test.ts`).
 * - an assertion leaving a case that stays. That is a different class and no
 *   count reaches it.
 * - a case deleted in the same commit that adds another. The net is zero and
 *   this reports nothing — the same blind spot `audit:scope`'s net columns have,
 *   and for the same reason.
 * - anything at all in CI, where the working tree equals `HEAD` by
 *   construction. This is a pre-commit instrument, like `guard:staged`.
 *
 * ## It REPORTS and does not block, and that is a decision rather than a default
 *
 * Removing a case is legitimate — a case that was wrong, a file being split, a
 * feature withdrawn. A gate here would need an override, and `CLAUDE.md` names
 * an override standing in for missing coverage as *a workaround with a config
 * flag on it*. What the class actually needs is that the removal is SEEN.
 *
 * The report passes the test `CLAUDE.md` sets for a printed compensation —
 * *could it have been printed before you made your change?* It could not: it
 * names the file and the two counts this run computed from two blobs.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { git, repoRoot } from './gitScope.mjs';

/**
 * A case-declaring call, in every spelling this repository uses.
 *
 * Anchored on a word boundary so `submit(` and `wait(` do not match, and
 * allowing the modifier suffixes because a skipped case is still a case that
 * can be deleted — `it.skip` becoming absent is exactly the event this watches.
 *
 * `describe` is deliberately NOT counted: deleting a `describe` deletes the
 * `it`s inside it, which this already sees, and counting both would report one
 * removal as two.
 */
const CASE_CALL = /(?<![\w$.])(?:it|test)(?:\.(?:each|skip|only|fails|todo|concurrent|sequential))*\s*[(`]/gu;

/**
 * How many case-declaring calls a source carries.
 *
 * @param {string} source
 * @returns {number}
 */
export function countCases(source) {
  return source.match(CASE_CALL)?.length ?? 0;
}

/** A file whose case count fell between two blobs. */
/**
 * @typedef {object} Shrink
 * @property {string} path
 * @property {number} before
 * @property {number} after
 */

/**
 * Which of `paths` exist at a revision, asked in ONE call.
 *
 * A file ADDED by this commit has no `HEAD` copy, and that is not a shrink — it
 * is the ordinary case and must not be reported as one.
 *
 * **Asked with `ls-tree` rather than by letting `git show` fail.** A `show` that
 * exits non-zero for an absent path exits non-zero for a corrupt object and an
 * unreadable repository too, so catching it would be the swallow `CLAUDE.md`
 * bans: this file's whole job is to notice something missing, and it must not
 * treat *git could not answer* as *the file was not there*.
 *
 * @param {string} revision
 * @param {readonly string[]} paths repo-relative
 * @param {{ cwd?: string }} [options]
 * @returns {Set<string>}
 */
export function presentAt(revision, paths, options = {}) {
  if (paths.length === 0) return new Set();
  // TEMPLATED, as every other caller in `gitScope.mjs` does it: `git` declares
  // `string | Buffer` because it serves binary readers too, and the interpolation
  // is the narrowing this repository already uses rather than a cast.
  const stdout = `${git(['ls-tree', '-r', '--name-only', '-z', revision, '--', ...paths], options).stdout}`;
  return new Set(stdout.split('\0').filter((entry) => entry !== ''));
}

/**
 * Reads a path's blob at a revision. The caller has established it is there.
 *
 * @param {string} revision
 * @param {string} path
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export function blobAt(revision, path, options = {}) {
  return `${git(['show', `${revision}:${path}`], options).stdout}`;
}

/**
 * Every staged test file whose case count is LOWER than at `HEAD`.
 *
 * @param {object} input
 * @param {readonly string[]} input.paths staged test files, repo-relative
 * @param {(path: string) => string | null} input.head the file's `HEAD` blob
 * @param {(path: string) => string | null} input.staged the file's staged blob
 * @returns {{ shrunk: readonly Shrink[]; compared: number }}
 */
export function findShrunkCases({ paths, head, staged }) {
  /** @type {Shrink[]} */
  const shrunk = [];
  let compared = 0;

  for (const path of paths) {
    const before = head(path);
    // ADDED BY THIS COMMIT. No previous count exists, so there is nothing this
    // can be lower than.
    if (before === null) continue;
    const after = staged(path);
    // DELETED BY THIS COMMIT, which is a whole file leaving and is visible in
    // the diff without help. Reporting it here would put every deliberate file
    // removal through a compensation written for a case that vanished inside
    // one.
    if (after === null) continue;

    compared += 1;
    const from = countCases(before);
    const to = countCases(after);
    if (to < from) shrunk.push({ path, before: from, after: to });
  }

  return { shrunk, compared };
}

/**
 * The report, or null when nothing shrank.
 *
 * NAMES THE NUMBERS THIS RUN COMPUTED, which is what separates a compensation
 * from a disclaimer: nothing here could have been printed before the change was
 * made.
 *
 * @param {readonly Shrink[]} shrunk
 * @returns {string | null}
 */
export function formatShrunkCases(shrunk) {
  if (shrunk.length === 0) return null;
  const lines = shrunk.map(
    ({ path, before, after }) =>
      `  - ${path}: ${String(before)} case(s) at HEAD, ${String(after)} staged ` +
      `(${String(before - after)} fewer)`,
  );
  return (
    `\n${String(shrunk.length)} test file(s) declare FEWER cases than at HEAD:\n\n` +
    `${lines.join('\n')}\n\n` +
    `  Not a refusal. Removing a case is legitimate and this is the only thing that says it\n` +
    `  happened: an \`it()\` block is counted by the runner, so vitest's total agrees with any\n` +
    `  collection including one that has quietly shrunk (finding YYYYY-1, ZZZZZ-4).\n\n` +
    `  If the case was wrong or its subject is gone, this line is the record. If it was moved,\n` +
    `  the file it moved TO is not named here — check that it arrived.\n`
  );
}

/**
 * Runs the check as a child, for the pre-commit hook.
 *
 * SPAWNED rather than imported, for `runContractProof`'s reason: the check
 * carries its own positive control and its own exit semantics, and a hook that
 * re-implemented either would be a second opinion about what this instrument
 * says (B3a). `ok` is *the instrument could look*, never *nothing shrank* —
 * the check exits 0 whatever it finds.
 *
 * @returns {{ ok: boolean, output: string }}
 */
export function runTestAnchors() {
  const root = repoRoot();
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'checks', 'testAnchors.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
