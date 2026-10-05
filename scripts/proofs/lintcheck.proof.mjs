// @ts-check
/**
 * Proof that the lint runner lints every unit of a tree, separates a violation from a clean tree, and reports a unit
 * over its heap budget as the budget (ADR-0170, rule B2).
 *
 * ## The failures worth cases
 *
 * A lint has one reassuring answer, *no problems*, and several ways to give it without having looked:
 *
 *   - a violation is not reported. The resolution test, against a real violation nothing but ESLint catches, in each
 *     kind of unit, so a unit kind the runner stopped linting reads red here rather than clean everywhere.
 *   - a file belongs to no unit. The units are derived from the tree and end with the rest of it, so a file in a
 *     directory nobody named, and a package added since, are each given a violation the runner must find.
 *   - a unit over the budget reads as a lint problem, or as nothing. A budget too small to start under must be
 *     reported as the budget; the same tree under the real budget is the control.
 *   - the peak is not read. Every clean unit must report one, or the report CI prints is a column of blanks.
 *
 * The clean tree is not symmetry for its own sake: a runner that reported failure for everything would pass every
 * resolution case while blocking every push.
 *
 * ## Fixtures are BUILT, never the repository
 *
 * {@link runLint} takes its ESLint path, units, working directory and budget as arguments, so this drives it against
 * throwaway trees with their own flat config. A runner that could only be exercised by linting the repository would
 * be exercised by nothing.
 *
 * Usage: node scripts/proofs/lintcheck.proof.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { ESLINT_ENTRY, LINT_HEAP_BUDGET_MB, lintUnits, runLint } from '../lib/lintcheck.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const root = repoRoot();
const eslintPath = join(root, ESLINT_ENTRY);
if (!existsSync(eslintPath)) {
  process.stderr.write(
    `ESLint is not at ${ESLINT_ENTRY}. This proof drives the real linter against fixture trees, so without it there ` +
      `is nothing to separate. Run \`npm ci\`.\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The units of the REAL tree, read without linting it.
// ---------------------------------------------------------------------------
const real = lintUnits(root).map((unit) => unit.name);
check(
  'the real tree has a source and a tests unit for every package, then scripts, then the rest',
  ['packages/ui', 'packages/kernel', 'packages/shared', 'apps/desktop'].every(
    (dir) => real.includes(`${dir} (source)`) && real.includes(`${dir} (tests)`),
  ) &&
    real.at(-2) === 'scripts' &&
    real.at(-1) === 'the rest of the tree',
  `read ${JSON.stringify(real)}. A package missing here is a package the lint no longer reads, reported clean.`,
);

const CONFIG = [
  'export default [',
  "  { files: ['**/*.{js,mjs,ts}'], rules: { 'no-unused-vars': 'error' } },",
  '];',
  '',
].join('\n');
const DIRTY = 'const unused = 1;\nexport const used = 2;\n';
const CLEAN = 'export const used = 2;\n';

/**
 * A tree with its own config, a package `packages/a` with a source and a test file, `scripts/`, and a directory no
 * unit names; `dirty` says which of them carry a violation.
 *
 * @param {ReadonlySet<string>} dirty
 */
function tree(dirty) {
  const at = mkdtempSync(join(tmpdir(), 'lintcheck-proof-'));
  /** @param {string} path @param {string} body */
  const put = (path, body) => {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), body, 'utf8');
  };
  put('eslint.config.js', CONFIG);
  put('package.json', '{ "type": "module" }\n');
  put('packages/a/package.json', '{ "type": "module" }\n');
  put('apps/b/package.json', '{ "type": "module" }\n');
  for (const file of ['packages/a/src/source.ts', 'packages/a/src/source.test.ts', 'apps/b/main.js', 'scripts/tool.mjs', 'other/stray.js']) {
    put(file, dirty.has(file) ? DIRTY : CLEAN);
  }
  return at;
}

const everywhere = tree(
  new Set(['packages/a/src/source.ts', 'packages/a/src/source.test.ts', 'apps/b/main.js', 'scripts/tool.mjs', 'other/stray.js']),
);
const testsOnly = tree(new Set(['packages/a/src/source.test.ts']));
const clean = tree(new Set());
try {
  const statusOf = (/** @type {ReturnType<typeof runLint>} */ outcomes, /** @type {string} */ name) =>
    outcomes.find((outcome) => outcome.unit.name === name)?.status;

  const dirtyRun = runLint(eslintPath, lintUnits(everywhere), everywhere, LINT_HEAP_BUDGET_MB);
  for (const name of ['packages/a (source)', 'packages/a (tests)', 'scripts']) {
    check(
      `RESOLUTION: a violation in ${name} is reported there`,
      statusOf(dirtyRun, name) === 'problems',
      `read ${JSON.stringify(dirtyRun.map((outcome) => [outcome.unit.name, outcome.status]))}.`,
    );
  }
  check(
    'A PACKAGE ADDED to the tree is linted with no edit to the runner (apps/b)',
    statusOf(dirtyRun, 'apps/b (source)') === 'problems',
    `read ${JSON.stringify(dirtyRun.map((outcome) => [outcome.unit.name, outcome.status]))}. The packages are derived ` +
      `so that this needs nobody to remember a list.`,
  );
  check(
    'A FILE NO UNIT NAMES (other/) is linted by the rest of the tree',
    statusOf(dirtyRun, 'the rest of the tree') === 'problems',
    `read ${JSON.stringify(dirtyRun.map((outcome) => [outcome.unit.name, outcome.status]))}. Without the rest, the ` +
      `units' union is whatever somebody listed, and a directory added since reads clean.`,
  );

  const testsRun = runLint(eslintPath, lintUnits(testsOnly), testsOnly, LINT_HEAP_BUDGET_MB);
  check(
    'THE SPLIT SEPARATES: a violation in a test file is the tests unit’s, and the source unit stays clean',
    statusOf(testsRun, 'packages/a (tests)') === 'problems' && statusOf(testsRun, 'packages/a (source)') === 'clean',
    `read ${JSON.stringify(testsRun.map((outcome) => [outcome.unit.name, outcome.status]))}.`,
  );

  const cleanRun = runLint(eslintPath, lintUnits(clean), clean, LINT_HEAP_BUDGET_MB);
  check(
    'CONTROL: a clean tree is clean in every unit, a package with no tests included',
    cleanRun.every((outcome) => outcome.status === 'clean'),
    `read ${JSON.stringify(cleanRun.map((outcome) => [outcome.unit.name, outcome.status, outcome.output.slice(0, 200)]))}.`,
  );
  check(
    'EVERY clean unit reports its peak resident memory',
    cleanRun.every((outcome) => typeof outcome.peakMb === 'number' && outcome.peakMb > 0),
    `read ${JSON.stringify(cleanRun.map((outcome) => [outcome.unit.name, outcome.peakMb]))}. The report is what makes ` +
      `growth visible before a crash; a blank one watches nothing.`,
  );

  // A BUDGET NO ESLINT CAN START UNDER, on the clean tree the control just passed: the only difference is the budget.
  const [first] = lintUnits(clean);
  const starved = first === undefined ? [] : runLint(eslintPath, [first], clean, 8);
  check(
    'A UNIT OVER THE BUDGET is reported as the budget, not as a lint problem, on a tree that is otherwise clean',
    starved.length === 1 && starved[0]?.status === 'over-budget',
    `read ${JSON.stringify(starved.map((outcome) => [outcome.unit.name, outcome.status, outcome.output.slice(-300)]))}.`,
  );
} finally {
  for (const at of [everywhere, testsOnly, clean]) rmSync(at, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} lintcheck case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('lintcheck case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
