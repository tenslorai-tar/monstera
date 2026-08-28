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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTROL_FIXTURE, report, run, scan, scanFile } from '../lib/domEnvironment.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

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
// THE WALK, WHICH IS WHERE EEEE-1 LIVED. Every case above drives `scanFile`
// directly, and `scanFile` was never the problem — it reported the probe's path
// correctly the whole time. The scan was blind because its WALK looked in two
// directories for two extensions while vitest collects the default pattern from
// the whole repository.
//
// A positive control on the matcher does not test the roots. So these cases
// build a tree and run `scan` over it.
// ---------------------------------------------------------------------------
{
  const root = mkdtempSync(join(tmpdir(), 'monstera-domenv-walk-'));
  try {
    const dom = ['// @vitest-environment happy-dom', 'export {};'].join('\n');

    // The regression case: the exact shape of the probe that slipped through —
    // outside packages/ and apps/, and not a .ts file.
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'probe.test.mjs'), dom, 'utf8');

    // Collected by vitest, so in scope: .tsx, .jsx and a nested .spec.mts.
    mkdirSync(join(root, 'apps', 'desktop', 'src'), { recursive: true });
    writeFileSync(join(root, 'apps', 'desktop', 'src', 'a.spec.mts'), dom, 'utf8');
    writeFileSync(join(root, 'tool.test.jsx'), dom, 'utf8');

    // NOT collected by vitest, so NOT this check's business: an ordinary module
    // that happens to carry the docblock, where it is inert because nothing
    // reads it.
    writeFileSync(join(root, 'helper.mjs'), dom, 'utf8');

    // Excluded by vitest's own `exclude`, and a rich source of false positives:
    // a dependency's own tests are not ours.
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'b.test.js'), dom, 'utf8');
    mkdirSync(join(root, 'packages', 'ui', 'dist'), { recursive: true });
    writeFileSync(join(root, 'packages', 'ui', 'dist', 'c.test.js'), dom, 'utf8');

    const result = scan({ root });
    const reported = result.violations.map((violation) => violation.file).sort();

    check(
      'the walk reaches a .mjs test outside packages/ and apps/ — EEEE-1',
      reported.includes('scripts/probe.test.mjs'),
      `reported ${JSON.stringify(reported)}. This is the exact file that ran under vitest with ` +
        `a working DOM while the scan printed "no test outside packages/ui names one" over 118 ` +
        `files and exited 0. Both halves of that walk were a second opinion about where tests ` +
        `live; the extent now comes from vitest's own collection rule.`,
    );

    check(
      '  ...and every other extension vitest collects',
      reported.includes('apps/desktop/src/a.spec.mts') && reported.includes('tool.test.jsx'),
      `reported ${JSON.stringify(reported)}. Vitest's default is ?(c|m)[jt]s?(x), so a pattern ` +
        `matching .ts and .tsx is wrong on five extensions — and wrong silently, which is the ` +
        `direction that matters.`,
    );

    check(
      '  ...and stops at node_modules, dist, and files vitest does not collect',
      result.filesScanned === 3 &&
        !reported.some((file) => file.includes('node_modules') || file.includes('dist')) &&
        !reported.includes('helper.mjs'),
      `scanned ${String(result.filesScanned)} file(s): ${JSON.stringify(reported)}. The other ` +
        `three are a dependency's own test, a build artefact, and an ordinary module where the ` +
        `docblock is inert because nothing reads it. A check that fired on any of them fires on ` +
        `correct trees, and gets turned off.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
