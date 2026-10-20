// @ts-check
/**
 * Proof that a failing visual case's page and trace reach somewhere a person can read them (rule B2; the owner's item of
 * 2026-10-20 after main's run 39408814593 failed once and kept nothing).
 *
 * Two readers of one value: the visual run's CONFIG writes to `VISUAL_OUTPUT_DIR` and keeps a trace by `VISUAL_TRACE`,
 * and the visual JOB uploads that directory on failure. The config is IMPORTED, so what is asserted is what Playwright
 * is handed, not a reading of its text; the workflow cannot be imported, so its copy is checked by `uploadProblems`.
 *
 * THE CONTROLS ARE THE WORKFLOW BROKEN EACH WAY THAT WOULD KEEP NOTHING: another path, no `failure()` condition, the
 * upload before the comparison, an unpinned action, and no visual job at all. Each must be reported, or a clean answer
 * on the real file would be indistinguishable from a checker that cannot see.
 *
 * Usage: node scripts/proofs/visualFailures.proof.mjs (needs node_modules: it loads the Playwright config).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { COMPARE_RUN, jobSteps, uploadProblems, VISUAL_JOB } from '../lib/visualFailureUpload.mjs';
import visualConfig from '../test/visual.config.mjs';
import { VISUAL_OUTPUT_DIR, VISUAL_TRACE } from '../test/visualFailures.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const ROOT = repoRoot();
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

// IT CAN SEE: the job and its comparison are found in the real file, or every answer below is about nothing.
const steps = jobSteps(WORKFLOW, VISUAL_JOB) ?? [];
check(
  'POSITIVE CONTROL: the real visual job is found, with its comparison step',
  steps.some((step) => step.includes(COMPARE_RUN)),
  `found ${String(steps.length)} steps in "${VISUAL_JOB}" and none runs ${COMPARE_RUN}.`,
);

const real = uploadProblems(WORKFLOW);
check('the real visual job uploads the visual run’s output on failure, after the comparison, pinned', real.length === 0, real.join('; '));

check(
  'the config Playwright is handed writes where the job uploads from',
  visualConfig.outputDir === join(ROOT, VISUAL_OUTPUT_DIR),
  `outputDir is ${JSON.stringify(visualConfig.outputDir)}; the job uploads ${VISUAL_OUTPUT_DIR} from the repository's root.`,
);
check(
  'and keeps a failing case’s trace',
  visualConfig.use?.trace === VISUAL_TRACE && VISUAL_TRACE === 'retain-on-failure',
  `use.trace is ${JSON.stringify(visualConfig.use?.trace)}.`,
);

/** @param {string} from @param {string} to */
const broken = (from, to) => {
  if (!WORKFLOW.includes(from)) throw new Error(`the control's anchor ${JSON.stringify(from)} is not in ci.yml, so this control would mutate nothing`);
  return WORKFLOW.replace(from, to);
};
/** @param {string} name @param {string} workflow @param {RegExp} says */
const refused = (name, workflow, says) => {
  const problems = uploadProblems(workflow);
  check(`CONTROL: ${name} is reported`, problems.some((problem) => says.test(problem)), `reported: ${JSON.stringify(problems)}`);
};

refused('an upload from another path', broken(`path: ${VISUAL_OUTPUT_DIR}`, 'path: test-results'), /path/u);
refused('an upload that is not conditioned on failure', broken('        if: failure()\n        uses: actions/upload-artifact', '        uses: actions/upload-artifact'), /failure/u);
refused('an action named by a tag rather than a commit', broken(/uses: actions\/upload-artifact@[0-9a-f]{40}/u.exec(WORKFLOW)?.[0] ?? '', 'uses: actions/upload-artifact@v7'), /pinned/u);
{
  // THE UPLOAD MOVED AHEAD OF THE COMPARISON: the two steps' texts exchanged in place.
  const upload = steps.find((step) => step.includes('actions/upload-artifact')) ?? '';
  const compare = steps.find((step) => step.includes(COMPARE_RUN)) ?? '';
  const swapped = broken(compare, '\u0000').replace(upload, compare).replace('\u0000', upload);
  refused('an upload before the comparison', swapped, /BEFORE/u);
}
refused('a workflow with no visual job', broken(`  ${VISUAL_JOB}:`, '  visual-renamed:'), /no "visual" job/u);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} visualFailures case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('visualFailures case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
