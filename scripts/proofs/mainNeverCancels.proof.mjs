// @ts-check
/**
 * Proof that the main-never-cancels scan can see, can refuse, and tolerates what
 * it must (finding DDDD-27, rule B2).
 *
 * The scan's reassuring answer is "found nothing", so the cases are weighted
 * toward the failures that look identical to it: a matcher that finds no
 * `concurrency` block at all, and one that accepts an expression which does not
 * protect `main`.
 *
 * **The control case for the fix itself is the third block below.** Reverting
 * either workflow to `cancel-in-progress: true` must turn this red, and that is
 * asserted against the shipped text rather than against a fixture — a proof of
 * this property that only ever reads its own strings would pass on a repository
 * whose workflows had been changed back.
 *
 * Usage: node scripts/proofs/mainNeverCancels.proof.mjs
 */

import {
  CONTROL_TEXT,
  protectsMain,
  readCancelInProgress,
  scanWorkflows,
} from '../lib/mainNeverCancels.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} cancel */
function workflow(cancel) {
  return ['name: X', 'concurrency:', "  group: x-${{ github.ref }}", `  cancel-in-progress: ${cancel}`, 'jobs:'].join(
    '\n',
  );
}

// ---------------------------------------------------------------------------
// It can see. Everything below is worthless without this.
// ---------------------------------------------------------------------------
check(
  'POSITIVE CONTROL: an unconditional cancel that IS present is found',
  readCancelInProgress(CONTROL_TEXT)?.value === 'true',
  `The scan did not find its own control. Every way this can break — an anchor that no longer ` +
    `matches column 0, a block-end rule that ends the block immediately — reports the same clean ` +
    `result as a repository that protects main.`,
);

check(
  'and the scan carries that control itself, not only this proof',
  scanWorkflows().controlFound,
  `The proof runs in CI; the scan gets run by hand on the day somebody needs an answer, and a ` +
    `search that cannot demonstrate it finds anything is worthless in exactly that moment.`,
);

// ---------------------------------------------------------------------------
// It separates. Both directions, because a verdict that only ever says one
// thing separates nothing.
// ---------------------------------------------------------------------------
check(
  'an unconditional `true` does NOT protect main',
  !protectsMain('true'),
  `This is the defect: grouped by ref and cancelling unconditionally, every rapid push to main ` +
    `destroys the previous commit's verdict.`,
);

check(
  'the ref-inequality expression DOES protect main',
  protectsMain("${{ github.ref != 'refs/heads/main' }}"),
  `The accepted spelling must be accepted, or the fix cannot be expressed and the check gets ` +
    `turned off rather than satisfied.`,
);

check(
  'a literal `false` protects main',
  protectsMain('false'),
  `Never cancelling anywhere is a stricter answer to the same question and must not be reported.`,
);

check(
  'THE INVERTED EXPRESSION IS REFUSED, which is why this is not a substring test',
  !protectsMain("${{ github.ref == 'refs/heads/main' }}"),
  `\`== 'refs/heads/main'\` mentions the branch and cancels on it and nowhere else — exactly ` +
    `backwards. A matcher relaxed to "mentions refs/heads/main" would certify the defect it ` +
    `exists to catch.`,
);

check(
  'an expression this scan cannot read is REPORTED rather than passed',
  !protectsMain("${{ !startsWith(github.ref, 'refs/heads/m') }}"),
  `A check that cannot decide must report. Passing the undecidable case is how a scan comes to ` +
    `certify a property it never evaluated.`,
);

// ---------------------------------------------------------------------------
// It tolerates. A check that flags what it should not is a check someone
// disables rather than satisfies.
// ---------------------------------------------------------------------------
check(
  'a workflow with NO concurrency block is not reported',
  readCancelInProgress('name: X\njobs:\n  a:\n    runs-on: ubuntu-latest') === null,
  `Nothing to cancel with is a stricter answer than protecting main, and reporting it would make ` +
    `the check fire on every workflow that never had the defect.`,
);

check(
  'a commented-out setting is not read as the live one',
  readCancelInProgress(['concurrency:', '  # cancel-in-progress: true', '  cancel-in-progress: false'].join('\n'))
    ?.value === 'false',
  `A comment explaining the defect must not BE the defect — the same trap the workflow-path scan ` +
    `pays for in finding GG-8.`,
);

check(
  'a `cancel-in-progress` under a LATER top-level key is not read as this block\u2019s',
  readCancelInProgress(
    ['concurrency:', '  group: x', 'jobs:', '  a:', '    cancel-in-progress: true'].join('\n'),
  ) === null,
  `The block ends at the next column-0 key. Without that, a job-level setting anywhere below ` +
    `would be attributed to the top-level block and reported against the wrong thing.`,
);

// ---------------------------------------------------------------------------
// THE CONTROL FOR THE FIX, against the shipped workflows rather than a fixture.
// ---------------------------------------------------------------------------
{
  const { violations, filesScanned } = scanWorkflows();
  check(
    'THE SHIPPED WORKFLOWS protect main, and there are some to protect',
    violations.length === 0 && filesScanned >= 2,
    `violations=${String(violations.length)} filesScanned=${String(filesScanned)}. The file count ` +
      `is asserted because zero workflows would satisfy "none of them cancels" vacuously, which ` +
      `is the shape an empty input set always produces.`,
  );

  check(
    'CONTROL: reverting one of them to `true` would be reported',
    !protectsMain(readCancelInProgress(workflow('true'))?.value ?? ''),
    `The case above is a claim about the tree as it stands; this is the claim that the check would ` +
      `have noticed had it stood otherwise. Without it, a scan that reported nothing under every ` +
      `input would satisfy the case above forever.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nmain-never-cancels proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${String(passed.length)} main-never-cancels cases passed.\n`);
