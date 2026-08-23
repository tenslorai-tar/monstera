// @ts-check
/**
 * Proof that the tree witness can tell a still tree from a moving one, and that
 * its stated limits are the real ones (finding UUU-3).
 *
 * ## Why the limits are cases and not prose
 *
 * A witness that never fires is a third state nobody ever sees, and it reads
 * exactly like a repository where nothing ever moves — which is the reassuring
 * answer for this instrument. So the first pair is see-and-refuse.
 *
 * The second pair asserts the LIMITS. `treeWitness.mjs` claims an ignored path
 * is invisible and that a clean tracked file edited back to identical content is
 * invisible too. Both are real reductions, and a documented limit nobody tests
 * is a documented limit that quietly stops being true — in either direction. If
 * one of these ever starts being caught, the header is wrong and should be
 * corrected rather than left claiming less than the code does.
 *
 * Usage: node scripts/proofs/treeWitness.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { treeMovedSince, witnessTree } from '../lib/treeWitness.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @type {string[]} */
const scratches = [];

/**
 * A throwaway repository with one committed file and one ignored path.
 *
 * @returns {string}
 */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-witness-'));
  scratches.push(root);
  const run = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  run(['init', '--quiet']);
  run(['config', 'user.email', 'proof@example.invalid']);
  run(['config', 'user.name', 'proof']);
  writeFileSync(join(root, '.gitignore'), '.cache/\n', 'utf8');
  writeFileSync(join(root, 'tracked.mjs'), 'export const a = 1;\n', 'utf8');
  run(['add', '-A']);
  run(['commit', '--quiet', '-m', 'base']);
  return root;
}

try {
  // -------------------------------------------------------------------------
  // 1 & 2. It can see a still tree, and it can refuse a moving one.
  // -------------------------------------------------------------------------
  {
    const root = repository();
    const before = witnessTree({ root });
    check(
      'a tree that did not move reports no movement',
      treeMovedSince(before) === null,
      'If this fires on a still tree the state is noise, and a third state nobody trusts is ' +
        'worse than none — it gets read as flake and the real one is missed with it.',
    );
  }
  {
    const root = repository();
    const before = witnessTree({ root });
    writeFileSync(join(root, 'appeared.mjs'), 'export const b = 2;\n', 'utf8');
    check(
      'a file appearing under the run is REPORTED as movement',
      treeMovedSince(before) !== null,
      'This is the occurrence: a module written while a four-minute proof was spawning ' +
        'children that import it. Without this the run reports a verdict about a tree that ' +
        'stopped existing halfway through.',
    );
  }

  // -------------------------------------------------------------------------
  // 3. THE CASE THE OCCURRENCE ACTUALLY HAD: an already-dirty file edited and
  // returned to identical content. The status text is the same at both ends, so
  // only the mtime separates them — which is why it is folded in.
  // -------------------------------------------------------------------------
  {
    const root = repository();
    const path = join(root, 'untracked.mjs');
    writeFileSync(path, 'export const c = 3;\n', 'utf8');
    const before = witnessTree({ root });
    writeFileSync(path, 'export const c = 99;\n', 'utf8');
    writeFileSync(path, 'export const c = 3;\n', 'utf8');
    // Node can write both edits inside one filesystem timestamp tick, which
    // would make this pass for the wrong reason on a coarse clock. Setting the
    // time explicitly makes the case about the DIGEST rather than about how
    // fast the disk is.
    const later = new Date(Date.now() + 5000);
    utimesSync(path, later, later);
    check(
      'an already-dirty file edited and reverted is still reported, because its mtime moved',
      treeMovedSince(before) !== null,
      'The status line is identical at both ends — same path, same untracked state — so a ' +
        'digest of the status text alone would call this tree unmoved. That is the exact ' +
        'shape of mutation testing, which is what caused the occurrence.',
    );
  }

  // -------------------------------------------------------------------------
  // 4 & 5. THE STATED LIMITS, asserted so they stay true in both directions.
  // -------------------------------------------------------------------------
  {
    const root = repository();
    const before = witnessTree({ root });
    writeFileSync(join(root, 'tracked.mjs'), 'export const a = 2;\n', 'utf8');
    writeFileSync(join(root, 'tracked.mjs'), 'export const a = 1;\n', 'utf8');
    check(
      'LIMIT: a CLEAN tracked file edited back to identical content is NOT seen',
      treeMovedSince(before) === null,
      'The header says so. If this now fires, the code catches more than the header claims ' +
        'and the header is what needs correcting — a limit that is stated more pessimistically ' +
        'than the truth still costs someone a re-run they did not need.',
    );
  }
  {
    const root = repository();
    const before = witnessTree({ root });
    spawnSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '.cache/\nignored.mjs\n', 'utf8');
    const afterGitignore = witnessTree({ root });
    writeFileSync(join(root, 'ignored.mjs'), 'export const d = 4;\n', 'utf8');
    check(
      'LIMIT: a change under an ignored path is NOT seen',
      treeMovedSince(afterGitignore) === null && treeMovedSince(before) !== null,
      'Ignored paths are excluded deliberately — .cache/ moves during ordinary runs and is ' +
        'not what a child reads for its answer. The second half is the control: editing ' +
        '.gitignore itself IS movement, so this case is not passing because nothing was ' +
        'written at all.',
    );
  }
} finally {
  for (const scratch of scratches) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} tree-witness case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('tree-witness case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
