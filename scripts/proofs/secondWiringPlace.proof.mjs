// @ts-check
/**
 * Proof for ADR-0029 Decision 4's scan (`scripts/lib/secondWiringPlace.mjs`):
 * that it sees, that it refuses, and that it tolerates.
 *
 * ## Why this file carries the whole burden today
 *
 * There is no command registry and no surfaces directory, so the scan examines
 * nothing and prints NOTHING TO SCAN. That is the honest state and it is also
 * the state in which a blind scan and a working one are indistinguishable — so
 * every claim about whether the rule can SEE lives here, on fixtures.
 *
 * `borderTokens.proof.mjs` carries the identical burden for the identical
 * reason, and the shape is worth copying rather than re-deriving.
 *
 * ## The three states, and why the middle one is the reason this scan is safe
 *
 * A scan pointed at a directory that never materialises reports *found nothing*
 * for the life of the project. That is X-1's root axis, which this repository
 * has paid for twice — most recently in `check:domenvironment`, one range ago,
 * in an instrument written the same morning as the finding.
 *
 * So the scope is tied to the registry rather than hoped for, and the state that
 * would otherwise be a silent pass — **a registry exists and the surfaces
 * directory does not** — is a refusal. Both are executed here rather than
 * described, against fixture roots.
 *
 * Usage: node scripts/proofs/secondWiringPlace.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import {
  CONTROL_FIXTURE,
  REGISTRY_MODULE,
  SURFACES_DIR,
  isScannable,
  run,
  scan,
  scanModule,
} from '../lib/secondWiringPlace.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 16 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {(root: string) => void} body */
function withFixtureRoot(body) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-wiring-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** @param {string} root */
function giveRegistry(root) {
  mkdirSync(dirname(join(root, REGISTRY_MODULE)), { recursive: true });
  writeFileSync(join(root, REGISTRY_MODULE), 'export const commands = {};\n', 'utf8');
}

// ---------------------------------------------------------------------------
// IT SEES. The shipped control fixture must be reported, and the runner refuses
// when it is not.
// ---------------------------------------------------------------------------
{
  const control = scanModule('ribbon.tsx', CONTROL_FIXTURE);
  check(
    'the shipped control fixture yields exactly one violation',
    control.length === 1,
    `got ${String(control.length)}. The control is a pasted two-command list, which is the ` +
      `exact shape §7 forbids; a scan that cannot see it says "no second wiring place" forever.`,
  );

  check(
    '  ...and it names the commands it found, not just the file',
    control[0]?.ids.join(',') === 'document.save,document.print',
    `got ${JSON.stringify(control[0]?.ids)}. The report has to name the list, or the reader ` +
      `cannot tell a pasted ribbon from an unrelated array of strings.`,
  );

  // FINDING DDDDD-2. Everything above feeds the MATCHER a string and never
  // reaches `modulesIn`, so a walker that returned nothing left the control
  // passing and the scan silent. The filter is the walker's decidable half and
  // the runner now refuses on it; these two cases are what make that refusal
  // non-vacuous, in both directions.
  check(
    'the file filter admits a surface module',
    isScannable('ribbon.tsx') && isScannable('ribbon.ts'),
    `a filter that answers no to everything makes the walker return an empty list, and an ` +
      `empty walk prints the same sentence as a clean tree.`,
  );

  check(
    '  ...and excludes a projection’s own cases',
    !isScannable('ribbon.test.ts') && !isScannable('ribbon.test.tsx'),
    `a filter that answers yes to everything restores the false positives the exclusion exists ` +
      `to remove — every projection's expected output is a list of command ids.`,
  );
}

// ---------------------------------------------------------------------------
// IT TOLERATES. Three shapes that are correct and must not be reported.
// ---------------------------------------------------------------------------
{
  check(
    'a single id is an argument, not a list',
    scanModule('x.tsx', "dispatch(['document.save']);").length === 0,
    `a one-element array was reported. One id is how a command is referred to; a list is what ` +
      `a hand-maintained layout looks like, and a rule that fires on the first is a rule ` +
      `somebody turns off.`,
  );

  check(
    'an array of ordinary strings is not a command list',
    scanModule('x.tsx', "const sizes = ['small', 'large', 'huge'];").length === 0,
    `an unrelated array was reported. Command ids are domain-qualified; bare words are not, ` +
      `and reporting them would fire on correct code all over the package.`,
  );

  check(
    'a projection reading the registry is not a violation',
    scanModule('x.tsx', 'const items = registry.byPlacement(surface);').length === 0,
    `a registry read was reported. That is the shape this rule exists to REQUIRE.`,
  );
}

// ---------------------------------------------------------------------------
// THE THREE STATES, executed against fixture roots rather than described.
// ---------------------------------------------------------------------------
withFixtureRoot((root) => {
  const result = scan({ root });
  check(
    'with no registry, the state is no-registry rather than a clean scan',
    result.state === 'no-registry' && result.filesScanned === 0,
    `state=${result.state}. Nothing can be a second wiring place before a first one exists, ` +
      `and saying so is different from saying the tree is clean.`,
  );
  check(
    '  ...and the runner exits 0, because that is not a failure',
    run({ root }) === 0,
    `the runner failed on a repository that has no registry yet. This scan ships before the ` +
      `surfaces it governs, which is the whole point (B9's argument one layer up); refusing ` +
      `here would make it a check somebody deletes.`,
  );
});

withFixtureRoot((root) => {
  giveRegistry(root);
  const result = scan({ root });

  // THE CASE THIS SCAN EXISTS TO SURVIVE. A registry with the surfaces
  // elsewhere is what would otherwise pass silently for the life of the
  // project — X-1's root axis, which this repository has paid for twice.
  check(
    'a registry with no surfaces directory is a REFUSAL, not a pass',
    result.state === 'no-surfaces',
    `state=${result.state}. A scan pointed at a directory that never materialises reports ` +
      `"found nothing" forever and reads as coverage.`,
  );
  check(
    '  ...and the runner exits non-zero for it',
    run({ root }) === 1,
    `the runner passed a repository whose projections are being written somewhere it is not ` +
      `looking. That is the silent state the third branch exists to make loud.`,
  );
});

withFixtureRoot((root) => {
  giveRegistry(root);
  mkdirSync(join(root, SURFACES_DIR), { recursive: true });
  writeFileSync(join(root, SURFACES_DIR, 'ribbon.tsx'), `${CONTROL_FIXTURE}\n`, 'utf8');

  const result = scan({ root });
  check(
    'a real surfaces directory is walked, and the pasted list in it is found',
    result.state === 'scanned' && result.violations.length === 1 && result.filesScanned === 1,
    `state=${result.state}, files=${String(result.filesScanned)}, violations=` +
      `${String(result.violations.length)}. The walker and the matcher are separate failures ` +
      `and both produce "found nothing"; this is the case that exercises the walker.`,
  );
  check(
    '  ...and the runner reports it',
    run({ root }) === 1,
    `the runner passed a surfaces directory containing a hand-written command list.`,
  );
});

withFixtureRoot((root) => {
  giveRegistry(root);
  mkdirSync(join(root, SURFACES_DIR), { recursive: true });
  // THE SAME BYTES IN TWO FILES, which is what makes this pair separate the
  // exclusion from a scan that simply stopped working. A list in `ribbon.tsx`
  // must be reported and the identical list in `ribbon.test.ts` must not, so a
  // walker that skipped everything passes neither.
  writeFileSync(join(root, SURFACES_DIR, 'ribbon.test.ts'), `${CONTROL_FIXTURE}\n`, 'utf8');
  // FINDING DDDDD-1, AND THIS CASE USED TO ASSERT THE DEFECT. It required
  // `run() === 0` here — a directory holding only test files reported as clean —
  // which is the third branch's own condition wearing the first branch's
  // output. The exclusion is still right; what was wrong is that the refusal
  // was keyed on the DIRECTORY existing, and `isScannable` broke the
  // equivalence between that and having anything to read.
  check(
    'a surfaces directory with nothing scannable in it is REFUSED, not called clean',
    run({ root }) === 1 && scan({ root }).state === 'no-surfaces',
    `a directory holding only a projection's own cases is semantically "no surfaces here", and ` +
      `reporting it as scanned-with-zero-files is the silent state the third branch exists to ` +
      `make loud. Narrowing a search's input set creates a new route to its reassuring answer.`,
  );

  writeFileSync(join(root, SURFACES_DIR, 'ribbon.tsx'), `${CONTROL_FIXTURE}\n`, 'utf8');
  check(
    '  ...and the CONTROL: the identical list in a shipped module still is',
    run({ root }) === 1 && scan({ root }).filesScanned === 1,
    `the exclusion swallowed a real violation, or the walker now skips everything. Same ` +
      `bytes, same directory, one file name apart.`,
  );
});

withFixtureRoot((root) => {
  giveRegistry(root);
  mkdirSync(join(root, SURFACES_DIR), { recursive: true });
  writeFileSync(
    join(root, SURFACES_DIR, 'ribbon.tsx'),
    'export const Ribbon = () => registry.byPlacement("ribbon");\n',
    'utf8',
  );
  check(
    'a surfaces directory that only projects is clean, and says how much it looked at',
    run({ root }) === 0 && scan({ root }).filesScanned === 1,
    `a correct surface was reported, or the scan claimed a clean result over zero files. ` +
      `"None found" from an empty walk and from a real one are the same sentence without ` +
      `the count.`,
  );
});

if (failures.length > 0) {
  process.stderr.write(
    `\nSecond-wiring-place proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nADR-0029 rejects trusting review by name, because this project's record on rules ` +
      `without mechanisms is seven occurrences for one of them. A scan that cannot separate ` +
      `these cases is that rule with a green check on it.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(roster.format('second-wiring-place case'));
