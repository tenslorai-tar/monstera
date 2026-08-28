// @ts-check
/**
 * Proof for the DOM-environment scan (`scripts/lib/domEnvironment.mjs`): that
 * it sees, that it refuses, and that it tolerates.
 *
 * ## What this guards, and why the check exists at all
 *
 * `packages/kernel` has no DOM and no Electron, and that is not an aesthetic
 * preference — it is what makes the entire document pipeline unit-testable in
 * milliseconds. Before the component-test vehicle landed, nothing could erode
 * it: no DOM environment was installed, so no test could have had one. Adding
 * `happy-dom` created the capability. The scan is what keeps it inside the one
 * package whose job is rendering.
 *
 * ## The two directions a scan like this fails, and both are asserted
 *
 *   - it stops MATCHING. Then every run says "no test outside packages/ui names
 *     one", which is also what a clean tree says, and the rule quietly stops
 *     existing. The shipped control fixture is what separates those.
 *   - it matches TOO MUCH. A scan that reported the permitted `packages/ui`
 *     docblock, or an explicit `node` one, would fire on correct code — and a
 *     check that fires on correct code is a check somebody turns off.
 *
 * ## The rule is "not node", and that is the case worth reading
 *
 * A deny-list of `happy-dom` and `jsdom` would pass `edge-runtime`, and pass
 * whatever vitest ships next, with silence as the failure mode. The
 * unknown-environment case below is what pins the fail-closed direction: an
 * environment name this project has never heard of must be reported.
 *
 * Usage: node scripts/proofs/domEnvironment.proof.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTROL_FIXTURE, report, run, scan, scanFile } from '../lib/domEnvironment.mjs';
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

// ---------------------------------------------------------------------------
// THE POSITIVE CONTROL. The fixture the module ships must be reported, and the
// runner refuses when it is not — which is the branch that makes every clean
// result below mean something.
// ---------------------------------------------------------------------------
{
  const control = scanFile(CONTROL_FIXTURE.path, CONTROL_FIXTURE.text);

  check(
    'the shipped control fixture yields exactly one violation',
    control.violations.length === 1,
    `got ${String(control.violations.length)}. The control is a kernel test naming a DOM ` +
      `environment; if the scan cannot see that, its silence about the tree is worthless.`,
  );

  check(
    '  ...and it names the environment it found, not just the file',
    control.violations[0]?.environment === 'happy-dom',
    `got ${JSON.stringify(control.violations[0]?.environment)}. The report has to say which ` +
      `environment was named, or the reader cannot tell a DOM from a typo.`,
  );
}

// ---------------------------------------------------------------------------
// IT REFUSES. An empty walk is executed rather than described: `run` against a
// directory with no packages/ or apps/ must return non-zero WITHOUT claiming
// the tree is clean.
// ---------------------------------------------------------------------------
{
  const empty = mkdtempSync(join(tmpdir(), 'monstera-domenv-'));
  try {
    const code = run({ root: empty });
    check(
      'a root with nothing to scan is a refusal, not a pass',
      code === 1,
      `run() returned ${String(code)} for a root containing no TypeScript at all. An empty ` +
        `file list is a broken walk; reporting it as clean is how a wrong root becomes ` +
        `permanent coverage nobody has.`,
    );

    const result = scan({ root: empty });
    check(
      '  ...and the empty scan is distinguishable from a clean one by its counts',
      result.filesScanned === 0 && result.violations.length === 0,
      `filesScanned=${String(result.filesScanned)}, violations=` +
        `${String(result.violations.length)}. "Found nothing" has to carry the size of what it ` +
        `looked at, or zero files and a clean tree print the same sentence.`,
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// IT TOLERATES. Three shapes that are correct and must not be reported.
// ---------------------------------------------------------------------------
{
  const permitted = scanFile(
    'packages/ui/src/dialog.test.tsx',
    ['// @vitest-environment happy-dom', 'export {};'].join('\n'),
  );
  check(
    'a packages/ui test may name a DOM',
    permitted.violations.length === 0 && permitted.docblocks === 1,
    `reported ${String(permitted.violations.length)} violation(s) from ` +
      `${String(permitted.docblocks)} docblock(s). Rendering is that package's job; a scan ` +
      `that forbids it there forbids the vehicle it was written to protect.`,
  );

  const explicitNode = scanFile(
    'packages/kernel/src/save.test.ts',
    ['// @vitest-environment node', 'export {};'].join('\n'),
  );
  check(
    'a kernel test may say node out loud',
    explicitNode.violations.length === 0 && explicitNode.docblocks === 1,
    `reported ${String(explicitNode.violations.length)}. Naming the default explicitly is not ` +
      `a departure from it, and reporting it would punish the clearer of two correct files.`,
  );

  const ordinary = scanFile('packages/kernel/src/save.test.ts', 'export {};');
  check(
    'an ordinary file with no docblock is neither reported nor counted',
    ordinary.violations.length === 0 && ordinary.docblocks === 0,
    `violations=${String(ordinary.violations.length)}, docblocks=` +
      `${String(ordinary.docblocks)}. The docblock count is the scan's own evidence that it ` +
      `examined anything; inflating it with files that carry none would make that number lie.`,
  );
}

// ---------------------------------------------------------------------------
// IT FAILS CLOSED. The rule is "must be node", not "must not be one of the two
// DOMs we know about" — so a name nobody has heard of is a violation.
// ---------------------------------------------------------------------------
{
  const unknown = scanFile(
    'apps/desktop/src/window.test.ts',
    ['// @vitest-environment edge-runtime', 'export {};'].join('\n'),
  );
  check(
    'an environment this project has never heard of is reported',
    unknown.violations.length === 1 && unknown.violations[0]?.environment === 'edge-runtime',
    `got ${JSON.stringify(unknown.violations.map((violation) => violation.environment))}. A ` +
      `deny-list of happy-dom and jsdom passes every environment vitest ships next, with ` +
      `silence as the failure mode. This case is what pins the direction.`,
  );

  const custom = scanFile(
    'packages/contract/src/frame.test.ts',
    ['// @vitest-environment ./myEnvironment.ts', 'export {};'].join('\n'),
  );
  check(
    '  ...including a path to a locally written environment',
    custom.violations.length === 1,
    `a custom environment module was not reported. Vitest accepts a specifier here, so a ` +
      `pattern that only matches bare words is evaded by writing the DOM yourself.`,
  );
}

// ---------------------------------------------------------------------------
// The tree as it stands. Not a claim that the tree is interesting — a claim
// that the scan reports the SIZE of what it looked at, so a future empty run
// cannot read as a clean one.
// ---------------------------------------------------------------------------
{
  const result = scan();
  check(
    'the tree scan reports a scope alongside its verdict',
    result.filesScanned > 0 && report(result).includes(String(result.filesScanned)),
    `filesScanned=${String(result.filesScanned)} and the report does not carry it. "No test ` +
      `outside packages/ui names one" from zero files and the same sentence from a real walk ` +
      `are indistinguishable without the count.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nDOM-environment scan proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThe kernel's freedom from a DOM is what makes the document pipeline testable in ` +
      `milliseconds. A scan that cannot separate these cases reads as protecting that and ` +
      `does not.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(roster.format('DOM-environment case'));
