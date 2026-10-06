// @ts-check
/**
 * The lint: `npm run lint`, and `npm run check:lint` for the local sweep, are this file (ADR-0170).
 *
 * ## One process per unit, under one heap budget
 *
 * The lint was `eslint .`, one process holding a TypeScript program for every tsconfig at once, and it grew until
 * GitHub's Ubuntu runner aborted it at V8's heap limit (about 3.9 GB, twice in three runs) and the owner's PC, with a
 * 2 GB default, had failed it for three weeks. Linted alone, no unit needs more than 2 GB. So each unit runs in its
 * own process, one after another, and the memory each held is released when it ends.
 *
 * A unit is a package's source or a package's tests, for every directory under `packages/` and `apps/` that holds a
 * `package.json` — derived, so a package added tomorrow is linted with no edit here; then `scripts/`; then THE REST,
 * the whole tree less those, which is what makes the units' union `.` by construction rather than by a list somebody
 * keeps.
 *
 * ## The budget is a heap limit, and the report is resident memory
 *
 * Every unit runs under {@link LINT_HEAP_BUDGET_MB}. A unit that needs more ends at V8's heap limit, and the run says
 * that unit went over the budget, by name. Every unit's peak resident memory is printed on every run, so the growth
 * that took three weeks to crash is a number in every CI log.
 *
 * ## The gap `check:lint` closes (finding DDDD-7)
 *
 * `checkLocal.mjs` derives its set from every `check:*` and `proof:*` name, so the lint reaches the sweep that runs
 * before a push only through this name. Measured when it was added: `7ba978c` carried four ordinary lint errors, the
 * sweep reported 14 of 14 passed, and CI failed at Lint on all three jobs.
 *
 * ## The interpreter is invoked directly, never the `.bin` shim
 *
 * `node_modules/eslint/bin/eslint.js` is a JavaScript entry point; the `.bin` shim is a platform-specific wrapper,
 * and this repository has already paid for resolving a shim by hand.
 *
 * `proof:lintcheck` drives {@link runLint} against built trees: a violation in each kind of unit is reported, a clean
 * tree is not, and a budget too small to start under is reported as the budget.
 *
 * Usage: npm run lint
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** ESLint's JavaScript entry point, relative to the root. */
export const ESLINT_ENTRY = join('node_modules', 'eslint', 'bin', 'eslint.js');

/**
 * The heap, in megabytes, that every lint unit runs under (ADR-0170 Decision 3).
 *
 * The default heap of the smallest machine this repository is linted on: the owner's PC, 11.9 GB, where V8 sizes
 * the heap at about 2 GB (it failed `eslint .` from 2026-09-13). Below every machine's own default, so it raises
 * nothing, and the same on every machine, so a lint that passes in CI passes there.
 *
 * Headroom, read on 2026-10-05 at `91450ef5` on the cloud session machine: the largest units, `packages/ui`'s source
 * and its tests, each pass under 1,536 MB (1,635 and 1,610 MB peak resident). All of `ui` in one process fails at
 * 1,536 and passes at 2,048, which is why source and tests are two units.
 */
export const LINT_HEAP_BUDGET_MB = 2048;

/** The test files of a package, linted as their own unit. */
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];

/** The directories whose packages are units: each child of these that holds a `package.json`. */
const PACKAGE_PARENTS = ['packages', 'apps'];

/**
 * One lint process: a name for the report, and the arguments ESLint is given.
 *
 * @typedef {{ readonly name: string, readonly args: readonly string[] }} LintUnit
 */

/**
 * The units of the tree at `root`, in the order they run (ADR-0170 Decision 2).
 *
 * @param {string} root
 * @returns {LintUnit[]}
 */
export function lintUnits(root) {
  const packages = PACKAGE_PARENTS.flatMap((parent) => {
    const at = join(root, parent);
    if (!existsSync(at)) return [];
    return readdirSync(at, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(at, entry.name, 'package.json')))
      .map((entry) => `${parent}/${entry.name}`)
      .sort();
  });
  const notTests = TEST_FILES.flatMap((pattern) => ['--ignore-pattern', pattern]);
  /** @type {LintUnit[]} */
  const units = packages.flatMap((dir) => [
    { name: `${dir} (source)`, args: [dir, ...notTests] },
    // A PACKAGE WITH NO TESTS matches nothing, which is not an error here: its source unit still ran.
    { name: `${dir} (tests)`, args: ['--no-error-on-unmatched-pattern', ...TEST_FILES.map((pattern) => `${dir}/${pattern}`)] },
  ]);
  const own = [...packages];
  if (existsSync(join(root, 'scripts'))) {
    units.push({ name: 'scripts', args: ['scripts'] });
    own.push('scripts');
  }
  // THE REST: everything the units above do not name, so a file anywhere else is still linted.
  units.push({ name: 'the rest of the tree', args: ['.', ...own.flatMap((dir) => ['--ignore-pattern', `${dir}/**`])] });
  return units;
}

/**
 * One unit's outcome.
 *
 * @typedef {{
 *   readonly unit: LintUnit,
 *   readonly status: 'clean' | 'problems' | 'over-budget' | 'failed',
 *   readonly peakMb: number | null,
 *   readonly seconds: number,
 *   readonly output: string,
 * }} UnitOutcome
 */

/**
 * Runs every unit, one process each under `heapMb`, and answers each one's outcome. Every unit runs whatever an
 * earlier one found, so a red lint names every unit's problems as one process did.
 *
 * Injectable rather than reading the repository, so the proof drives it against built trees with their own config.
 *
 * @param {string} eslintPath absolute path to ESLint's entry point
 * @param {readonly LintUnit[]} units
 * @param {string} cwd
 * @param {number} heapMb
 * @returns {UnitOutcome[]}
 */
export function runLint(eslintPath, units, cwd, heapMb) {
  const report = join(repoRoot(), 'scripts', 'lib', 'lintPeakReport.mjs');
  return units.map((unit) => {
    const started = Date.now();
    const run = spawnSync(
      process.execPath,
      [`--max-old-space-size=${String(heapMb)}`, '--import', pathToFileURL(report).href, eslintPath, ...unit.args],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
    );
    const seconds = (Date.now() - started) / 1000;
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    const peak = peakOf(run.output[3]);
    // V8'S OWN WORDS at its heap limit, the one way a unit ends over the budget: the process aborts before the report
    // is written, so no peak is read and the status cannot be mistaken for a lint problem.
    const overBudget = run.status !== 0 && /heap out of memory/u.test(run.stderr ?? '');
    /** @type {UnitOutcome['status']} */
    const status = overBudget ? 'over-budget' : run.status === 0 ? 'clean' : run.status === 1 ? 'problems' : 'failed';
    return { unit, status, peakMb: peak, seconds, output };
  });
}

/**
 * The peak a unit's preload wrote, in megabytes, or `null` where it wrote none — a process that ended at the heap
 * limit, or one the preload never reached.
 *
 * @param {string | null | undefined} written
 * @returns {number | null}
 */
function peakOf(written) {
  if (written === null || written === undefined || written === '') return null;
  const parsed = /** @type {{ maxRssKb?: unknown }} */ (JSON.parse(written));
  return typeof parsed.maxRssKb === 'number' ? Math.round(parsed.maxRssKb / 1024) : null;
}

if (isMain(import.meta.url)) {
  const root = repoRoot();
  const eslintPath = join(root, ESLINT_ENTRY);
  if (!existsSync(eslintPath)) {
    process.stderr.write(
      `ESLint is not at ${ESLINT_ENTRY}, so nothing was linted. Run \`npm ci\` and try again — a lint that cannot ` +
        `find its linter must not report a clean tree.\n`,
    );
    process.exit(1);
  }

  const outcomes = runLint(eslintPath, lintUnits(root), root, LINT_HEAP_BUDGET_MB);
  for (const { unit, status, peakMb, seconds, output } of outcomes) {
    const measured = `${peakMb === null ? 'no peak read' : `peak ${String(peakMb)} MB resident`}, ${seconds.toFixed(0)} s`;
    if (status === 'clean') {
      process.stdout.write(`  ok  ${unit.name}: ${measured}\n`);
      if (output !== '') process.stdout.write(`${output}\n`);
      continue;
    }
    const why =
      status === 'over-budget'
        ? `went over the lint heap budget of ${String(LINT_HEAP_BUDGET_MB)} MB (LINT_HEAP_BUDGET_MB, ADR-0170). The ` +
          `unit has grown past what the smallest linting machine can hold; split it or make it cheaper, and do not ` +
          `raise the budget to make this pass`
        : status === 'problems'
          ? 'reported problems'
          : 'failed';
    process.stderr.write(`\nFAIL  ${unit.name}: ${why} (${measured})\n${status === 'over-budget' ? '' : `${output}\n`}`);
  }
  const red = outcomes.filter((outcome) => outcome.status !== 'clean');
  if (red.length > 0) {
    process.stderr.write(`\n${String(red.length)} of ${String(outcomes.length)} lint unit(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write(
    `  ok  ${String(outcomes.length)} lint unit(s) reported no problems, each under ${String(LINT_HEAP_BUDGET_MB)} MB ` +
      `of heap, and together they cover the whole tree\n`,
  );
}
