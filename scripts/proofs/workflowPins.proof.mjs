// @ts-check
/**
 * Proof that the workflow-path scan can see, can refuse, and does not refuse
 * what it must tolerate (finding GG-8, rule B2).
 *
 * The scan's reassuring answer is "found nothing", which is also what a wrong
 * pattern, an empty file list and a mis-dropped line produce. So the cases below
 * are weighted toward the two failures that answer look identical to:
 *
 *   - it cannot find a violation that IS there (the positive control);
 *   - it flags the comments it must tolerate, which is how a check gets turned
 *     off rather than fixed.
 *
 * Usage: node scripts/proofs/workflowPins.proof.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import {
  CONTROL_LINE,
  findProvisionedTreePaths,
  scanWorkflows,
  WORKFLOW_DIR,
} from '../lib/workflowPins.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// It can see. Everything else here is worthless without this.
// ---------------------------------------------------------------------------
check(
  'POSITIVE CONTROL: a violation that IS present is found',
  findProvisionedTreePaths(CONTROL_LINE).length === 1,
  `The scan did not find its own control line. Every way this can break — a wrong separator, a ` +
    `pattern anchored wrong, a line-dropping rule that drops everything — reports the same clean ` +
    `result as a repository with no violations.`,
);

check(
  'and the scan carries that control itself, not only this proof',
  scanWorkflows().controlFound,
  `The proof runs in CI; the scan gets run by hand on the day somebody needs an answer, and a ` +
    `search that cannot demonstrate it finds anything is worthless in exactly that moment.`,
);

// ---------------------------------------------------------------------------
// It refuses the right token, and tolerates the one that only looks like it.
// ---------------------------------------------------------------------------
check(
  'the versioned tree is a violation wherever it appears in a real step',
  findProvisionedTreePaths('        working-directory: .tools/electron/43.4.1').length === 1 &&
    findProvisionedTreePaths('      run: cp x .tools\\electron\\43.4.1\\y').length === 1,
  `Both separators must match: the workflows run bash on Windows runners, so either spelling can ` +
    `appear and a check that saw only one would pass on the other.`,
);

check(
  'CONTROL: `.tools/electron-archives` is NOT a violation',
  findProvisionedTreePaths('          path: .tools/electron-archives').length === 0,
  `The cache path carries no version and is the correct spelling, used by both jobs. A check that ` +
    `rejected it along with the versioned tree would reject the fix as well as the defect, which ` +
    `is how a guard becomes one somebody deletes. The separator after \`electron\` is what ` +
    `distinguishes them.`,
);

// ---------------------------------------------------------------------------
// The comment heuristic, in both directions, against the REAL file.
// ---------------------------------------------------------------------------
{
  const ciYaml = readFileSync(join(repoRoot(), WORKFLOW_DIR, 'ci.yml'), 'utf8');
  const commentOccurrences = ciYaml
    .split('\n')
    .filter((line) => line.trimStart().startsWith('#') && /\.tools[/\\]electron[/\\]/u.test(line)).length;

  check(
    'RESOLUTION: the real workflow still contains commented occurrences to tolerate',
    commentOccurrences > 0,
    `Found ${String(commentOccurrences)}. The case below asserts those are not flagged, and it ` +
      `proves nothing if there are none left to flag — it would pass against a scan that tolerates ` +
      `nothing at all. If the comments were removed, this case must be rewritten rather than ` +
      `deleted, because the heuristic still needs testing.`,
  );

  check(
    'and none of them is reported',
    scanWorkflows().violations.length === 0,
    `The scan reported ${JSON.stringify(scanWorkflows().violations)}. A check that flags the ` +
      `explanation of why the path is dangerous is a check somebody turns off, and then the ` +
      `property is guarded by nothing.`,
  );
}

// ---------------------------------------------------------------------------
// The declared false negative, asserted so it cannot be quietly discovered
// later as though it were news.
// ---------------------------------------------------------------------------
check(
  'DECLARED LIMIT: a content line beginning with `#` inside a block scalar is skipped',
  findProvisionedTreePaths('    # .tools/electron/43.4.1/electron.exe').length === 0,
  `This is the heuristic's false negative and it errs toward SILENCE, which is the dangerous ` +
    `direction for a check whose reassuring answer is "found nothing". It is stated here rather ` +
    `than left to be found: a line that is data rather than a comment, opening with a hash inside ` +
    `a block scalar, passes unscanned. The remedy if it ever matters is a YAML parse, which is ` +
    `heavier than this property needs today — and the positive control above is what keeps the ` +
    `trade honest.`,
);

if (failures.length > 0) {
  process.stderr.write(
    `\nWorkflow pin proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} workflow pin cases passed.\n`);
