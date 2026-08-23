// @ts-check
/**
 * Runs every check and proof this repository declares, DERIVED from
 * `package.json` rather than chosen.
 *
 * ## Why deriving matters more than the running (finding PPP-1)
 *
 * A commit went red on two guards that had both passed nothing, because I picked
 * which checks to run and picked by what I thought I had touched. Neither
 * failing check was on that list and neither would ever have been: the
 * connection from *a research probe imports the build* to *prove nothing can
 * trigger an unpinned Electron download* is not one intuition makes.
 *
 * **Selecting checks by relevance is a search, and its reassuring answer is
 * "nothing to run".** So the set is taken from the manifest, the way
 * `annotateCoverage.mjs` takes its proof set from the same place — every script
 * named `check:*` or `proof:*`, with no judgement anywhere in the path.
 *
 * ## WHAT THIS DOES NOT SEE, and the limits are the point
 *
 * PPP-1's first remedy was *run the whole Guards set locally*, and the reviewing
 * seat showed it catches neither of the two defects it was written for. That is
 * recorded plainly here rather than left to be rediscovered:
 *
 *   1. **A PROVISIONING-KEYED BRANCH.** The Guards failure was a case needing
 *      `apps/desktop/dist/`, which exists on a developer machine and not on a
 *      job that builds nothing. Running everything here would have been GREEN
 *      before the fix. This is audit item 3's inverse — the richer machine is
 *      the one that hides it — and no local sweep of any completeness can reach
 *      it.
 *   2. **A CI-ONLY PROOF.** `electronImports.proof.mjs` is invoked from
 *      `ci.yml` and from no Guards job. A script that is not in the manifest, or
 *      is registered only as a workflow path, is outside this set by
 *      construction.
 *
 * **The mechanism for both is the board.** This is a way to spend a minute
 * before pushing, not a way to stop reading the board afterwards.
 *
 * ## A third limit, and it is about the EVIDENCE for this tool (finding QQQ-1)
 *
 * The corrected harness was first verified against the ten `check:*` scripts —
 * fast, spawning almost nothing. The defect it was correcting (a shell-killed
 * timeout orphaning a script's children) **cannot occur in that half**, because
 * nothing there times out and almost nothing spawns. So the evidence came from
 * the region where the bug was structurally impossible, which is audit item 2
 * exactly, and the third time in one stretch that the easy shape was the one
 * measured.
 *
 * The `proof:*` half is where the defect lived, and it was swept: **it does not
 * complete, and no timeout makes it.** `proof:cff` rebuilds libmupdf from source
 * with two patches reverted, because its control has to reproduce the
 * out-of-bounds read the pinned build fixes. The sweep stopped there and named
 * the 44 scripts it never reached as not-passes, which is correct behaviour and
 * also the answer: **the proof half is not a pre-push operation.**
 *
 * So this tool is useful over `check:*` and is not a sweep of everything — and
 * as of finding WWW-2 that is enforced rather than said: a run selecting more
 * than one `proof:*` script in THIS repository is refused before it starts, with
 * no flag to turn it off. The measurement and the boundary are on the refusal
 * itself, below `filtered`. What
 * separates a runnable script from `proof:cff` is **measured cost**, not job
 * membership — see the note on {@link DURATIONS} for why the job-based version
 * of that rule is false and fails in the reassuring direction. The sweep records
 * what each script cost and runs cheapest-first, so a stop strands the expensive
 * tail rather than an alphabetical remainder.
 *
 * ## Three states, because two would lie
 *
 * `ok`, `FAILED`, and `TIMED OUT`. A script this harness cut short has not
 * passed, and reporting it as one would be the same collapse the register
 * refuses between *could not look* and *looked and found nothing*.
 *
 * ## Why the npm script is `local` and not `check:local`
 *
 * The derivation matches every `check:*` and `proof:*` name, so a script called
 * `check:local` would derive ITSELF and recurse until the machine gives up. The
 * name is load-bearing; renaming it into the pattern it scans is the obvious
 * tidy-up and it is the one thing not to do.
 *
 * Usage: node scripts/checkLocal.mjs [--timeout <seconds>] [--only <substring>]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { multiProofSweepRefusal } from './lib/sweepScope.mjs';
import { treeMovedSince, witnessTree } from './lib/treeWitness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Below this, the derivation is broken rather than the repository small.
 *
 * A manifest that parsed to an empty object, a renamed `scripts` key, or a
 * filter that stopped matching all report the same clean "nothing failed" —
 * which is the one output every way of breaking a search shares. There were 60+
 * such scripts when this floor was written; it is set well under that so an
 * ordinary deletion does not trip it, and well over zero so a broken derivation
 * cannot pass as a quiet repository.
 */
const FLOOR = 30;

const argv = process.argv.slice(2);
const timeoutIndex = argv.indexOf('--timeout');
const TIMEOUT_MS =
  timeoutIndex === -1 ? 180_000 : Number(argv[timeoutIndex + 1] ?? '180') * 1000;
const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex === -1 ? null : (argv[onlyIndex + 1] ?? null);

// `--root` and `--floor` exist so this tool can be pointed at a fixture
// repository, which is the only way its own failure paths can be exercised
// (finding QQQ-2). The convention is the one stackOwnership.mjs and
// nodeModulesPlacement.mjs already use — a scan that reads a tree takes the tree
// as an argument. `--floor` is NOT a way to disable the positive control: a
// fixture with three scripts still has to declare a floor, and the proof carries
// a case requiring the floor to refuse a set below it.
const rootIndex = argv.indexOf('--root');
const ROOT_DIR = rootIndex === -1 ? ROOT : resolve(argv[rootIndex + 1] ?? ROOT);
const floorIndex = argv.indexOf('--floor');
const FLOOR_REQUIRED = floorIndex === -1 ? FLOOR : Number(argv[floorIndex + 1] ?? String(FLOOR));

/** @type {Record<string, string>} */
let scripts;
try {
  const manifest = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
  scripts = manifest.scripts ?? {};
} catch (cause) {
  process.stderr.write(`Could not read package.json: ${String(cause)}\n`);
  process.exit(70);
}

const derived = Object.keys(scripts)
  .filter((name) => name.startsWith('check:') || name.startsWith('proof:'))
  .sort();

if (derived.length < FLOOR_REQUIRED) {
  process.stderr.write(
    `Derived only ${String(derived.length)} check/proof scripts from package.json, under a ` +
      `floor of ${String(FLOOR_REQUIRED)}.\nThat is a broken derivation, not a quiet ` +
      `repository — a renamed "scripts" key and a filter that stopped matching both report ` +
      `zero failures.\n`,
  );
  process.exit(1);
}

/**
 * Measured cost per script, from previous runs. DATA, not a list.
 *
 * ## Why ordering by duration and not by job (finding RRR-1)
 *
 * The obvious idea — *a proof registered in a job that provisions something is
 * not a pre-push proof* — is false, and false in the reassuring direction. A
 * developer machine IS provisioned; that is what provisioning is for. What makes
 * `proof:cff` unrunnable here is not its job, it is that `cffOobProof.mjs`
 * copies the MuPDF source, strips the bounds checks and runs MSBuild over the
 * patched tree. **The cost is inside the script and it is not in the YAML.**
 *
 * Applied literally that rule also takes out far more than intended: the build
 * job provisions Electron, so composition, contract, boundaries, kernelload,
 * stackOwnership, jobPlacement, win32Handle, lintRules, lintIgnores,
 * electronImports, preloadSurface and testResolution all go with it, and the
 * shim job takes six more. The local set collapses to the Guards proofs —
 * roughly thirty fast, unit-shaped checks dropped, and those are exactly the
 * ones most likely to catch something before a push. It shrinks in the direction
 * that looks good: fewer scripts finish sooner and print all-green sooner, and
 * nothing in the output separates *excluded correctly* from *excluded by a wrong
 * premise*. That is the classifier shape this repository has fixed five separate
 * defects in, arriving inside the derivation meant to replace a hand-list.
 *
 * A hand-maintained slow-list is a list. A duration table produced by running
 * the sweep is data, so this measures rather than models — and it stays honest
 * on a machine faster or slower than the one it was written on.
 *
 * Untracked and rebuildable: losing it costs one unordered run.
 */
const DURATIONS = join(ROOT_DIR, '.cache', 'checkLocal-durations.json');

/** @type {Record<string, number>} */
let known = {};
try {
  known = JSON.parse(readFileSync(DURATIONS, 'utf8'));
} catch {
  // No table yet, or an unreadable one. Both mean "nothing measured", which the
  // ordering below treats as expensive rather than cheap.
  known = {};
}

/**
 * What the tree looked like before any script ran (finding WWW-1).
 *
 * THIS HARNESS KILLS CHILDREN, and a killed process does not run its `finally`.
 * Measured 2026-08-23: a 90-second sweep killed `documentScope.proof.mjs` inside
 * the case that removes a TRACKED document to prove `check:docs` reads the
 * index, and `docs/ENGINE-SPIKE.md` stayed deleted. Nothing said so. A commit
 * about something else would have carried the deletion.
 *
 * The stop-at-first-timeout rule was written on the premise that wreckage
 * accumulates through orphaned processes. It also accumulates in the FILESYSTEM,
 * and that half had no mechanism.
 *
 * So the tree is witnessed here and compared at the end, and a sweep whose tree
 * moved says so instead of printing a clean result. Same third state as
 * everywhere else: *these scripts passed* and *these scripts passed against a
 * tree this run damaged* must not share an output.
 *
 * `null` when the root is not a git repository, which is the ordinary case for
 * the fixture repositories `checkLocal.proof.mjs` builds — there is nothing
 * there to protect and no git to ask.
 */
let treeBefore = null;
try {
  treeBefore = witnessTree({ root: ROOT_DIR });
} catch {
  // Not a git repository. Reported at the end rather than silently, because
  // "the tree did not move" and "nobody looked" are the distinction this whole
  // file is built around.
}

const filtered = ONLY === null ? derived : derived.filter((name) => name.includes(ONLY));

/**
 * THE MULTI-PROOF SWEEP IS REFUSED, NOT DOCUMENTED (finding WWW-2).
 *
 * A full sweep of this repository prints failures it invented. Measured
 * 2026-08-23, fourth pass at a 90-second bound: **35 scripts failed in 0.0
 * seconds each, and every one of them passed when run alone.** The tool's own
 * output then carried a note explaining them, which is the worse of the two
 * available states — a reader who trusts the note learns to discount red, and a
 * reader who does not gets 35 false diagnoses. This project already wrote that
 * a scan which cries wolf is a scan someone relaxes.
 *
 * The earlier repair confined this to TIMEOUTS: a timeout kills the shell and
 * orphans the real process, so the sweep stops at the first one rather than
 * measuring against its own wreckage. That is not the whole class. The 35 above
 * followed scripts that **completed**, so something a finished script leaves
 * behind is enough, and **the mechanism is not established.** Naming an
 * unproven mechanism here would be worse than saying so (Rule 0).
 *
 * So the mode is made unavailable rather than forbidden — the same move the
 * escape-write hook made over a rule that had been written down seven times.
 * There is no override for the same reason there is none there: an escape hatch
 * would be a workaround with a flag on it.
 *
 * THE BOUNDARY IS WHERE THE DEFECT CANNOT OCCUR, not a round number. The
 * failures are cross-script contamination, so a run that executes at most one
 * `proof:*` script has nothing to be contaminated BY. `--only check:` — the
 * habitual pre-push sweep, eleven scripts, repeatedly green — is unaffected
 * because it selects no proofs at all, which is evidence the check half does not
 * contaminate.
 *
 * Scoped to THIS repository. A fixture repository built by
 * `checkLocal.proof.mjs` has three trivial scripts and no wreckage, and the
 * measurement was never taken there; refusing it would block the only way this
 * file's own failure paths can be exercised (QQQ-2).
 *
 * WHAT WOULD UNBLOCK IT: find the mechanism, then give each script its own job
 * object so its children die with it. Killing a process tree properly on Windows
 * needs one, which is a real unit and not something to bury in a convenience
 * script.
 *
 * The decision and its message live in {@link multiProofSweepRefusal} — the
 * boundary has a side this end-to-end path cannot exercise cheaply, and that
 * side is the one whose failure gets a guard disabled.
 */
const refusal = multiProofSweepRefusal({ rootDir: ROOT_DIR, repoRoot: ROOT, selected: filtered });
if (refusal !== null) {
  process.stderr.write(refusal);
  process.exit(78);
}

/**
 * Three buckets, and the middle one is the whole point (finding SSS-1).
 *
 *   measured under budget, ascending → never measured → measured at or over
 *   budget, ascending
 *
 * The stop-at-first-timeout stranded 44 scripts alphabetically, most of which
 * would have finished in seconds. Ascending order makes the strand set the
 * expensive tail instead of an arbitrary remainder.
 *
 * **Never-measured sorted LAST, and that stranded new scripts permanently.**
 * Three facts interlocked: unmeasured sorts behind everything, the sweep stops
 * at the first timeout, and `proof:cff` times out on every run for a reason no
 * bound accommodates — it runs MSBuild over a patched MuPDF tree. So a newly
 * added proof sorted behind a script that always strands the queue, was reported
 * *never measured*, and therefore sorted last again next time. It was not "not
 * yet measured", it was "will never be measured", and the two printed
 * identically — the exact collapse the three-state reporting below refuses.
 *
 * The cost landed in precisely the wrong place: a cheap new proof, the kind most
 * worth running before a push, stranded by a rule protecting against an
 * expensive one.
 *
 * Sorting the unknown FIRST is still wrong — one new expensive script would
 * strand everything again — but that argument never reached the middle. A script
 * whose last recorded cost hit the budget is one this sweep already knows it
 * cannot finish, so the unknown gets its one chance after all the cheap work has
 * completed and ahead only of the portion that was going to strand anyway. The
 * risk is confined to the doomed tail, and the never-measured set is bounded to
 * one sweep's worth instead of growing without limit.
 *
 * The buckets are distinguishable because a timeout's elapsed time is recorded
 * like any other — see the note at the `known[name]` assignment below, which
 * exists for a different reason and makes this one possible.
 *
 * "Never measured" is still reported as its own state, because it must not read
 * as "cheap".
 */
const BUDGET_SECONDS = TIMEOUT_MS / 1000;

/** @param {string} name @returns {0 | 1 | 2} */
function costBucket(name) {
  const cost = known[name];
  if (cost === undefined) return 1;
  return cost >= BUDGET_SECONDS ? 2 : 0;
}

const selected = [...filtered].sort((a, b) => {
  const left = costBucket(a);
  const right = costBucket(b);
  if (left !== right) return left - right;
  // Within the unknown bucket there is nothing to order by, so keep it stable.
  if (left === 1) return a.localeCompare(b);
  return (known[a] ?? 0) - (known[b] ?? 0);
});

process.stdout.write(
  `${String(selected.length)} of ${String(derived.length)} declared check/proof script(s), ` +
    `derived from package.json.\n\n`,
);

/** @type {string[]} */
const failed = [];
/** @type {string[]} */
const timedOut = [];

/** @type {string[]} */
const notNode = [];
let passedCount = 0;

for (const name of selected) {
  // NODE DIRECTLY, NOT `npm run`, and this was measured rather than preferred.
  //
  // The first version spawned `npm run --silent <name>` with `shell: true` and a
  // timeout. On Windows that kills the SHELL and leaves the real node process
  // running, and every script after the first timeout then failed in 0.2s with
  // no output at all — three real timeouts followed by twenty spurious
  // failures. Run in isolation each of those passed in four seconds.
  //
  // A harness that invents failures is worse than none: this project has already
  // written that a scan which cries wolf is a scan someone relaxes. Invoking the
  // interpreter directly means the timeout kills the thing actually running.
  const command = scripts[name] ?? '';
  const parts = command.split(/\s+/u).filter((part) => part !== '');
  if (parts[0] !== 'node') {
    // Reported, not skipped. A script this harness cannot invoke is a hole in
    // the derivation, and a hole that prints nothing is the derivation lying
    // about its own coverage.
    notNode.push(`${name} (${command})`);
    process.stdout.write(`  NOT RUN  ${name} — not a bare \`node\` invocation\n`);
    continue;
  }
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, parts.slice(1), {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const took = `${seconds.toFixed(1)}s`;
  // Recorded for EVERY outcome, including a timeout: a script killed at the
  // bound cost at least that much, so the figure still sorts it late next time.
  // Recording only successes would put a repeatedly-timing-out script back at
  // the front of the queue on every run.
  known[name] = Number(seconds.toFixed(1));

  // `signal` is how spawnSync reports a timeout kill, and it must not be read
  // as an ordinary non-zero exit: one is "this check says no", the other is
  // "this harness stopped listening".
  // A TIMEOUT STOPS THE SWEEP. Measured, and it is not caution.
  //
  // `spawnSync`'s timeout kills the child it started and not that child's own
  // grandchildren, and several proofs here spawn node or Electron. So every
  // timeout leaves processes running, they accumulate, and the machine slows
  // under them: a run with a 60s bound reported `check:docs` — which takes two
  // seconds — as TIMED OUT, third in the list. Everything after the first
  // timeout is measuring the harness's own wreckage.
  //
  // Killing a process tree properly on Windows needs a job object, which is a
  // real unit of work and not one to bury in a convenience script. Until then
  // the honest behaviour is to stop: one unreadable measurement is a reason to
  // look, and twenty invented ones are a reason to stop using the tool.
  if (run.signal !== null && run.signal !== undefined) {
    timedOut.push(name);
    process.stdout.write(
      `  TIMED OUT  ${name} (${took})\n` +
        `      STOPPING. A timeout orphans that script's own child processes, and every\n` +
        `      result after one is measured against a machine carrying them. Re-run with\n` +
        `      --timeout raised, or --only, rather than reading what would follow.\n`,
    );
    break;
  }
  if (run.status !== 0) {
    failed.push(name);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const firstProblem =
      output
        .split('\n')
        .find((line) => /\b(FAIL|Error|error)\b/u.test(line))
        ?.trim() ?? '(no diagnostic line found)';
    // NOT TRUNCATED. This tool exists to surface failures, and cutting the
    // failure text at 200 characters in the one place it is printed is the
    // reflex this session already lost time to twice — a diagnostic clipped
    // before its reason is a diagnostic that sends someone to re-run the script
    // by hand. `firstProblem` is already ONE selected line, so there is no
    // volume argument for the cut either.
    process.stdout.write(`  FAILED  ${name} (${took})\n      ${firstProblem}\n`);
    continue;
  }
  passedCount += 1;
  process.stdout.write(`  ok  ${name} (${took})\n`);
}

// COUNTED FROM WHAT RAN, not from what was selected. The sweep stops at the
// first timeout, so `selected.length` would report every script it never
// reached as a pass — the arithmetic quietly inventing the result the operator
// was hoping for.
const attempted = failed.length + timedOut.length + notNode.length + passedCount;
process.stdout.write(
  `\n${String(passedCount)} passed, ${String(failed.length)} failed, ` +
    `${String(timedOut.length)} timed out, ${String(notNode.length)} not run — ` +
    `${String(attempted)} of ${String(selected.length)} attempted.\n`,
);
// WRITTEN EVEN ON A PARTIAL RUN, and before the summary. A sweep that stopped
// early still measured everything up to the stop, and that is exactly the run
// whose ordering most needs improving next time.
try {
  mkdirSync(dirname(DURATIONS), { recursive: true });
  writeFileSync(DURATIONS, `${JSON.stringify(known, null, 2)}\n`, 'utf8');
} catch (cause) {
  process.stdout.write(`\nCould not record durations to ${DURATIONS}: ${String(cause)}\n`);
}

if (attempted < selected.length) {
  const unreached = selected.slice(attempted);
  process.stdout.write(
    `${String(unreached.length)} script(s) were never reached and are NOT passes:\n`,
  );
  for (const name of unreached) {
    const cost = known[name];
    // "never measured" is its own state and is printed as one. Ordering puts
    // these last precisely because nothing is known about them, and a blank
    // where a duration should be reads as cheap to anyone skimming.
    process.stdout.write(
      `      ${name} — ${cost === undefined ? 'never measured' : `last took ${String(cost)}s`}\n`,
    );
  }
}
// THE TREE, compared against the witness taken before anything ran (WWW-1).
//
// Printed before the exit code is decided and folded into it, because a sweep
// that damaged the repository is not a sweep whose green means anything — and
// the damage is silent by construction: a killed proof leaves a deleted file,
// not a message.
let treeMoved = null;
if (treeBefore !== null) {
  treeMoved = treeMovedSince(treeBefore);
  process.stdout.write(
    treeMoved === null
      ? '  ok  the working tree and index are as this run found them\n'
      : `\nTHE TREE MOVED UNDER THIS RUN — ${treeMoved}\n\n` +
          `  A script this harness KILLED does not run its cleanup, so a proof that removes a\n` +
          `  tracked file to make a point leaves it removed. Check \`git status\` before doing\n` +
          `  anything else: the results above were measured against a tree that changed, and\n` +
          `  the change may be a deletion nobody mentioned.\n`,
  );
} else {
  process.stdout.write(
    '  --  the tree was not witnessed: this root is not a git repository\n',
  );
}

// WHAT THESE CHECKS ACTUALLY READ (finding AAAA-7).
//
// Six of them read the INDEX rather than the working tree, deliberately, so they
// answer about the tree the commit will leave: check:docs, the emitted-template
// scan, the stack-owner scan, the staged-syntax parse, the file policy and the
// secret scan. Run before `git add`, every one of them inspects the PREVIOUS
// content and passes — correctly, about a question the reader did not ask.
//
// Measured: a `|` added inside a FEATURES table cell split the row, `check:docs`
// was run immediately afterwards and printed nine passes, and Guards went red on
// the next push. The check was not wrong; it had read the old blob.
//
// A count of differing paths, not a list of which checks care, because a
// hand-kept list of index-reading scripts is the second wiring place — and the
// statement is true of the run as a whole whatever the set contained.
//
// NOT folded into the exit code. Editing and sweeping before staging is
// ordinary, and a harness that failed on it would be turned off; the tree
// witness above fails because a tree that moved makes the results meaningless,
// which is a different fact.
const unstaged = spawnSync('git', ['diff', '--name-only'], {
  cwd: ROOT_DIR,
  encoding: 'utf8',
});
if (unstaged.status === 0) {
  const differing = unstaged.stdout.split('\n').filter((line) => line.trim() !== '');
  process.stdout.write(
    differing.length === 0
      ? '  ok  the index matches the working tree, so index-reading checks saw your edits\n'
      : `\n  !!  ${String(differing.length)} file(s) differ between your working tree and the ` +
          `index,\n      so every index-reading check above inspected the PREVIOUS content:\n` +
          `${differing
            .slice(0, 8)
            .map((path) => `        ${path}\n`)
            .join('')}` +
          (differing.length > 8 ? `        ... and ${String(differing.length - 8)} more\n` : '') +
          `      Stage them and run again before trusting a pass. check:docs, the\n` +
          `      emitted-template scan, the stack-owner scan, the staged-syntax parse, the\n` +
          `      file policy and the secret scan all read the index by design.\n`,
  );
}
if (notNode.length > 0) {
  process.stdout.write(`Not a bare node invocation: ${notNode.join(', ')}\n`);
}
if (timedOut.length > 0) {
  process.stdout.write(
    `Timed out is NOT passed: ${timedOut.join(', ')}\n` +
      `Raise --timeout, or run those on the board.\n`,
  );
}
process.stdout.write(
  'This set cannot see a provisioning-keyed branch or a proof registered only in a ' +
    'workflow. The board is the mechanism; this is the minute before the push.\n',
);

process.exit(
  failed.length === 0 && timedOut.length === 0 && notNode.length === 0 && treeMoved === null
    ? 0
    : 1,
);
