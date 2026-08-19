// @ts-check
/**
 * Runs the compile-fail contract proof when, and only when, a commit can break
 * it — finding W-2.
 *
 * ## The mechanism, because the rule already failed twice
 *
 * `scripts/proofs/contract.proof.mjs` holds handler-map and client-stub source
 * **as strings**, compiled by its own `tsc` run. That is what a compile-fail
 * proof is: it asserts the shapes TypeScript must *reject*, which no compiling
 * file can express. It is also why `npm run typecheck` cannot see inside it.
 *
 * So a change to the contract's types leaves two copies to update, and only one
 * of them is in the fast loop. It has happened twice, in one range:
 *
 * - changing `Handlers` to return a `Result` left four cases stale, and the
 *   proof was red on `main` for three pushes while `typecheck` and `test` were
 *   green — and they were right to be;
 * - adding one channel left three more stale, an hour after the first was
 *   fixed, by the person who had just written the finding down.
 *
 * Twice is a class. The rule "run the proof when you touch the contract" is
 * exactly the kind that has to be recalled at the moment a command is composed,
 * and this project has measured what that is worth.
 *
 * ## The cost, stated rather than hidden
 *
 * The proof spawns `tsc` per case and takes about **50 seconds**. That is paid
 * only on a commit that stages contract or shared *sources* — not on documents,
 * not on tests, not on anything else. CI runs it on every commit regardless, so
 * this does not add coverage; it moves the failure from a red `main` nobody
 * reads to a blocked commit, which is the whole difference.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Whether the staged changes can alter what the contract proof compiles
 * against.
 *
 * **Fails closed**: if the staged list cannot be read, this returns `true` and
 * the proof runs. Running a check that was not needed costs fifty seconds;
 * skipping one that was costs a red `main` nobody looks at.
 *
 * `root` is injectable for one reason and it is not configuration: the
 * fail-closed branch cannot be reached from inside this repository, and a
 * property no test can reach is a property the code is free to lose. Production
 * has no reason to pass one.
 *
 * @param {string} [root]
 * @returns {boolean}
 */
export function touchesContractTypes(root = REPO_ROOT) {
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (staged.status !== 0) return true;

  return pathsTouchContractTypes(
    `${staged.stdout ?? ''}`.split('\0').filter((path) => path.length > 0),
  );
}

/**
 * The predicate, separated from reading the index so it can be exercised
 * without staging anything.
 *
 * A gate whose condition can only be tested by arranging a real commit is a
 * gate nobody tests, and the two halves fail differently: this one can be
 * wrong about which paths matter, and its caller can be wrong about what to do
 * when git will not answer.
 *
 * @param {readonly string[]} paths
 * @returns {boolean}
 */
export function pathsTouchContractTypes(paths) {
  return paths.some((path) => {
    // Tests cannot change what the proof compiles against — they are checked by
    // `typecheck` like any other source, and excluding them keeps the cost off
    // the commits that add coverage.
    if (/\.test\.[cm]?tsx?$/u.test(path)) return false;
    return (
      path.startsWith('packages/contract/src/') ||
      path.startsWith('packages/shared/src/') ||
      path.startsWith('packages/kernel/src/')
    );
  });
}

/**
 * Runs the proof. Output is passed through, because its failure report names
 * the case and prints the diagnostic that was actually produced.
 *
 * @returns {{ ok: boolean, output: string }}
 */
export function runContractProof() {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'proofs', 'contract.proof.mjs')],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * @param {string} output
 * @returns {string}
 */
export function explainContractDrift(output) {
  return (
    `${output}\n` +
    `Commit blocked — the compile-fail contract proof is failing, and this commit stages a ` +
    `contract, shared or kernel source.\n\n` +
    `That proof holds handler-map and client-stub source as STRINGS, compiled by its own tsc ` +
    `run, so \`npm run typecheck\` cannot see inside it. A change to the contract's types ` +
    `therefore leaves two copies to update and only one of them is in the fast loop. This has ` +
    `happened twice: once leaving main red for three pushes, once an hour after that finding ` +
    `was written down.\n\n` +
    `  Run:  npm run proof:contract\n\n` +
    `and update the fixtures in scripts/proofs/contract.proof.mjs. If a rejection case now ` +
    `fails for a DIFFERENT reason, fix the reason rather than relaxing the matcher — that is ` +
    `the shape a loosened check arrives in.\n\n`
  );
}
