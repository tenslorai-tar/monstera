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
 * So this tool is useful over `check:*` and is not a sweep of everything. What
 * separates a runnable script from `proof:cff` is **measured cost**, not job
 * membership — see the note on {@link DURATIONS} for why the job-based version
 * of that rule is false and fails in the reassuring direction. The sweep records
 * what each script cost and runs cheapest-first, so a stop strands the expensive
 * tail rather than an alphabetical remainder.
 *
 * **WWW-2 once turned that observation into a REFUSAL, and the refusal is gone
 * (UUUU-1).** This paragraph went on asserting it from `0f7f7de`, which deleted
 * it, until `1e66a61` — *"refused before it starts, with no flag to turn it off
 * … the boundary is below `filtered`"*, pointing at a boundary that no longer
 * exists and at `sweepScope.mjs`, which does not either. What actually happens
 * now is described where it happens, under *THE SCANNING ROSTER RUNS* and
 * *THE MULTI-PROOF SWEEP WAS REFUSED HERE, AND IS NOT ANY MORE*; the stale
 * sentence kept the position a reader treats as *what this module is*.
 *
 * Recorded here rather than silently deleted, because the shape is the point
 * (finding XXXX-1): it was a **compound** claim whose second half — measured
 * cost, not job membership — is still exactly true, so the paragraph read fine
 * to anyone checking the part that still held.
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
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { affectedProofs, affectedProofsReport } from './lib/affectedProofs.mjs';
import { uncommittedPaths } from './lib/gitScope.mjs';
import { binaryMap, resolveScript } from './lib/npmScriptSteps.mjs';
import { retention, runLogName } from './lib/runLog.mjs';
import { ciVerifiers, verifiersNotRunByCi } from './lib/ciVerifiers.mjs';
import { classifySpawn } from './lib/spawnOutcome.mjs';
import { SCANNING_PROOFS, rosterMiscount } from './lib/scanningProofs.mjs';
import { treeMovedSince, witnessTree } from './lib/treeWitness.mjs';
import { PARTIAL_MARKER, UNVERIFIABLE_MARKER } from './lib/unverifiable.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Below this, the derivation is broken rather than the repository small.
 *
 * A manifest that parsed to an empty object, a renamed `scripts` key, a
 * workflow directory that read as empty, or a filter that stopped matching all
 * report the same clean "nothing failed" — the one output every way of breaking
 * a search shares. There were 60+ such scripts when this floor was written and
 * 109 when the roster moved to the workflows; it is set well under that so an
 * ordinary deletion does not trip it, and well over zero so a broken derivation
 * cannot pass as a quiet repository.
 *
 * **It is not the shrink anchor**, and must not be mistaken for one. A floor
 * catches a derivation that collapsed; it cannot notice a check quietly dropped
 * from CI, because 108 clears 30 as comfortably as 109 does. That direction is
 * `verifiersNotRunByCi`'s, below.
 */
const FLOOR = 30;

/**
 * Every `check:`/`proof:` script CI does not run, and the mechanism that covers
 * it instead.
 *
 * ## Why an exception list is the right shape here, and a roster is not
 *
 * The roster is derived because its danger is growth — a check added and
 * forgotten. This list is the opposite: it is the set of deliberate absences,
 * and a deliberate absence has a REASON, which is a thing a person writes and
 * reads. Deriving it would mean deriving the reasons, and a reason nobody wrote
 * down is one that gets relitigated by whoever it inconveniences — the same
 * argument `.gitleaks.toml`'s `[allowlist]` and `electronImports.proof.mjs`'s
 * accounted set both make.
 *
 * Each entry is a claim that something ELSE runs it. If that stops being true,
 * the entry is wrong and no check here can tell — which is why the reason names
 * the mechanism rather than saying *deliberate*.
 */
const NOT_RUN_BY_CI = new Map([
  [
    'check:lint',
    'CI runs `npm run lint` directly; this is the sweep-side wrapper that gives lint a ' +
      'check-shaped exit and a diagnostic line.',
  ],
  [
    'check:types',
    'CI runs `npm run typecheck` directly; same wrapper shape as check:lint.',
  ],
  [
    'check:lockfile',
    'the pre-commit hook imports lockfileIntegrity.mjs and runs it on every commit that ' +
      'touches dependencies, which is earlier than CI and cannot be skipped.',
  ],
  [
    'check:typeonlyexports',
    'the pre-commit set is the gate, against the index; ci.yml runs the PROOF as the ' +
      'completeness control over the emit, which is a different question.',
  ],
  [
    'check:testanchors',
    'the pre-commit hook runs it on every commit, and CI STRUCTURALLY CANNOT: it compares a ' +
      'staged blob against HEAD, and a runner checks out HEAD — so both sides would be the same ' +
      'blob and every run would print the reassuring answer. Registering it there would add a ' +
      'green step that cannot fail. guards.yml runs proof:testanchors instead, which drives the ' +
      'counter and the comparison over constructed blobs.',
  ],
]);

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
/** Executable name to the JavaScript node runs for it. See {@link binaryMap}. */
/** @type {Map<string, string>} */
let BINARIES;
try {
  const manifest = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
  scripts = manifest.scripts ?? {};
  // Both fields, because which one a tool sits in is a packaging decision and
  // not a statement about whether a script may run it — `tsc` and `vitest` are
  // dev dependencies and the gate needs them most.
  BINARIES = binaryMap(ROOT_DIR, {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  });
} catch (cause) {
  process.stderr.write(`Could not read package.json: ${String(cause)}\n`);
  process.exit(70);
}

/**
 * THE ROSTER IS WHAT THE WORKFLOWS RUN, not what the names look like (ZZZZ-1).
 *
 * This was `Object.keys(scripts).filter(name => name.startsWith('check:') ||
 * name.startsWith('proof:'))`, and it could not see `notice:check` — the check
 * that caught a stale `NOTICE` and reddened the board — nor `brand:check`,
 * `guard:tree`, `perf:gate`, `electron:surface`, `shim:reach` or `ocr:doors`.
 * The run that missed them printed **29 of 29** and exited 0: a script outside
 * the pattern produces no error, no warning and no absence anybody can see.
 *
 * Renaming them into the pattern was rejected because it relocates the
 * judgement rather than removing it — the same prefix space holds `brand:check`
 * and `brand:generate`, `notice:check` and `notice:generate`. The authority on
 * what must pass is the workflow files, this repository already parses them, and
 * `ciVerifiers.mjs` asks that question once (B3a).
 *
 * `local` is not in the set, which is what stops this sweep running itself:
 * `npm run local` appears in `ci.yml` only inside a comment, and the derivation
 * skips comment lines for the reason `annotateCoverage.mjs` already documents.
 */
const derived = ciVerifiers({ root: ROOT_DIR }).names;

/*
 * THE ANCHOR, AND IT RUNS THE OTHER WAY FROM THE DERIVATION (checklist 4c).
 *
 * A roster derived from the workflows tracks growth perfectly and **agrees with
 * any shrink**, because a set computed from a collection cannot disagree with
 * that collection. Delete a CI step and the check leaves this sweep too, with
 * nothing to notice — the ZZZZ-1 failure arriving from the other side, and this
 * time invisible in both places at once.
 *
 * `package.json` is where the shrink cannot reach: it still names every
 * `check:` and `proof:` script whatever CI does. So every one of them must be
 * run by some workflow, and an orphan is a hard failure with the name printed,
 * not a smaller number nobody counts.
 *
 * This is checked BEFORE the sweep runs, because it is the claim that makes
 * everything after it mean something.
 */
{
  const { orphans, declaredNames, declared, run } = verifiersNotRunByCi({ root: ROOT_DIR });
  const unaccounted = orphans.filter((name) => !NOT_RUN_BY_CI.has(name));
  if (unaccounted.length > 0) {
    process.stderr.write(
      `${String(unaccounted.length)} check/proof script(s) are declared in package.json and run ` +
        `by no workflow:\n` +
        unaccounted.map((name) => `  ${name}`).join('\n') +
        `\n\nA check the board does not run cannot redden the board, so this sweep running it ` +
        `is the only thing standing between it and nobody. Either register it in a workflow, or ` +
        `add it to NOT_RUN_BY_CI naming the mechanism that covers it instead.\n`,
    );
    process.exit(1);
  }

  // A stale exception is the same defect wearing the other hat: an entry
  // claiming something is not in CI, for a script CI now runs, is a reason
  // nobody will re-read and a line that makes the list look considered.
  //
  // SCOPED TO WHAT THIS ROOT DECLARES. An entry naming a script the manifest
  // does not have is not stale, it is inapplicable — and every entry is
  // inapplicable under `--root`, which is how this tool's own failure paths are
  // exercised (QQQ-2). Without the scope the harness cannot run at all, and the
  // repair for that would have been to weaken the check.
  const stale = [...NOT_RUN_BY_CI.keys()].filter(
    (name) => declaredNames.includes(name) && !orphans.includes(name),
  );
  if (stale.length > 0) {
    process.stderr.write(
      `${String(stale.length)} entr(ies) in NOT_RUN_BY_CI name a script a workflow now runs:\n` +
        stale.map((name) => `  ${name}`).join('\n') +
        `\n\nRemove them. An exception that no longer excepts anything reads as a considered ` +
        `decision and is a stale sentence.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `${String(run)} of ${String(declared)} declared check/proof script(s) are run by a workflow; ` +
      `${String(NOT_RUN_BY_CI.size)} accounted for elsewhere.\n`,
  );
}

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

/**
 * Every script's outcome from the LAST run, written as it goes (finding AAAA-23).
 *
 * The sweep's one-proof bound rests on a pass that printed 35 failures at 0.0
 * seconds. Going back to ask what those 35 actually SAID — the harness prints one
 * diagnostic line per failure, or `(no diagnostic line found)` when there was
 * none — the answer is that nobody kept them. The commit and the journal entry
 * preserved the count and the conclusion and not the evidence, so the question
 * that would separate a spawn-level failure from an import-time throw cannot be
 * asked of the only occurrence.
 *
 * A standing bound whose founding observation kept no evidence is a bound that
 * can never be re-derived, only re-argued. So every run now leaves its rows
 * behind: the next time this mode is exercised the lines exist whether or not
 * anyone thought to capture them, which is the difference between a measurement
 * and a memory of one.
 *
 * Written incrementally rather than at the end, because the run this matters for
 * is the one that gets killed.
 *
 * ## ONE SLOT SURVIVES EXACTLY AS LONG AS NOBODY REACTS TO IT (finding AAAA-25)
 *
 * The first version wrote a single `checkLocal-lastrun.json`, which reproduces
 * the sequence that lost `7b7824e`'s evidence in the first place: something
 * anomalous happens, you re-run to look at it, and the rows you wanted are gone —
 * replaced by the rows of the run you made to study them. A log that is destroyed
 * by the act of investigating is not a capture mechanism.
 *
 * So every run gets its own file, and **the filename carries the run's state**:
 * `-running` while in flight, renamed to `-ok` or `-failed` at the end. A run
 * this harness KILLED can never rename itself, so it stays `-running` for ever —
 * which makes the killed run, the single hardest case to catch after the fact,
 * self-identifying in a directory listing.
 *
 * Pruning follows from that: `-ok` logs are ordinary and the newest few are
 * enough; `-failed` and `-running` are the evidence and are kept far longer.
 *
 * Both rules — how the name is composed and which files survive — live in
 * `lib/runLog.mjs` rather than here, because this file starts a sweep on import
 * and so nothing can assert a function inside it without running one.
 *
 * ## THIS IS A CAPTURE MECHANISM, NOT A RECORD
 *
 * `.cache/` is gitignored, so nothing here can ever reach a commit — which is
 * right, because these are working notes and not history. It also means the
 * rows must be COPIED INTO THE ENTRY BY HAND when an occurrence happens. That is
 * precisely the step that was missed for the 35-at-0.0s pass, whose evidence was
 * on somebody's screen and never written anywhere durable.
 */
const RUN_LOG_DIR = join(ROOT_DIR, '.cache', 'checkLocal-runs');

/**
 * What one script cost last time, and whether that figure is a COST or a CAP.
 *
 * ## The distinction, and why every derivation needs it
 *
 * A killed script records the bound it was killed at, so `180.1` means *we
 * stopped it here* and `55.1` means *it finished*. Stored as one number the two
 * are indistinguishable, and anything derived from the table inherits a figure
 * that is not a measurement — which is what made the bound underivable at all.
 *
 * Measured 2026-08-31, from this repository's own table: `proof:hookprobe` at
 * **282.4** (a completed run under a raised bound) against a 180-second
 * default, so the sweep kills it every time; `proof:testresolution` at
 * **180.1**, which is the cap and means it has never once finished inside the
 * default; and `proof:cff` at **400**, which never finishes at all.
 *
 * @typedef {{ seconds: number, capped: boolean }} Duration
 */

/** @type {Record<string, Duration>} */
let known = {};
try {
  /** @type {Record<string, unknown>} */
  const parsed = JSON.parse(readFileSync(DURATIONS, 'utf8'));
  for (const [name, value] of Object.entries(parsed)) {
    // A LEGACY BARE NUMBER IS DISCARDED, not adopted. Its capped-ness is
    // unknown, and the only two ways to guess are wrong in opposite directions:
    // calling it completed hands a raised bound to a script that never
    // finished, and calling it capped hands one to every script in the table.
    // "Nothing measured" is a state this file already has and already treats as
    // expensive, so one run rebuilds the table honestly.
    if (typeof value !== 'object' || value === null) continue;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (typeof record['seconds'] !== 'number' || typeof record['capped'] !== 'boolean') continue;
    known[name] = { seconds: record['seconds'], capped: record['capped'] };
  }
} catch {
  // No table yet, or an unreadable one. Both mean "nothing measured", which the
  // ordering below treats as expensive rather than cheap.
  known = {};
}

/**
 * Scripts that are a BUILD rather than a check, with the bound each one needs.
 *
 * `proof:cff` rebuilds libmupdf from a copy of the source with two bounds
 * checks reverted, because its control has to reproduce the out-of-bounds read
 * the pinned build fixes. Two measurements, and they are a factor apart:
 *
 *   - **864s**, **792s** and **905s** on this machine, all 2026-08-31, exit 0
 *     with both cases passing each time. The first two are `npm run proof:cff`
 *     with no bound over it; the third is from a full `npm run local`, which is
 *     where it actually runs and is the slowest of the three. Three readings
 *     rather than one because a single point cannot show a spread, and this one
 *     is 113s wide.
 *   - **339s** in CI. `.github/workflows/ci.yml` records it as 339s of the shim
 *     job's 521s, read from the Actions API on 2026-08-23.
 *
 * That spread is why a build is excluded from DERIVATION rather than handed a
 * small bound: a cost which swings by 2.5x with what happens to be built
 * already is not one to multiply. `COMPLETED_MARGIN` over a warm run kills a
 * cold one, and that is the direction which matters here.
 *
 * The bound is the slowest local figure with room for a library build that is
 * cold rather than incremental — `ci.yml` measures one at 336s — so ~1240s is
 * the worst case this has evidence for, and 1800s leaves margin without being
 * no bound at all.
 *
 * **This comment used to say it "does not complete and no bound accommodates
 * it", and both halves were false on the day they were written.** They were
 * composed from six local caps — 180s, 400s, 600s, 420s, 400s, 180s, every one
 * below the real cost — while this repository already held the 339s figure and
 * the shim job ran the proof unconditionally on every green board. Nothing had
 * changed to falsify it later: an impossibility asserted from evidence that only
 * ever showed a bound being reached (audit item 4, AAAA-8's shape). The cost of
 * believing it was a sweep that could never seal `ok`.
 *
 * **A hand-kept list, and the direction is why that is right here** (audit item
 * 4c). The failure a derived set could not see is *shrinkage* — an entry
 * quietly leaving. This set's danger is the opposite: a second build added and
 * not listed gets the discovery bound, caps again, and is loud about it every
 * run. A list that fails noisily on growth is the correct shape when growth is
 * the direction that matters.
 */
const BUILDS = new Map([['proof:cff', 1_800_000]]);

/** How much longer than its last COMPLETED cost a script may take before it is killed. */
const COMPLETED_MARGIN = 2;

/**
 * The bound a script gets after a run that was CAPPED.
 *
 * Deliberately raised and **fixed**, not multiplied again: the point is to
 * discover a real cost once, and a bound derived from a cap would grow on every
 * run that hits it. A script that caps at this too pays the same figure next
 * time rather than an escalating one.
 *
 * That last sentence used to read "is hung rather than slow", and `proof:cff`
 * falsified the inference before anything relied on it: measured at 864s on
 * 2026-08-31, it would cap here and it finishes. So this figure bounds a run,
 * and it does not diagnose one — a script which reaches it is reported as
 * capped, which is the state the table already carries, and what separates slow
 * from hung is a measurement nobody has taken yet rather than this constant.
 */
const DISCOVERY_MS = 3 * 180_000;

/**
 * How long this script may run, from what it cost last time.
 *
 * @param {string} name
 * @returns {number}
 */
function boundFor(name) {
  const build = BUILDS.get(name);
  if (build !== undefined) return Math.max(TIMEOUT_MS, build);
  const last = known[name];
  if (last === undefined) return TIMEOUT_MS;
  if (last.capped) return Math.max(TIMEOUT_MS, DISCOVERY_MS);
  return Math.max(TIMEOUT_MS, Math.ceil(last.seconds * COMPLETED_MARGIN) * 1000);
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

const requested = ONLY === null ? derived : derived.filter((name) => name.includes(ONLY));

/**
 * THE SCANNING ROSTER RUNS, IT IS NO LONGER PRINTED (finding UUUU-1).
 *
 * `affectedProofs.mjs` names the proofs a change reaches by walking static
 * imports, which is correct and blind to a whole class: a proof that SCANS the
 * tree imports none of the files it examines, so it appears in no column however
 * much a change reaches it. That list was therefore printed as an instruction to
 * run them by hand — and it reddened `main` three times, twice in one session,
 * always at the same proof.
 *
 * A printed instruction that names the same nine scripts on every run is a
 * disclaimer by this project's own test: it could have been printed before the
 * change. The remedy is this project's standing move — make the roster a thing
 * that runs rather than a roster somebody reads.
 *
 * **The condition is derived from the SELECTION rather than from the flag.** A
 * run that selected only checks is a run about to reach no proof at all, and
 * these are exactly the proofs no changed-file analysis could have named for it.
 * `--only proof:kernelload` selects a proof, so it is a deliberate single-script
 * run and is left alone.
 *
 * Measured 2026-08-27: the roster costs 171s here — `boundaries` 82.1s,
 * `electronimports` 38.4s, `stackowner` 33.9s, `jobplacement` 9.5s,
 * `affectedproofs` 5.7s, the other four under a second — against a check sweep
 * that already takes about three minutes. It is not in `prePush.mjs` for the
 * same figure: three minutes on every push is how a hook earns `--no-verify`.
 */
// THE ANCHOR IS READ HERE TOO, and it was not in the first version (VVVV-1).
// `SCANNING_PROOF_COUNT` exists because the failure to fear makes the roster
// SMALLER, and a list deriving its own count agrees with any deletion — so
// removing an entry together with its count would have left this sweep running
// eight of nine while every consumer agreed.
//
// `rosterMiscount` and not the whole `scanningProofRoster`, because the other
// half — is every entry a script THIS root declares — must not fire here: a
// fixture repository declares none of them and has to run normally. That was a
// paragraph justifying an inline comparison until WWWW-3 made it two names.
const miscount = rosterMiscount();
if (miscount !== null) {
  process.stderr.write(`${miscount}\nThis sweep would run whichever set survived, silently.\n`);
  process.exit(78);
}

const selectsNoProof = requested.length > 0 && requested.every((name) => name.startsWith('check:'));
const filtered = selectsNoProof
  ? [...requested, ...SCANNING_PROOFS.filter((name) => derived.includes(name))]
  : requested;

/*
 * THE MULTI-PROOF SWEEP WAS REFUSED HERE, AND IS NOT ANY MORE (WWW-2 → UUUU-1).
 *
 * What stood here refused any run selecting more than one `proof:*` script,
 * because a full sweep on 2026-08-23 printed **35 failures at 0.0 seconds each,
 * every one of which passed when run alone** — invented failures, and a tool
 * that cries wolf is a tool someone relaxes.
 *
 * It is removed because the harm it prevented is now unrepresentable rather than
 * merely unobserved, which is B5 superseding a runtime prohibition. Those 35
 * were spawns that never became processes, reported as failures because nothing
 * read `spawnSync`'s `error`. Today `spawnOutcome.mjs` classifies a non-start as
 * its own state, this harness reports it as `DID NOT START` rather than as a
 * failure, and it stops there — so a sweep can no longer invent one red, let
 * alone thirty-five. Both halves are asserted in `checkLocal.proof.mjs` against
 * an INJECTED non-start (a command line past Windows' 32767-character limit,
 * which fails `CreateProcess` in ~2.5ms with `status: null` and no output —
 * WWW-2's signature exactly), with the control the other way: a genuine failure
 * is still a failure, still counted, and does not stop the run.
 *
 * **The mechanism behind the original 35 is still unknown, and that is why the
 * refusal is removed rather than declared unnecessary.** Its old message named
 * one unblocking condition, *the errno and nothing else* — a condition only the
 * defect recurring can satisfy. The investigation it prescribed was run on
 * 2026-08-27, twice, the second against a clone built and provisioned so its
 * proofs do the work they do here: **81 of 81 both times, zero never-started,
 * not one row at 0.0s.** A condition success prevents is not a strategy that
 * terminates. The refusal was protective; the errno is explanatory; only the
 * first was ever load-bearing, and it now has a mechanism instead of a
 * prohibition.
 *
 * If the signature returns, this harness stops at it and says so — which is
 * strictly better than a permanent refusal, because the capability is then
 * unavailable only while the machine is actually in that state.
 */

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
  // A CAPPED FIGURE SORTS LATE WHATEVER ITS SIZE. Before the shape carried the
  // flag this said `cost >= BUDGET_SECONDS`, which is the same answer for a
  // killed run only because the recorded figure IS the bound — an accident that
  // stops being true the moment a bound is derived per script.
  if (cost.capped) return 2;
  return cost.seconds >= BUDGET_SECONDS ? 2 : 0;
}

const selected = [...filtered].sort((a, b) => {
  const left = costBucket(a);
  const right = costBucket(b);
  if (left !== right) return left - right;
  // Within the unknown bucket there is nothing to order by, so keep it stable.
  if (left === 1) return a.localeCompare(b);
  return (known[a]?.seconds ?? 0) - (known[b]?.seconds ?? 0);
});

process.stdout.write(
  `${String(selected.length)} of ${String(derived.length)} script(s) the workflows run, ` +
    `derived from the workflow files.\n\n`,
);

/** @type {string[]} */
const failed = [];
/** @type {string[]} */
const timedOut = [];
/** Spawns that never became a process. See `lib/spawnOutcome.mjs`. */
/** @type {string[]} */
const didNotStart = [];

/** @type {string[]} */
const notNode = [];
/**
 * Scripts that exited 0 because they COULD NOT LOOK (finding DDDD-6).
 *
 * A third state beside passed and failed, for the reason `didNotStart` is one:
 * the permissive could-not-look outcome exits 0 by design — locally there may be
 * no build and nothing to assert — so a runner reading the exit code alone
 * reports it as a pass. Measured 2026-08-25 by moving the built pipe surface
 * aside: `ok proof:transportwrite (0.3s)`, and the affected-proofs disclosure
 * then said this run had *reached every proof that reads a file this tree
 * changed*. The stronger the disclosure got, the more it certified.
 *
 * @type {string[]}
 */
const unverifiable = [];
/**
 * Scripts that measured PART of their subject.
 *
 * Separate from {@link unverifiable} because the two call for different
 * readings: one says nothing was measured, this says what ran is trustworthy
 * and names what did not. Collapsing them would make a run where most cases
 * executed indistinguishable from one where none did.
 *
 * @type {string[]}
 */
const partlyMeasured = [];
/** Scripts observed to move the tree, in the order they did it. */
/** @type {string[]} */
const treeMovers = [];
/** Every script's outcome this run, persisted as it goes. See {@link RUN_LOG_DIR}. */
/** @type {Array<Record<string, unknown>>} */
const runLog = [];

// Colons are illegal in a Windows filename, so the timestamp is dashed. The pid
// disambiguates two runs started inside the same second.
const RUN_STAMP = `${new Date().toISOString().replace(/\..*$/u, '').replaceAll(':', '-')}-${process.pid}`;
let runLogPath = join(RUN_LOG_DIR, runLogName(RUN_STAMP, 'running'));

/** @param {Record<string, unknown>} row */
function recordRow(row) {
  runLog.push(row);
  try {
    mkdirSync(RUN_LOG_DIR, { recursive: true });
    writeFileSync(runLogPath, `${JSON.stringify(runLog, null, 2)}\n`, 'utf8');
  } catch {
    // A log this cannot write is not a reason to fail the run it is describing.
    // The rows are a diagnostic aid; the sweep's verdict does not depend on them.
  }
}

/**
 * Rename this run's log to its outcome, and prune.
 *
 * Never called when the process is killed, which is the point: a `-running` file
 * IS the record of a run that did not finish.
 *
 * @param {boolean} clean
 */
function sealRunLog(clean) {
  try {
    if (runLog.length === 0) return;
    const sealed = join(RUN_LOG_DIR, runLogName(RUN_STAMP, clean ? 'ok' : 'failed'));
    renameSync(runLogPath, sealed);
    runLogPath = sealed;

    for (const name of retention(readdirSync(RUN_LOG_DIR)).remove) {
      rmSync(join(RUN_LOG_DIR, name), { force: true });
    }
  } catch {
    // Same reasoning as recordRow: the verdict does not depend on the log.
  }
}
/** The last reported tree state, so one deletion is not reported by every later script. */
/** @type {string | null} */
let lastTreeState = null;
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
  // RESOLVED RATHER THAN REFUSED (finding C2). This used to require the command
  // to begin with `node` and report everything else as not run — which was
  // honest and, from inside the refusal, invisible in its consequence:
  // `typecheck`, `lint` and `build` are three of the four words that were ever
  // in that list, so the local gate ran no compiler and no linter, and `test`
  // was in no roster at all.
  //
  // `npmScriptSteps.mjs` derives the node invocations from the command in
  // `package.json` rather than from a table, so nothing here can drift when
  // somebody edits that line. Still node directly and still no shell: the
  // measurement that ruled a shell out is unchanged, and a step that cannot be
  // resolved is reported exactly as before.
  const { steps, unresolved } = resolveScript(name, {
    root: ROOT_DIR,
    scripts,
    bins: BINARIES,
  });
  if (steps.length === 0 || unresolved.length > 0) {
    // Reported, not skipped. A script this harness cannot invoke is a hole in
    // the derivation, and a hole that prints nothing is the derivation lying
    // about its own coverage.
    const why =
      unresolved.length > 0
        ? unresolved.map((entry) => `${entry.command}: ${entry.why}`).join('; ')
        : 'the command resolved to no steps';
    notNode.push(`${name} (${command})`);
    // Logged as well, so the rows are a complete account of the selection rather
    // than of the part that executed. A script missing from the log and a script
    // that passed are otherwise the same absence.
    recordRow({
      name,
      exit: null,
      signal: null,
      seconds: 0,
      bytes: null,
      firstProblem: `(not run — ${why})`,
    });
    process.stdout.write(`  NOT RUN  ${name} — ${why}\n`);
    continue;
  }
  const started = process.hrtime.bigint();
  // Every step, in order, stopping at the first failure — which is what `&&`
  // means and is why a chain is resolved into steps rather than flattened into
  // one. `build` is `typecheck && build:preload`, and running the second after
  // the first failed would report a preload built from a tree that does not
  // compile.
  let run = /** @type {ReturnType<typeof spawnSync>} */ (
    /** @type {unknown} */ ({ status: 0, signal: null, stdout: '', stderr: '' })
  );
  for (const step of steps) {
    run = spawnSync(process.execPath, [step.js, ...step.args], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      timeout: boundFor(name),
    });
    if (run.status !== 0 || run.signal !== null) break;
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const took = `${seconds.toFixed(1)}s`;
  // Recorded for EVERY outcome, including a timeout: a script killed at the
  // bound cost at least that much, so the figure still sorts it late next time.
  // Recording only successes would put a repeatedly-timing-out script back at
  // the front of the queue on every run.
  //
  // **AND WHETHER IT WAS CAPPED**, which is the half that makes the figure
  // usable for anything but sorting. `run.signal` is set exactly when
  // `spawnSync` killed it at the bound, so this is read from the outcome rather
  // than inferred from the number — a cost that happens to equal the bound is
  // not a cap, and comparing them would say it was.
  known[name] = { seconds: Number(seconds.toFixed(1)), capped: run.signal !== null };

  // WHICH SCRIPT MOVED THE TREE, not merely that something did.
  //
  // WWW-1's witness was taken once before the run and read once after, so it
  // said THE TREE MOVED UNDER THIS RUN and named nothing. Measured 2026-08-24
  // while investigating AAAA-6: sampling after every script located the culprit
  // — `proof:hookprobe`, killed at a bound, leaving `docs/hook-probe.json`
  // deleted — in one pass, where the run-scoped witness would have said only
  // that something in sixty-four scripts had done it.
  //
  // The cost is one `git status` per script against runtimes measured in tens of
  // seconds, and the report goes out AS IT HAPPENS rather than at the end,
  // because everything after this point is measured against a tree that moved.
  if (treeBefore !== null) {
    const movedNow = treeMovedSince(treeBefore);
    if (movedNow !== null && movedNow !== lastTreeState) {
      lastTreeState = movedNow;
      treeMovers.push(name);
      process.stdout.write(
        `  !!  THE TREE MOVED under ${name} — ${movedNow}\n` +
          `      Everything after this is measured against a changed tree.\n`,
      );
    }
  }

  // `signal` is how spawnSync reports a timeout kill, and it must not be read
  // as an ordinary non-zero exit: one is "this check says no", the other is
  // "this harness stopped listening".
  // A TIMEOUT STOPS THE SWEEP, and the reason is TREE DAMAGE — not orphans.
  //
  // This comment used to say that a timeout leaves the killed script's own
  // children running, that they accumulate, and that a job object was the
  // outstanding work. MEASURED 2026-08-24 and that is false here, three runs of
  // each variant against this harness at `--timeout 5`, identifying every
  // survivor by its command line rather than by its age:
  //
  //   grandchild spawned ordinarily   3 of 3 died with the harness
  //   grandchild spawned `detached`   3 of 3 survived
  //
  // The discriminating variable is `detached`, which is the signature of the
  // job object libuv already puts an ordinary Windows child into — so on this
  // platform the harness gets tree-kill for free, and **this repository spawns
  // nothing detached** (zero occurrences, and `checkLocal.proof.mjs` asserts
  // that, because the guarantee depends on it).
  //
  // What survives, measured and unrelated to processes: a killed script does
  // not run its `finally`, so a proof that removes a tracked file to make a
  // point leaves it removed — `docs/hook-probe.json` was left deleted in the
  // working tree exactly that way. Everything after a timeout is measured
  // against a CHANGED TREE, which is reason enough to stop.
  //
  // ASSERTED, not recalled (finding AAAA-31): `checkLocal.proof.mjs` runs that
  // differential on every push — the grandchild must be seen ADVANCING a
  // counter before anything is killed, since "it stopped" and "it never
  // started" are otherwise the same observation. Both halves are asserted, each
  // on its own Guards leg: win32 tears the tree down, and on Linux nothing ties
  // a child's lifetime to its parent's, so the orphan claim holds there. This
  // is what gives the claim an expiry — it is a property of the RUNTIME, and a
  // node bump is exactly the event that would take it away in silence.
  const outcome = classifySpawn(run);

  if (outcome.kind === 'timedOut') {
    timedOut.push(name);
    // THE ROW THE LOG EXISTS FOR, and it was missing from the first version.
    // Measured 2026-08-24 by running the sweep against a clone: the first proof
    // timed out, no row was ever recorded, `runLog` stayed empty, and `sealRunLog`
    // returned early — so the one run that orphans processes and leaves wreckage
    // wrote NOTHING. A log with a hole at its own subject is worse than none,
    // because its silence reads as a quiet run.
    recordRow({
      name,
      exit: null,
      signal: run.signal ?? null,
      seconds: Number(seconds.toFixed(2)),
      bytes: `${run.stdout ?? ''}${run.stderr ?? ''}`.length,
      firstProblem: '(killed at the bound — its own children are still running)',
    });
    process.stdout.write(
      `  TIMED OUT  ${name} (${took})\n` +
        `      STOPPING. A timeout orphans that script's own child processes, and every\n` +
        `      result after one is measured against a machine carrying them. Re-run with\n` +
        `      --timeout raised, or --only, rather than reading what would follow.\n`,
    );
    break;
  }

  // A SPAWN THAT NEVER BECAME A PROCESS IS NOT A CHECK THAT SAID NO, and until
  // 2026-08-24 this harness could not tell you the difference (finding AAAA-6).
  //
  // `spawnSync`'s `error` was read nowhere here, so a failure to create the
  // process arrived as `status: null`, no output and under 50ms — which the
  // branch below reports as `FAILED` at `0.0s` with `(no diagnostic line
  // found)`. That is WWW-2's founding signature exactly, and the reason its
  // 35 lines said nothing is that there was nothing for them to say.
  //
  // It STOPS the sweep, for the reason the timeout above does: a machine that
  // just refused to create a process will refuse the next one, and the founding
  // observation is thirty-five of those in a row, every one of which passed
  // when run alone. One unreadable measurement is a reason to look; thirty-five
  // invented ones are a reason to stop using the tool.
  if (outcome.kind === 'didNotStart') {
    didNotStart.push(name);
    recordRow({
      name,
      exit: null,
      signal: null,
      seconds: Number(seconds.toFixed(2)),
      bytes: 0,
      firstProblem: `(never started — ${outcome.detail ?? 'no cause reported'})`,
    });
    process.stdout.write(
      `  DID NOT START  ${name} (${took})\n` +
        `      ${outcome.detail ?? 'no cause reported'}\n` +
        `      STOPPING. No process was created, so this is not a result about ${name} —\n` +
        `      it is a result about this machine, and everything after it would be too.\n`,
    );
    break;
  }

  if (outcome.exit !== 0) {
    failed.push(name);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const firstProblem =
      output
        .split('\n')
        .find((line) => /\b(FAIL|Error|error)\b/u.test(line))
        ?.trim() ?? '(no diagnostic line found)';
    // The row that would have answered AAAA-23. `bytes` separates a script that
    // printed nothing at all from one whose output simply carried no matching
    // line — a spawn that never started against a guard that refused quietly,
    // which the diagnostic line alone cannot tell apart.
    recordRow({
      name,
      exit: outcome.exit,
      signal: null,
      seconds: Number(seconds.toFixed(2)),
      bytes: output.length,
      firstProblem,
    });
    // NOT TRUNCATED. This tool exists to surface failures, and cutting the
    // failure text at 200 characters in the one place it is printed is the
    // reflex this session already lost time to twice — a diagnostic clipped
    // before its reason is a diagnostic that sends someone to re-run the script
    // by hand. `firstProblem` is already ONE selected line, so there is no
    // volume argument for the cut either.
    process.stdout.write(`  FAILED  ${name} (${took})\n      ${firstProblem}\n`);
    continue;
  }
  // COULD NOT LOOK IS NOT A PASS, and it exits 0 on purpose — see the note on
  // `unverifiable` above. Read from the marker `scripts/lib/unverifiable.mjs`
  // owns rather than from a spelling of our own, because a second opinion about
  // what that module prints drifts the first time its wording changes (B3a).
  if (`${run.stdout ?? ''}${run.stderr ?? ''}`.includes(UNVERIFIABLE_MARKER)) {
    unverifiable.push(name);
    recordRow({
      name,
      exit: 0,
      unverifiable: true,
      signal: null,
      seconds: Number(seconds.toFixed(2)),
      bytes: `${run.stdout ?? ''}${run.stderr ?? ''}`.length,
      firstProblem: '(could not look — nothing is asserted and nothing is denied)',
    });
    process.stdout.write(
      `  UNVERIFIABLE  ${name} (${took})\n` +
        `      It exited 0 without measuring anything. On a job that passes the require flag\n` +
        `      this same condition is red; here it is neither a pass nor a failure.\n`,
    );
    continue;
  }
  // AND PARTLY MEASURED IS A THIRD STATE, not either of the two above. Four
  // proofs assert one set of cases everywhere and another only where a runtime
  // is provisioned; filing those under the marker above would say they measured
  // NOTHING, which is false in the direction that reads as coverage. The tally
  // is in the line they print, so this bucket carries the name and the reader
  // gets the ratio from the output.
  if (`${run.stdout ?? ''}${run.stderr ?? ''}`.includes(PARTIAL_MARKER)) {
    partlyMeasured.push(name);
    recordRow({
      name,
      exit: 0,
      partlyMeasured: true,
      signal: null,
      seconds: Number(seconds.toFixed(2)),
      bytes: `${run.stdout ?? ''}${run.stderr ?? ''}`.length,
      firstProblem: '(partly measured — some cases ran, some could not)',
    });
    process.stdout.write(
      `  PARTLY MEASURED  ${name} (${took})\n` +
        `      What ran, ran. The cases it could not reach are neither asserted nor denied,\n` +
        `      and the same condition is red on a job that passes the require flag.\n`,
    );
    continue;
  }
  passedCount += 1;
  // Passes are logged too, and that is the point rather than symmetry: the
  // question WWW-2 turns on is what a script that COMPLETED did immediately
  // before the next one failed in 0.0s, and a log holding only the failures
  // cannot answer it.
  recordRow({ name, exit: 0, signal: null, seconds: Number(seconds.toFixed(2)), bytes: null, firstProblem: null });
  process.stdout.write(`  ok  ${name} (${took})\n`);
}

// COUNTED FROM WHAT RAN, not from what was selected. The sweep stops at the
// first timeout, so `selected.length` would report every script it never
// reached as a pass — the arithmetic quietly inventing the result the operator
// was hoping for.
const attempted =
  failed.length +
  timedOut.length +
  didNotStart.length +
  notNode.length +
  unverifiable.length +
  partlyMeasured.length +
  passedCount;
process.stdout.write(
  `\n${String(passedCount)} passed, ${String(failed.length)} failed, ` +
    `${String(timedOut.length)} timed out, ${String(didNotStart.length)} never started, ` +
    `${String(notNode.length)} not run, ${String(unverifiable.length)} unverifiable, ` +
    `${String(partlyMeasured.length)} partly measured — ` +
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
      // THREE STATES, and the third is why the shape changed: "stopped at
      // 180.1s" and "took 180.1s" are the same digits and opposite facts.
      `      ${name} — ${
        cost === undefined
          ? 'never measured'
          : cost.capped
            ? `STOPPED at ${String(cost.seconds)}s, so its real cost is unknown`
            : `last took ${String(cost.seconds)}s`
      }\n`,
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
          (treeMovers.length > 0
            ? `  Moved under: ${treeMovers.join(', ')}.\n`
            : `  No single script was seen to move it, so the change happened during the last\n` +
              `  script or outside this run.\n`) +
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
if (didNotStart.length > 0) {
  process.stdout.write(
    `Never started, so NOT a result about the script: ${didNotStart.join(', ')}\n` +
      `This is WWW-2's signature. COPY THE ROWS OUT of the run log before doing anything\n` +
      `else — .cache/ is gitignored and the next run prunes, and the founding occurrence\n` +
      `was lost at exactly this step.\n`,
  );
}
if (unverifiable.length > 0) {
  process.stdout.write(
    `Could not look, so NOT a pass: ${unverifiable.join(', ')}\n` +
      `Each exited 0 by design — locally there may be nothing provisioned to measure. The\n` +
      `same condition is RED on the job that passes the require flag, so this is a gap in\n` +
      `what YOU have evidence for and not a gap in the board.\n`,
  );
}
if (partlyMeasured.length > 0) {
  process.stdout.write(
    `Partly measured: ${partlyMeasured.join(', ')}\n` +
      `Each printed how many cases ran and named the ones that could not. What ran is\n` +
      `evidence; the rest is neither asserted nor denied here and is red on the job that\n` +
      `passes the require flag.\n`,
  );
}
// WHICH AFFECTED PROOFS THIS RUN REACHED AND WHICH IT DID NOT, BY NAME
// (finding AAAA-16, and DDDD-1 for the second half).
//
// What used to stand here was a true sentence about the set's blind spots. It is
// printed at the point of use, which AA-1 called the difference between a
// mechanism and a note — and it did not stop a push that reddened main, because
// it is true on every run, names nothing and asks for nothing. Printed is
// necessary and not sufficient; SPECIFIC is what separates an instruction from
// furniture.
//
// So the general sentence is gone rather than kept alongside. Keeping it would
// leave the furniture in place and let a reader take it as the coverage
// statement, which is the state the specific list exists to end.
// THROUGH `gitScope`, WHICH IS THE MODULE THAT OWNS "WHICH SCOPE" (B3a). This
// spawned its own `git diff --name-only HEAD` — a second opinion, and the wrong
// scope: `diff` reports TRACKED modifications only, so a brand-new module
// contributed nothing and the fallback below printed "nothing is changed against
// HEAD" about a run whose entire subject was two untracked files. Measured
// 2026-08-28, on this file's own commit.
//
// Which is item 4b in the input rather than in the search: the walk was working
// perfectly on the set it was handed, so no control on the walk could see it,
// and the empty set produced exactly the sentence a clean tree produces.
/** @type {string[] | null} */
let changedForProofs = null;
try {
  changedForProofs = uncommittedPaths({ cwd: ROOT_DIR });
} catch (cause) {
  // NOT SWALLOWED, and not a fallback to an empty set. `--root` may name a
  // directory that is not a repository — every fixture in this file's proof is
  // one — and there the report cannot be produced at all. Saying so is the
  // whole point: an unaskable question must not arrive looking like an answer
  // of "nothing", which is what the previous `status === 0` guard did by
  // printing nothing at all.
  process.stdout.write(
    `  ??  could not ask git what this tree changed, so no proof is named either way: ` +
      `${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}\n`,
  );
}
if (changedForProofs !== null) {
  const changed = changedForProofs;
  // WHAT THIS RUN ACTUALLY REACHED, derived from the rows rather than counted
  // alongside them. A row carries a non-null `exit` exactly when a script
  // produced a verdict; a timeout, a spawn that never started and a non-node
  // script all record `exit: null`, which is the distinction this report turns
  // on. Deriving is right here by 4c's test: the failure to fear is a proof
  // being named as reached when it was not, and that needs the set to grow —
  // which a set computed from the rows cannot do.
  const verdicted = runLog
    .filter((row) => row['exit'] !== null && row['unverifiable'] !== true)
    .map((row) => (typeof row['name'] === 'string' ? row['name'] : ''));
  const report = affectedProofsReport(affectedProofs(changed, { root: ROOT }), verdicted);
  process.stdout.write(
    report ??
      (changed.length === 0
        ? '  ok  nothing is changed against HEAD, so no proof is owed a run\n'
        : `  ok  no proof imports any of the ${String(changed.length)} file(s) changed against HEAD\n`),
  );
}
process.stdout.write('The board is the mechanism; this is the minute before the push.\n');

const clean =
  failed.length === 0 &&
  timedOut.length === 0 &&
  didNotStart.length === 0 &&
  notNode.length === 0 &&
  treeMoved === null;
// A TIMED-OUT run is sealed as `-failed`, not left `-running`: the harness got to
// decide, so the run finished even though a script did not. `-running` is
// reserved for the case where nothing here ran at all after the kill, which is
// what makes it worth reading.
sealRunLog(clean);
if (runLog.length > 0) {
  process.stdout.write(
    `Rows for this run: ${relative(ROOT_DIR, runLogPath).replaceAll('\\', '/')}\n` +
      `  .cache is gitignored, so this is a capture and not a record — copy the rows into the\n` +
      `  entry by hand if this run is the occurrence somebody needs later.\n`,
  );
}

/*
 * THE VERDICT IS THE LAST LINE, so the common wrong action stops producing a
 * wrong answer.
 *
 * The file name is the authority — a run seals itself `-ok` or `-failed` — and
 * `| tail` discards the exit code, so a piped run has been read as green three
 * times in one session by an agent that had written the rule down twice. That is
 * this repository's standing evidence that a rule you must recall at the moment
 * a command is composed is not a mechanism.
 *
 * Forbidding the pipe would be another rule. Printing the seal state LAST makes
 * `| tail` show the truth instead, which is B5's shape applied to a habit rather
 * than to a type: the mistake is made harmless rather than illegal. `head` still
 * hides it, and nothing here pretends otherwise — what is closed is the form
 * people actually reach for, which is the one that keeps the end of the output.
 *
 * The counts come from the same arrays the verdict does, so a line that said
 * `ok` while something failed would need the verdict itself to be wrong.
 */
/** @type {{ count: number, what: string }[]} */
const tallies = [
  { count: failed.length, what: 'failed' },
  { count: timedOut.length, what: 'timed out' },
  { count: didNotStart.length, what: 'did not start' },
  { count: notNode.length, what: 'not node' },
].filter((tally) => tally.count > 0);
const reasons = tallies.map((tally) => `${String(tally.count)} ${tally.what}`).join(', ');
process.stdout.write(
  clean
    ? `SEALED: ok (${String(passedCount)} passed)\n`
    : `SEALED: failed (${treeMoved === null ? '' : 'the tree moved under this run; '}${
        reasons === '' ? 'see above' : reasons
      })\n`,
);
process.exit(clean ? 0 : 1);
