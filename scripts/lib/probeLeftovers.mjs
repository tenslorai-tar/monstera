// @ts-check
/**
 * Removes probe files a killed proof left behind, at the START of the next run.
 *
 * ## The defect this repairs
 *
 * Two proofs plant a file into the source tree so a lint rule scoped by PATH
 * has something at that path to report: `boundaries.proof.mjs` writes
 * `__boundary_probe__.ts` into `packages/*\/src`, and
 * `electronImports.proof.mjs` writes `__import_probe__.mjs` under `scripts/`.
 * Neither can use `.probe/`, because a file outside the scoped path matches no
 * rule and the case would pass while testing nothing.
 *
 * Both clean up in a `finally`. **A `finally` does not run when the process is
 * killed** — `checkLocal.mjs` bounds every script and kills it at the timeout,
 * which is not a rare event: `proof:boundaries` took 180.5s against a 180s
 * bound on 2026-09-03 and left two files behind.
 *
 * ## Why an exclude list is not the fix, and this is
 *
 * The proofs' own headers claimed the class was closed by naming the readers
 * that ignore the file — git and ESLint — and **the set was larger than the
 * enumeration**. `tsc` honours neither ignore file, and there are two of it:
 * the solution build reads each package's `include`, and
 * `tsconfig.scripts.json` includes `scripts/**\/*.mjs`. So a killed
 * `proof:boundaries` reddens `npm run build`, and a killed
 * `proof:electronimports` reddens the second half of `npm run typecheck` —
 * the half `npx tsc -b` alone does not run, which is the spelling `CLAUDE.md`
 * records reddening `main` on 2026-08-29.
 *
 * **The rule is not a longer list.** The readers are *anything that globs the
 * source tree*, and that set is open: a formatter, a bundler, a coverage tool,
 * a doc generator or a search index added later reads these files too and knows
 * nothing about any ignore file. An exclude closes the readers somebody has
 * thought of. A sweep repairs the tree, which is what every reader looks at —
 * so the sweep is the load-bearing half and the excludes are a second line for
 * the two readers we can name today.
 *
 * ## WHY THIS CLASS IS INVISIBLE, which is the part worth carrying
 *
 * `git status` cannot show it. The earlier fix for the ESLint half added these
 * names to `.gitignore`, so the working tree reads clean whether or not the
 * files are there — **checking the tree first, which is the habit this project
 * teaches for exactly this kind of leftover, is blind here by construction.**
 * The file is found by the next thing that compiles, as an error in a file
 * nobody wrote, and the obvious reading of that error is that the build is
 * broken rather than that the tree is dirty.
 *
 * That sentence replaces the one it falsified: the headers said the ignore
 * closed the hazard, and what the ignore actually did was remove the signal.
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every filename a proof plants into the source tree.
 *
 * **Declared once and imported by both proofs**, so the sweep and the planting
 * cannot disagree about what a probe is called (B3a). A proof that renamed its
 * probe and left this list alone would be planting a file nothing sweeps, which
 * is this defect with a new name.
 *
 * `.js` is here beside `.mjs` because `electronImports.proof.mjs` plants both:
 * the extension half of the plain-Node rule needs a `.js` at the same path.
 */
export const PROBE_NAMES = Object.freeze([
  '__boundary_probe__.ts',
  '__import_probe__.mjs',
  '__import_probe__.js',
]);

/**
 * Directories the walk does not enter.
 *
 * Not a correctness filter — a probe under `node_modules` would still be a
 * leftover — but a cost one: the walk runs at the start of two proofs and
 * descending 40,000 package directories to find nothing would make it the
 * expensive part of both. Every directory a probe is planted into is inside the
 * source tree by construction, because that is the whole point of planting it
 * there.
 */
const SKIP = new Set(['node_modules', '.git', 'dist', '.tools', '.cache', 'release', '.probe']);

/**
 * Removes every probe leftover under `root`, and reports what it removed.
 *
 * IDEMPOTENT and safe on a clean tree: the ordinary case removes nothing and
 * returns an empty list, which is why it can run unconditionally at the top of
 * a proof rather than behind a flag somebody has to remember.
 *
 * It does NOT throw when it finds one. A leftover is a previous run's timeout
 * rather than this run's defect, and refusing to start would turn one killed
 * proof into every later proof failing — the failure mode this exists to end.
 * The caller prints what came back so the event is visible.
 *
 * @param {string} root repository root
 * @returns {string[]} absolute paths removed, in walk order
 */
export function sweepProbeLeftovers(root) {
  /** @type {string[]} */
  const removed = [];

  /** @param {string} directory */
  const walk = (directory) => {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // A directory that vanished between the parent's listing and this read is
      // not this sweep's business, and a proof must not fail to start because
      // something else was tidying up. Narrow by construction: the only call
      // that can throw here is the read of a path this walk just listed.
      return;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path);
        continue;
      }
      if (!PROBE_NAMES.includes(entry.name)) continue;
      rmSync(path, { force: true });
      removed.push(path);
    }
  };

  walk(root);
  return removed;
}

/**
 * What a proof prints when the sweep found something, or null when it did not.
 *
 * NAMES THE FILES AND THE CAUSE. *Cleaned up* would be a line nobody reads;
 * the useful sentence is that a previous run was killed, because the reader is
 * usually somebody currently confused by a build error in a file they did not
 * write.
 *
 * @param {readonly string[]} removed
 * @param {string} root
 * @returns {string | null}
 */
export function formatProbeLeftovers(removed, root) {
  if (removed.length === 0) return null;
  const relative = removed.map((path) => path.slice(root.length + 1).split('\\').join('/'));
  return (
    `  --  removed ${String(removed.length)} probe leftover(s) from a previous run that was ` +
    `killed before its cleanup:\n      ${relative.join('\n      ')}\n` +
    `      A \`finally\` does not run when checkLocal.mjs kills a script at its timeout. These\n` +
    `      files break \`npm run build\` and \`npm run typecheck\` and are gitignored, so\n` +
    `      \`git status\` shows a clean tree while they sit there.\n`
  );
}

/**
 * Plants a leftover, for a control that must produce one WITHOUT a killed run.
 *
 * Exported from here rather than written in the proof, so the control cannot
 * plant a name the sweep does not look for and pass by agreeing with itself.
 *
 * @param {string} path
 * @param {(path: string, contents: string) => void} write
 * @returns {string} the path, for the caller to assert on
 */
export function plantProbeLeftover(path, write) {
  write(path, '// left behind by a killed proof; the next run must remove this\n');
  return path;
}
