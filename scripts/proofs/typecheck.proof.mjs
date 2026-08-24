// @ts-check
/**
 * Proof that the typecheck runner separates a broken project from a clean one,
 * and that the parser cannot silently shrink what it runs (rule B2).
 *
 * ## The two failures worth cases
 *
 * A check that compiles the repository has one reassuring answer — *no errors* —
 * and two ways to produce it without having looked:
 *
 *   - the runner reports success for a project that does not compile. That is
 *     the resolution test, and it needs a fixture the absent guard would let
 *     through: a real type error, which nothing but a compiler catches.
 *   - the parser understands fewer segments than the authority declares, so the
 *     typecheck gets smaller and its output still says `ok`.
 *     `parseTypecheckScript` returns `null` for a segment it does not understand
 *     rather than dropping it, precisely so the count can disagree.
 *
 * The clean fixture is not symmetry for its own sake. A runner that reported
 * failure for everything would satisfy the resolution test while blocking every
 * push, and a proof that only asked *does it go red* could not tell the two
 * apart.
 *
 * ## Fixtures are BUILT, never the repository
 *
 * The runner takes its compiler path, invocations and working directory as
 * arguments so this can drive it against two throwaway projects. A runner that
 * could only be exercised by compiling the whole tree would be exercised by
 * nothing — the same reason `engineHostFactory.ts` takes an injected surface.
 *
 * Usage: node scripts/proofs/typecheck.proof.mjs
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { TSC_ENTRY, parseTypecheckScript, runInvocations, segmentsOf } from '../lib/typecheck.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const root = repoRoot();

// ---------------------------------------------------------------------------
// THE PARSER, against the authority itself and against segments it must refuse
// to swallow.
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const authority = String(manifest.scripts?.typecheck ?? '');
const authoritySegments = segmentsOf(authority);
const authorityParsed = parseTypecheckScript(authority);

check(
  "POSITIVE CONTROL: this repository's own typecheck script parses into compiler invocations",
  authoritySegments.length > 0 && authorityParsed.every((args) => args !== null),
  `package.json "typecheck" is ${authority || '(absent)'}, which produced ` +
    `${String(authoritySegments.length)} segment(s) of which ` +
    `${String(authorityParsed.filter((args) => args !== null).length)} were understood. Every ` +
    `other case here is worthless if the parser cannot read the one string it exists to read — ` +
    `and a parser that understood nothing would report a clean typecheck having run no compiler.`,
);

const twoSegments = parseTypecheckScript('tsc --build --pretty && tsc -p tsconfig.scripts.json');
check(
  'two segments become two argument lists, in order and without their command name',
  twoSegments.length === 2 &&
    JSON.stringify(twoSegments[0]) === JSON.stringify(['--build', '--pretty']) &&
    JSON.stringify(twoSegments[1]) === JSON.stringify(['-p', 'tsconfig.scripts.json']),
  `parsed ${JSON.stringify(twoSegments)}. The order is part of it: the second project is compiled ` +
    `against what the first one built.`,
);

const withStranger = parseTypecheckScript('tsc --build && node scripts/build/preload.mjs');
check(
  'a segment that is not a compiler invocation becomes null rather than disappearing',
  withStranger.length === 2 && withStranger[0] !== null && withStranger[1] === null,
  `parsed ${JSON.stringify(withStranger)}. Dropping it would leave the count agreeing with a ` +
    `shorter typecheck, which is the failure that reads as a clean build: the check compares this ` +
    `length against segmentsOf and refuses when they differ, and it can only do that if an ` +
    `unreadable segment still occupies its place.`,
);

check(
  'an empty script yields no segments, so the check refuses rather than reporting zero errors',
  segmentsOf('').length === 0 && segmentsOf('   ').length === 0,
  `segmentsOf('') gave ${String(segmentsOf('').length)}. A missing typecheck script must not read ` +
    `as a typecheck that found nothing wrong.`,
);

// ---------------------------------------------------------------------------
// THE RUNNER, against two fixture projects differing by one type error.
//
// The resolution test item 4a demands: two inputs that differ by the smallest
// thing that would change the answer, confirmed to be reported differently.
// ---------------------------------------------------------------------------
const fixtureRoot = mkdtempSync(join(tmpdir(), 'monstera-typecheck-'));
const tscPath = join(root, TSC_ENTRY);

/**
 * A throwaway TypeScript project holding one file.
 *
 * @param {string} name @param {string} source @returns {string}
 */
function buildProject(name, source) {
  const made = mkdtempSync(join(fixtureRoot, `${name}-`));
  writeFileSync(join(made, 'a.ts'), source, 'utf8');
  writeFileSync(
    join(made, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ['a.ts'] }),
    'utf8',
  );
  return made;
}

try {
  const clean = buildProject('clean', 'export const answer: number = 42;\n');
  const broken = buildProject('broken', "export const answer: number = 'forty-two';\n");

  const cleanRun = runInvocations(tscPath, [['-p', 'tsconfig.json']], clean);
  const brokenRun = runInvocations(tscPath, [['-p', 'tsconfig.json']], broken);

  check(
    'RESOLUTION TEST: a project with one type error is reported as failed',
    brokenRun.failed.length === 1 && brokenRun.failed[0]?.status !== 0,
    `the broken fixture produced ${String(brokenRun.failed.length)} failure(s). A runner that ` +
      `reports success for a project that does not compile is a green check standing in front of ` +
      `a red board, which is the thing it was written to prevent.`,
  );

  check(
    "and the compiler's own output is carried back, not just its status",
    (brokenRun.failed[0]?.output ?? '').includes('TS2322'),
    `the failure carried ${JSON.stringify((brokenRun.failed[0]?.output ?? '').slice(0, 200))}. A ` +
      `red with no diagnostic sends the next reader to run the compiler by hand, which is the ` +
      `step this check exists to remove.`,
  );

  check(
    'VACUITY GUARD: the clean fixture compiles, so the case above is not satisfied by a runner ' +
      'that fails everything',
    cleanRun.failed.length === 0,
    `the clean fixture failed: ${JSON.stringify((cleanRun.failed[0]?.output ?? '').slice(0, 200))}. ` +
      `Without this, "a broken project is reported as failed" is satisfied by a runner that ` +
      `refuses every project — which would pass the resolution test and block every push.`,
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nTypecheck proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`\n${roster.format('typecheck case')}`);
