// @ts-check
/**
 * The placement scan can SEE the defect it was built for, can REFUSE, and does
 * not fire on the scripts that deliberately degrade (finding HHH-1).
 *
 * Every case here exists because a version of this scan got it wrong, and the
 * wrong answers were not near-misses — they were the reassuring one:
 *
 * | version | reported | why |
 * |---|---|---|
 * | `from '…'` matched textually | 28 misplaced steps in a green job | fixture strings and comments |
 * | `npm ci` matched on any line | the one non-installing job as installing | its comments SAY "runs no `npm ci`" |
 * | first script token per line | 0 steps across 4 jobs | a wrapped line's first token is the wrapper |
 * | needing tracked per MODULE | 2 green steps told to move | one module exports both a dying and a living function |
 *
 * The last one is the interesting one and it is why the analysis is per
 * function: `electron.mjs` exports `scriptsLoadingAtRuntime`, which reaches the
 * compiler, and `electronBinaryPath`, which does not.
 *
 * Fixtures are repositories of this repository's SHAPE — `scripts/lib/
 * loadTypeScript.mjs` at that exact path, because it is the declared root — so
 * every case runs against a tree it controls. Two cases run against the real
 * one, including the mutation that reproduces GGG-1.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { scan, scriptsNeedingModules, workflowJobs } from '../lib/nodeModulesPlacement.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 19 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @type {string[]} */
const scratches = [];

/** The declared root, at the path the scan derives from. */
const LOAD_TYPESCRIPT = [
  'export async function loadTypeScript(why) {',
  '  throw new Error(why);',
  '}',
  '',
].join('\n');

/**
 * A module that DIES without the compiler: it calls the loader and catches
 * nothing.
 *
 * The relative specifier is a parameter because it has to resolve from the
 * file's own directory — the first version reused one string for a module in
 * `scripts/lib/` and a proof in `scripts/proofs/`, so the proof imported a
 * file that does not exist, fell out of the needing set, and every case in the
 * fixture reported BLIND. The control refusing is what said so.
 *
 * @param {string} toLib Relative path from this file's directory to `scripts/lib`.
 * @returns {string}
 */
function dyingSource(toLib) {
  return [
    `import { loadTypeScript } from '${toLib}/loadTypeScript.mjs';`,
    'export async function main() { return await loadTypeScript("needed"); }',
    'process.exitCode = await main();',
    '',
  ].join('\n');
}

/** The control every fixture places in the installing job. */
const CONTROL_SOURCE = dyingSource('../lib');
/** The control's path, matching this repository's shape. */
const CONTROL_PATH = 'scripts/proofs/control.proof.mjs';

/**
 * One workflow with two jobs: `build` installs, `guards` does not — and says so
 * in a comment, which is the shape that fooled the first job parser.
 *
 * @param {string[]} buildSteps
 * @param {string[]} guardsSteps
 * @returns {string}
 */
function workflow(buildSteps, guardsSteps) {
  return [
    'name: Fixture',
    'jobs:',
    '  build:',
    '    steps:',
    '      - run: npm ci --ignore-scripts',
    ...buildSteps.map((step) => `      - run: ${step}`),
    '  guards:',
    '    steps:',
    '      # This job runs no `npm ci`, deliberately.',
    ...guardsSteps.map((step) => `      - run: ${step}`),
    '',
  ].join('\n');
}

/**
 * @param {Record<string, string>} files Repository-relative path to contents.
 * @returns {string}
 */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'monstera-placement-'));
  scratches.push(dir);
  /** @type {Record<string, string>} */
  const all = { 'scripts/lib/loadTypeScript.mjs': LOAD_TYPESCRIPT, ...files };
  for (const [path, contents] of Object.entries(all)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  return dir;
}

try {
  // -------------------------------------------------------------------------
  // CAN IT SEE? GGG-1's shape: a script that dies without node_modules, run in
  // the job that has none.
  // -------------------------------------------------------------------------
  {
    const dies = dyingSource('.');
    const root = fixture({
      'scripts/lib/dies.mjs': dies,
      [CONTROL_PATH]: CONTROL_SOURCE,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        ['node scripts/ci/annotate.mjs scripts/lib/dies.mjs'],
      ),
    });
    const result = await scan({ root, control: 'scripts/proofs/control.proof.mjs' });
    check(
      'a script that dies without node_modules, in a job with none, is reported',
      result.violations.length === 1 &&
        result.violations[0]?.script === 'scripts/lib/dies.mjs' &&
        result.violations[0]?.job === 'guards',
      `violations = ${JSON.stringify(result.violations)}. This is GGG-1 exactly: the step fails ` +
        `on every run, on both platforms, and a machine with node_modules cannot reproduce it.`,
    );
    check(
      'CONTROL: the identical script in the installing job is NOT reported',
      !result.blind && result.steps.length === 2,
      `steps = ${JSON.stringify(result.steps)}, blind = ${String(result.blind)}. The two steps ` +
        `run the same code and differ only in the job, so a scan reporting both is not reading ` +
        `the job at all.`,
    );
  }

  // -------------------------------------------------------------------------
  // DOES IT TOLERATE THE DEGRADING SHAPE? This is the false positive that cost
  // two rounds: reaching the compiler is not the same as failing without it.
  // `engineAdvisories.mjs` catches and reports UNVERIFIABLE, which is the
  // register's own philosophy — "could not look" is not "looked and found
  // nothing".
  // -------------------------------------------------------------------------
  {
    const degrades = [
      "import { loadTypeScript } from './loadTypeScript.mjs';",
      'export async function main() {',
      '  try {',
      '    return await loadTypeScript("wanted");',
      '  } catch {',
      '    return "UNVERIFIABLE";',
      '  }',
      '}',
      'process.exitCode = await main();',
      '',
    ].join('\n');
    const root = fixture({
      'scripts/lib/degrades.mjs': degrades,
      [CONTROL_PATH]: CONTROL_SOURCE,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        ['node scripts/ci/annotate.mjs scripts/lib/degrades.mjs'],
      ),
    });
    const result = await scan({ root, control: 'scripts/proofs/control.proof.mjs' });
    check(
      'a script that CATCHES the throw is not reported, even in the job with no modules',
      result.violations.length === 0 && !result.blind,
      `violations = ${JSON.stringify(result.violations)}. Two green steps were told to move by ` +
        `the version that could not tell these apart, and a guard that cries wolf is a guard ` +
        `someone relaxes.`,
    );
    check(
      'CONTROL: and the catch is what does it — a try with only a FINALLY does not',
      (
        await scan({
          root: fixture({
            'scripts/lib/tidies.mjs': degrades.replace('} catch {\n    return "UNVERIFIABLE";', '} finally {\n    void 0;'),
            [CONTROL_PATH]: CONTROL_SOURCE,
            '.github/workflows/a.yml': workflow(
              ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
              ['node scripts/ci/annotate.mjs scripts/lib/tidies.mjs'],
            ),
          }),
          control: 'scripts/proofs/control.proof.mjs',
        })
      ).violations.length === 1,
      `A \`finally\` runs the cleanup and rethrows. Without this the case above is satisfied by ` +
        `a scan that treats any \`try\` as handling, and both shapes are in this repository.`,
    );
  }

  // -------------------------------------------------------------------------
  // PER FUNCTION, NOT PER MODULE. One module, two exports, one of which reaches
  // the compiler. A module-level rule reported every importer of either.
  // -------------------------------------------------------------------------
  {
    const mixed = [
      "import { loadTypeScript } from './loadTypeScript.mjs';",
      'export async function parseWithCompiler() { return await loadTypeScript("needed"); }',
      'export function binaryPath() { return "/somewhere"; }',
      '',
    ].join('\n');
    const innocent = [
      "import { binaryPath } from '../lib/mixed.mjs';",
      'process.stdout.write(binaryPath());',
      '',
    ].join('\n');
    const guilty = [
      "import { parseWithCompiler } from '../lib/mixed.mjs';",
      'await parseWithCompiler();',
      '',
    ].join('\n');
    const root = fixture({
      'scripts/lib/mixed.mjs': mixed,
      [CONTROL_PATH]: CONTROL_SOURCE,
      'scripts/hooks/innocent.mjs': innocent,
      'scripts/hooks/guilty.mjs': guilty,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        [
          'node scripts/ci/annotate.mjs scripts/hooks/innocent.mjs',
          'node scripts/ci/annotate.mjs scripts/hooks/guilty.mjs',
        ],
      ),
    });
    const result = await scan({ root, control: 'scripts/proofs/control.proof.mjs' });
    check(
      'calling the LIVING export of a mixed module is not reported',
      !result.violations.some((step) => step.script === 'scripts/hooks/innocent.mjs'),
      `violations = ${JSON.stringify(result.violations.map((v) => v.script))}. The unit of this ` +
        `analysis has to be the thing a caller actually calls.`,
    );
    check(
      'CONTROL: and calling the DYING export of the same module is',
      result.violations.some((step) => step.script === 'scripts/hooks/guilty.mjs'),
      `violations = ${JSON.stringify(result.violations.map((v) => v.script))}. Without this, ` +
        `"the living export is fine" is satisfied by a scan that finds nothing in that module ` +
        `at all.`,
    );
  }

  // -------------------------------------------------------------------------
  // A BARE IMPORT IS LOAD-TIME, and no catch anywhere can help: the module
  // fails while being evaluated, before a `try` in it or in its importer runs.
  // -------------------------------------------------------------------------
  {
    const bare = [
      "import { z } from 'zod';",
      'export function schema() { return z; }',
      '',
    ].join('\n');
    const caller = [
      "import { schema } from '../lib/bare.mjs';",
      'try { schema(); } catch { process.exitCode = 0; }',
      '',
    ].join('\n');
    const root = fixture({
      'scripts/lib/bare.mjs': bare,
      'scripts/hooks/caller.mjs': caller,
      [CONTROL_PATH]: CONTROL_SOURCE,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        ['node scripts/ci/annotate.mjs scripts/hooks/caller.mjs'],
      ),
    });
    const result = await scan({ root, control: 'scripts/proofs/control.proof.mjs' });
    check(
      'a bare import kills its importer even when every call is caught',
      result.violations.some((step) => step.script === 'scripts/hooks/caller.mjs'),
      `violations = ${JSON.stringify(result.violations.map((v) => v.script))}. Load-time and ` +
        `call-time failures propagate differently, and treating both as call-time is how a ` +
        `catch appears to fix something it cannot reach.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE WRAPPED LINE. `node annotate.mjs <target>` runs the target, and the
  // target is not the token after `node`. Taking the first one reported zero
  // steps across four real jobs.
  // -------------------------------------------------------------------------
  {
    const dies = dyingSource('.');
    const root = fixture({
      'scripts/lib/dies.mjs': dies,
      [CONTROL_PATH]: CONTROL_SOURCE,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        ['node scripts/ci/annotate.mjs scripts/lib/dies.mjs --some-flag'],
      ),
    });
    const result = await scan({ root, control: 'scripts/proofs/control.proof.mjs' });
    check(
      'a WRAPPED step is attributed to its target, not to the wrapper',
      result.violations[0]?.script === 'scripts/lib/dies.mjs',
      `violations = ${JSON.stringify(result.violations)}. Every step in this repository is ` +
        `wrapped, so a scan reading only the first token reads none of them.`,
    );
    check(
      'CONTROL: and a path that runs nothing is not a step at all',
      (
        await scan({
          root: fixture({
            'scripts/lib/dies.mjs': dies,
            [CONTROL_PATH]: CONTROL_SOURCE,
            '.github/workflows/a.yml': workflow(
              ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
              ["echo key=${{ hashFiles('scripts/lib/dies.mjs') }}"],
            ),
          }),
          control: 'scripts/proofs/control.proof.mjs',
        })
      ).violations.length === 0,
      `A cache key names a script and runs nothing. Reporting it is a violation nobody can fix, ` +
        `on a line that cannot fail.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE JOB PARSER, and the defect that made it answer YES because the prose
  // said NO. Both fixtures above already carry the comment; this asserts the
  // classification directly, in both directions.
  // -------------------------------------------------------------------------
  {
    const root = fixture({
      [CONTROL_PATH]: CONTROL_SOURCE,
      '.github/workflows/a.yml': workflow(
        ['node scripts/ci/annotate.mjs scripts/proofs/control.proof.mjs'],
        ['echo nothing'],
      ),
    });
    const jobs = workflowJobs(root);
    check(
      'a job whose COMMENT says it runs no npm ci is not classified as installing',
      jobs.find((job) => job.name === 'guards')?.installs === false,
      `jobs = ${JSON.stringify(jobs)}. Matching the raw line classified guards.yml — which says ` +
        `"this job runs no \`npm ci\`" twice in prose — as installing, and the scan would then ` +
        `have reported a clean tree over the exact defect it was built for.`,
    );
    check(
      'CONTROL: and the job that does run it is',
      jobs.find((job) => job.name === 'build')?.installs === true,
      `jobs = ${JSON.stringify(jobs)}. Without this, the case above is satisfied by a parser ` +
        `that classifies everything as not installing.`,
    );
  }

  // -------------------------------------------------------------------------
  // IT CAN REFUSE.
  // -------------------------------------------------------------------------
  {
    const root = fixture({
      'scripts/lib/quiet.mjs': 'export const quiet = 1;\n',
      '.github/workflows/a.yml': workflow(['echo build'], ['echo guards']),
    });
    const result = await scan({ root, control: 'scripts/proofs/absent.proof.mjs' });
    check(
      'a control that cannot be located makes the scan BLIND, on a clean tree',
      result.blind && result.violations.length === 0,
      `blind = ${String(result.blind)}, violations = ${String(result.violations.length)}. ` +
        `Failing to find a step known to need modules and known to be placed correctly means ` +
        `the import walk, the job parser or the workflow read is broken.`,
    );
  }

  {
    const root = fixture({
      'scripts/lib/quiet.mjs': 'export const quiet = 1;\n',
      '.github/workflows/a.yml': ['name: Fixture', 'jobs:', ''].join('\n'),
    });
    let threw = false;
    try {
      workflowJobs(root);
    } catch {
      threw = true;
    }
    check(
      'a workflow set with fewer than two jobs THROWS',
      threw,
      'A job parser that finds nothing reports "no misplaced steps" over zero jobs, which is ' +
        'the reassuring answer produced by having looked at nothing.',
    );
  }

  {
    const root = fixture({
      'scripts/lib/quiet.mjs': 'export const quiet = 1;\n',
      '.github/workflows/a.yml': [
        'jobs:',
        '  one:',
        '    steps:',
        '      - run: npm ci',
        '  two:',
        '    steps:',
        '      - run: npm ci',
        '',
      ].join('\n'),
    });
    let threw = false;
    try {
      workflowJobs(root);
    } catch {
      threw = true;
    }
    check(
      'and so does a set where EVERY job installs, which is what a prose match reports',
      threw,
      'A regex matching prose classifies every job as installing, and that reads exactly like a ' +
        'repository where every job does. The throw says which, and names the second case as ' +
        'one that replaces this control rather than deletes it.',
    );
  }

  // -------------------------------------------------------------------------
  // THIS REPOSITORY.
  // -------------------------------------------------------------------------
  {
    const result = await scan({ root: ROOT });
    check(
      'THIS repository runs no module-needing script in a job that does not install',
      result.violations.length === 0 && !result.blind,
      `violations = ${JSON.stringify(
        result.violations.map((step) => `${step.file}:${String(step.line)} ${step.script}`),
      )}`,
    );
    check(
      'CONTROL: and it found a non-trivial number of steps and needing scripts',
      result.steps.length > 8 && result.needing.length > 5,
      `steps = ${String(result.steps.length)}, needing = ${String(result.needing.length)}. ` +
        `Counts near zero mean the derivation stopped recognising anything, and "none ` +
        `misplaced" would then be true of almost nothing.`,
    );
    const { needing, loadTime, callTime } = await scriptsNeedingModules(ROOT);
    check(
      'CONTROL: and BOTH kinds of death are represented, so neither branch is dead code',
      loadTime.size > 0 && callTime.size > 0 && needing.size >= loadTime.size,
      `loadTime = ${String(loadTime.size)}, callTime = ${String(callTime.size)}. A branch keyed ` +
        `on the presence of something has a side that never executes wherever that thing is ` +
        `always absent, and this scan has two.`,
    );
    check(
      'and the scan under test is itself in the needing set',
      needing.has('scripts/lib/stackOwnership.mjs'),
      `The check that produced GGG-1 must be one this check covers, or the finding is closed ` +
        `for every script except the one that caused it.`,
    );
  }

  // -------------------------------------------------------------------------
  // REGISTERED, by path, on a line that invokes node — in any workflow.
  // -------------------------------------------------------------------------
  {
    const dir = join(ROOT, '.github', 'workflows');
    const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/u.test(name));
    if (workflows.length === 0) throw new Error(`${dir} holds no workflows to read.`);
    const SCAN_PATH = 'scripts/lib/nodeModulesPlacement.mjs';
    const runsIt = workflows.some((name) =>
      readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .some((line) => line.includes(SCAN_PATH) && line.includes('node ')),
    );
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const script = String(manifest.scripts?.['check:jobplacement'] ?? '');
    check(
      'a workflow actually runs the scan, by path, on a line that invokes node',
      runsIt && script.includes(SCAN_PATH),
      `a workflow runs it: ${String(runsIt)}; check:jobplacement = ${JSON.stringify(script)}.`,
    );
  }
} finally {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
    : roster.format('placement case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
