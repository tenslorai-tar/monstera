// @ts-check
/**
 * Proof that a failing rendered case's page and trace reach somewhere a person can read them (rule B2; the owner's item
 * of 2026-10-20 after main's run 39408814593 failed once and kept nothing, and of 2026-10-31 after run 41212601632's
 * accessibility gate did the same).
 *
 * Two readers of one value, for each run in `KEPT_RUNS`: the run's CONFIG writes to its directory and, on CI only, keeps
 * a trace (`failureTrace`), and its JOB uploads that directory on failure. The configs are IMPORTED, so what is asserted
 * is what Playwright is handed, not a reading of their text; the workflow cannot be imported, so its copies are checked
 * by `uploadProblems`.
 *
 * THE CONTROLS ARE THE WORKFLOW BROKEN EACH WAY THAT WOULD KEEP NOTHING, for each run and inside that run's own steps:
 * another path, no `failure()` condition, the upload before the run, an unpinned action, another artifact name, and no
 * job at all. Each must be reported, or a clean answer on the real file would be indistinguishable from a checker that
 * cannot see.
 *
 * Usage: node scripts/proofs/visualFailures.proof.mjs (needs node_modules: it loads the Playwright configs).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { UPLOAD_ACTION, jobSteps, uploadProblems } from '../lib/visualFailureUpload.mjs';
import { KEPT_RUNS, failureTrace } from '../test/visualFailures.mjs';

/** @typedef {import('../test/visualFailures.mjs').KeptRun} KeptRun */

/** @type {string[]} */
const failures = [];
// THIRTEEN CASES FOR EACH OF THE TWO RUNS, and the one runner-variable control they share.
const roster = createRoster(failures, { cases: 27 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const ROOT = repoRoot();
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/**
 * Sets, or with `undefined` unsets, the two variables a runner rule could read.
 * @param {{ GITHUB_ACTIONS?: string | undefined, CI?: string | undefined }} env
 */
function setRunnerVariables(env) {
  if (env.GITHUB_ACTIONS === undefined) delete process.env['GITHUB_ACTIONS'];
  else process.env['GITHUB_ACTIONS'] = env.GITHUB_ACTIONS;
  if (env.CI === undefined) delete process.env['CI'];
  else process.env['CI'] = env.CI;
}

/**
 * A run's config as Playwright is handed it, evaluated afresh under `env` (a query makes the import a module of its own),
 * with the process's own values put back after. `tag` alone, with no `env`, is the process's own reading.
 * @param {KeptRun} kept @param {string} tag @param {{ GITHUB_ACTIONS?: string, CI?: string }} [env]
 * @returns {Promise<{ outputDir?: string, use?: { trace?: unknown } }>}
 */
async function configUnder(kept, tag, env) {
  const saved = { GITHUB_ACTIONS: process.env['GITHUB_ACTIONS'], CI: process.env['CI'] };
  if (env !== undefined) setRunnerVariables(env);
  try {
    /** @type {{ default: { outputDir?: string, use?: { trace?: unknown } } }} */
    const module = await import(`../test/${kept.config}?${tag}`);
    return module.default;
  } finally {
    setRunnerVariables(saved);
  }
}

/**
 * A config's trace as an object; a bare mode string is read as Playwright reads it, a trace with its defaults, which
 * record the screencast.
 * @param {{ use?: { trace?: unknown } }} config
 * @returns {{ mode?: unknown, snapshots?: unknown, screenshots?: unknown }}
 */
const traceOf = (config) => {
  const trace = config.use?.trace;
  if (typeof trace === 'string') return { mode: trace, snapshots: true, screenshots: true };
  return typeof trace === 'object' && trace !== null ? trace : {};
};

/** @param {string} from @param {string} to */
const broken = (from, to) => {
  if (WORKFLOW.split(from).length !== 2) throw new Error(`the control's anchor ${JSON.stringify(from.slice(0, 80))} is not in ci.yml exactly once, so this control would mutate nothing, or the wrong step`);
  return WORKFLOW.replace(from, to);
};

for (const kept of KEPT_RUNS) {
  const label = `the ${kept.job} job's ${kept.run}`;
  // IT CAN SEE: the job and its run are found in the real file, or every answer below is about nothing.
  const steps = jobSteps(WORKFLOW, kept.job) ?? [];
  const runStep = steps.find((step) => step.includes(`--npm ${kept.run}`));
  const upload = steps.find((step) => step.includes(`uses: ${UPLOAD_ACTION}@`) && step.includes(`path: ${kept.dir}`));
  check(`POSITIVE CONTROL: ${label} step is found in the real file`, runStep !== undefined, `found ${String(steps.length)} steps in "${kept.job}" and none runs ${kept.run}.`);

  const real = uploadProblems(WORKFLOW, kept);
  check(`${label}: the real job uploads the run's output on failure, after the run, pinned, under its own name`, real.length === 0, real.join('; '));

  const own = await configUnder(kept, `own-${kept.job}`);
  check(
    `${label}: the config Playwright is handed writes where the job uploads from`,
    own.outputDir === join(ROOT, kept.dir),
    `outputDir is ${JSON.stringify(own.outputDir)}; the job uploads ${kept.dir} from the repository's root.`,
  );
  const onRunner = await configUnder(kept, `runner-${kept.job}`, { GITHUB_ACTIONS: 'true' });
  check(
    `${label}: ON CI the config keeps a failing case's trace, with the page's DOM, which the job uploads`,
    traceOf(onRunner).mode === 'retain-on-failure' && traceOf(onRunner).snapshots === true,
    `with GITHUB_ACTIONS=true, use.trace is ${JSON.stringify(onRunner.use?.trace)}.`,
  );
  check(
    `${label}: and records no screencast, which is work inside the page a timed case measures`,
    traceOf(onRunner).screenshots === false,
    `with GITHUB_ACTIONS=true, use.trace is ${JSON.stringify(onRunner.use?.trace)}; the speed case's keystroke ran 43–73 ms ` +
      'median under a screencast against 4–6 without (visualFailures.mjs).',
  );
  const here = await configUnder(kept, `local-${kept.job}`, {});
  check(
    `${label}: LOCALLY the config records no trace, so a local run keeps its speed`,
    traceOf(here).mode === 'off',
    `with no runner variable, use.trace is ${JSON.stringify(here.use?.trace)}.`,
  );
  check(
    `${label}: and the config this process loaded is the one its own environment selects`,
    JSON.stringify(own.use?.trace) === JSON.stringify(failureTrace(process.env)),
    `use.trace is ${JSON.stringify(own.use?.trace)}; this environment selects ${JSON.stringify(failureTrace(process.env))}.`,
  );

  // NO UPLOAD STEP LEAVES THE CONTROLS NOTHING TO BREAK: said as that, and their cases go missing from the roster.
  if (upload === undefined) {
    failures.push(`${label}: the job has no upload step with path ${kept.dir}, so its six controls could not run`);
    continue;
  }
  /** @param {string} name @param {string} workflow @param {RegExp} says */
  const refused = (name, workflow, says) => {
    const problems = uploadProblems(workflow, kept);
    check(`CONTROL (${label}): ${name} is reported`, problems.some((problem) => says.test(problem)), `reported: ${JSON.stringify(problems)}`);
  };
  /** This run's own upload step with `from` made `to`, so a control cannot land on the other job's step. @param {string} from @param {string} to */
  const uploadBroken = (from, to) => {
    if (upload === undefined || !upload.includes(from)) throw new Error(`the control's anchor ${JSON.stringify(from)} is not in ${label}'s upload step`);
    return broken(upload, upload.replace(from, to));
  };
  refused('an upload from another path', uploadBroken(`path: ${kept.dir}`, 'path: test-results'), /path/u);
  refused('an upload that is not conditioned on failure', uploadBroken('        if: failure()\n', ''), /failure/u);
  refused('an action named by a tag rather than a commit', uploadBroken(/uses: actions\/upload-artifact@[0-9a-f]{40}/u.exec(upload ?? '')?.[0] ?? '', 'uses: actions/upload-artifact@v7'), /pinned/u);
  refused('an artifact named as another upload could be', uploadBroken(`name: ${kept.artifact}`, 'name: failures'), /artifact is named/u);
  {
    // THE UPLOAD MOVED AHEAD OF THE RUN: the two steps' texts exchanged in place.
    const swapped = broken(runStep ?? '', '\u0000').replace(upload ?? '', runStep ?? '').replace('\u0000', upload ?? '');
    refused('an upload before the run', swapped, /BEFORE/u);
  }
  refused('a workflow with no such job', broken(`\n  ${kept.job}:\n`, `\n  ${kept.job}-renamed:\n`), /no ".+" job/u);
}

check(
  'CONTROL: another tool’s CI=true, or GITHUB_ACTIONS=false, is not a runner — and the runner and local readings differ',
  failureTrace({ CI: 'true' }).mode === 'off' &&
    failureTrace({ GITHUB_ACTIONS: 'false' }).mode === 'off' &&
    failureTrace({ GITHUB_ACTIONS: 'true' }).mode !== failureTrace({}).mode,
  `CI=true gave ${failureTrace({ CI: 'true' }).mode}, GITHUB_ACTIONS=false gave ${failureTrace({ GITHUB_ACTIONS: 'false' }).mode}. A rule keyed on ` +
    `any CI flag, or on the variable's presence, would turn tracing on for a developer's shell.`,
);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} visualFailures case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('visualFailures case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
