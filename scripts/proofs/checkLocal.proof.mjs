// @ts-check
/**
 * Proof that `scripts/checkLocal.mjs` can report a failure at all (finding
 * QQQ-2).
 *
 * ## Why a wrapper needs a proof
 *
 * Its reassuring answer is **"everything passed"**, and four different things
 * print it: a clean tree, a misread exit code, a mis-parse of `spawnSync`'s
 * result, and a selected set that came back empty. That is 4b's shape in a tool
 * whose whole job is to report failures.
 *
 * The direction matters. The first version of this harness **invented
 * failures** — noisy, and it announced itself within one run. The mirror,
 * **inventing passes**, is silent and is the one nothing watched. `annotate.mjs`
 * is also "just" a wrapper and carries `annotate.proof.mjs` for exactly this
 * reason.
 *
 * ## Two of these cases read the HARNESS, not the results
 *
 * Item 2's remedy rule: when a harness is corrected, the control asserts what
 * the harness *passes*, not what the run produces. Every assertion about
 * results stays green whether or not a shell is interposed and whether or not a
 * timeout stops the sweep — which is precisely how the first version shipped
 * with both wrong.
 *
 *   - **No shell.** The fixture root's path contains a SPACE. Spawned directly
 *     that is nothing; spawned through a shell the command line splits and the
 *     script is not found. So the input is built from something that only
 *     succeeds when the guard is present, which is the negative-probe rule
 *     inverted.
 *   - **A timeout stops the sweep.** The first script hangs, the second would
 *     write a marker. The marker's ABSENCE is the assertion, with a control run
 *     proving the second script writes it when nothing times out — without
 *     which "no marker" is satisfied by a sweep that ran nothing at all.
 *
 * ## The run log, and the one part of it still off the board (finding AAAA-29)
 *
 * The run log shipped on the strength of a single hand-run kill, and an audit
 * then described this whole area as one where "the board is not the mechanism"
 * — which was false of the harness (three proofs run in Guards on two
 * platforms) and true of exactly one thing: the run-log FILES. Three of the
 * four pieces are cheap, so they are asserted here rather than left as a gap:
 *
 *   - **retention**, a decision over a directory listing, needing no processes
 *     at all — see `lib/runLog.mjs`, which exists so that a proof can reach it;
 *   - **the `-failed` seal on a timeout**, read off the fixture repository the
 *     timeout case already builds;
 *   - **`-running` surviving a kill**, which is the state the log exists for
 *     and the one nothing had ever asserted. The harness is spawned, killed
 *     with SIGKILL mid-sweep, and its log must still be there, still named
 *     `-running`, with the completed script's row in it.
 *
 * **STATED LIMITATION: the clone route is not exercised here.** `npm run local
 * -- --root <clone>` needs a real clone and a provisioned tree, which is an
 * order of magnitude more than the rest of this file costs. It is the route an
 * investigator types by hand on the day something is wrong, and it is the one
 * piece of the run log whose failure would be discovered by that person rather
 * than by CI.
 *
 * Usage: node scripts/proofs/checkLocal.proof.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { retention, runLogState } from '../lib/runLog.mjs';
import { classifySpawn } from '../lib/spawnOutcome.mjs';
import { SCANNING_PROOFS } from '../lib/scanningProofs.mjs';
import { UNVERIFIABLE_MARKER } from '../lib/unverifiable.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'checkLocal.mjs');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 56 });

/**
 * Records, and prints nothing — `roster.format` emits the case list at the end.
 *
 * @param {string} name @param {boolean} condition @param {string} detail
 */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// A SPACE IN THE PATH, deliberately. See the header: it is what makes the
// no-shell case an observation rather than a reading of the source.
const scratch = mkdtempSync(join(tmpdir(), 'monstera check local '));

/**
 * Gives a fixture repository the workflows its roster now comes from (ZZZZ-1).
 *
 * `checkLocal.mjs` used to derive its set from `package.json` by name; it now
 * derives it from the workflow files, so a fixture without them has an empty
 * roster and the harness refuses to run at all.
 *
 * **Derived from the manifest rather than listed**, and that is the same rule
 * the change itself makes: a case that adds a script to its fixture must not be
 * able to leave it outside the roster silently. Written once and called from
 * every fixture builder here, because four copies of this is four places for one
 * of them to drift.
 *
 * ## Steps are written BY NAME, and the first version wrote them by command
 *
 * `- run: npm run proof:x` rather than `- run: node scripts/x.mjs`. Writing the
 * command looks more faithful to the real corpus and broke six cases, because
 * some fixtures declare scripts the derivation deliberately cannot resolve —
 * `proof:shelled` runs `npm run something-else`, which is the point of the case
 * testing that a script the harness cannot invoke is reported NOT RUN. Emitting
 * that command produced a workflow step naming an undeclared script, so the
 * roster lost the very entry the case was about, and the case failed for a
 * reason that had nothing to do with what it tests.
 *
 * By name, the roster equals the manifest for every fixture, which is what every
 * case here assumed before the roster moved. Whether the derivation can follow a
 * command through the annotate wrapper is `ciVerifiers.proof.mjs`'s question,
 * and it should not be re-asked by forty cases about something else.
 *
 * @param {string} root
 * @param {Record<string, string>} manifestScripts
 */
function giveFixtureWorkflows(root, manifestScripts) {
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    ['jobs:', '  build:', '    steps:']
      .concat(Object.keys(manifestScripts).map((name) => `      - run: npm run ${name}`))
      .join('\n'),
    'utf8',
  );
}

/**
 * Builds a fixture repository and runs the harness against it.
 *
 * @param {Record<string, string>} files script name -> body
 * @param {Record<string, string>} manifestScripts
 * @param {string[]} extraArgs
 */
function runFixture(files, manifestScripts, extraArgs = []) {
  const root = mkdtempSync(join(scratch, 'repo '));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'scripts', name), body, 'utf8');
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: manifestScripts }, null, 2),
    'utf8',
  );

  giveFixtureWorkflows(root, manifestScripts);

  const run = spawnSync(
    process.execPath,
    [HARNESS, '--root', root, '--floor', '1', ...extraArgs],
    { encoding: 'utf8' },
  );
  return { root, ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/**
 * A fixture that is a REAL git repository, with a committed baseline.
 *
 * The changed-file disclosure asks git what differs from HEAD, and a fixture
 * with no HEAD cannot answer — which is why every case above is silent about
 * that block. `untracked` is written **after** the commit, so those paths exist
 * on disk and git has never heard of them: the shape of adding a new module, and
 * the one `git diff` cannot see.
 *
 * @param {Record<string, string>} files under `scripts/`, committed
 * @param {Record<string, string>} manifestScripts
 * @param {Record<string, string>} untracked under `scripts/`, written after the commit
 * @param {string[]} [extraArgs]
 * @returns {{ root: string, ok: boolean, output: string }}
 */
function runGitFixture(files, manifestScripts, untracked, extraArgs = []) {
  const root = mkdtempSync(join(scratch, 'repo git '));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'scripts', name), body, 'utf8');
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: manifestScripts }, null, 2),
    'utf8',
  );
  giveFixtureWorkflows(root, manifestScripts);
  // THE HARNESS WRITES INTO THE ROOT IT IS MEASURING — `.cache/checkLocal-runs/`
  // and the tree witness — so without this the fixture is never clean and the
  // control below cannot exist. The real repository ignores the same directory,
  // which is why the production run does not see it either.
  writeFileSync(join(root, '.gitignore'), '.cache/\n', 'utf8');

  const inRepo = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  inRepo(['init', '-q']);
  inRepo(['add', '-A']);
  // Identity on the command line rather than from the machine's config: a
  // runner with no `user.email` set would fail the commit, and the fixture
  // would then have no HEAD — which is the state this helper exists to avoid,
  // arriving as a silently different test rather than as an error.
  inRepo([
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'user.name=fixture',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);

  for (const [name, body] of Object.entries(untracked)) {
    writeFileSync(join(root, 'scripts', name), body, 'utf8');
  }

  const run = spawnSync(process.execPath, [HARNESS, '--root', root, '--floor', '1', ...extraArgs], {
    encoding: 'utf8',
  });
  return { root, ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/**
 * A fixture repository's run logs, newest last.
 *
 * Returns `[]` for a directory that is not there, which is the reassuring shape
 * — so every case below requires a file to be PRESENT and named, and none of
 * them is satisfied by an absence.
 *
 * @param {string} root
 * @returns {string[]}
 */
function runLogs(root) {
  try {
    return readdirSync(join(root, '.cache', 'checkLocal-runs'))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {Array<Record<string, unknown>>}
 */
function runLogRows(root, name) {
  const parsed = JSON.parse(readFileSync(join(root, '.cache', 'checkLocal-runs', name), 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Sleep without a timer, because every case here is synchronous.
 *
 * `Atomics.wait` on a `SharedArrayBuffer` blocks this thread; a `setTimeout`
 * would need the event loop this file never yields to.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * How long a case will wait for a spawned harness to reach the state it tests,
 * and how much longer than that its fixtures must live (finding AAAA-30).
 *
 * These are ONE relationship, so only one of them is chosen. A fixture that
 * expires before the wait ends produces a RED for a case that never reached the
 * state under test — a *could not look* wearing a *looked and it was wrong*,
 * which is the distinction this repository refuses to let merge anywhere else.
 * Deriving the fixture's lifetime from the budget makes the ordering a property
 * of the code; two literals side by side make it a coincidence that survives
 * until somebody tightens one of them for a perfectly good reason.
 */
const SETUP_POLL_MS = 50;
const SETUP_BUDGET_MS = 10000;
const SETUP_MARGIN_MS = 5000;

/** Long enough for a killed child's last write to land before the directory is read. */
const SETTLE_MS = 250;

/**
 * The gap between the two samples that decide *advancing* or *still*.
 *
 * ONE constant for one concept. The probe used 600ms and the cleanup 400ms for
 * the same question, which is two numbers nobody chose the difference between —
 * the shape that becomes a drift.
 */
const SAMPLE_GAP_MS = 600;

/**
 * How long the cleanup will keep looking for a survivor's counter to move
 * (finding AAAA-37).
 *
 * It was a single 150ms window against a grandchild writing every 100ms, and
 * one stretched tick on a loaded runner would have reported *did not advance*
 * — a red for a case that could not be set up, which is the exact outcome the
 * SETUP case fifty lines below refuses to let merge with a real failure. The
 * asymmetry was the tell: `probeGrandchild` gives the same property ten seconds
 * of polling and the cleanup gave it one look.
 *
 * Polled in `SETUP_POLL_MS` steps like the probe, so the assertion means *could
 * not see it advance within this budget* rather than *did not advance in the
 * one window I happened to open*.
 *
 * **NO DETERMINISTIC MUTATION EXISTS FOR WHAT THIS FIXES, and that is the
 * reason it was worth fixing.** Tried 2026-08-24: slowing the fixture's tick to
 * 500ms against the old 150ms window — a case that should miss 70% of the time
 * — and the file still passed. The failure is a coin flip on phase, which is
 * exactly why it was a latent flake and not a bug: it would have arrived once,
 * on somebody else's runner, reading as a real teardown failure. What IS
 * deterministic is that the poll is load-bearing at all: setting this budget to
 * `0` reddens the cleanup control alone.
 */
const CLEANUP_ADVANCE_BUDGET_MS = 2000;

/**
 * How many grandchildren the teardown block probes, and therefore the most that
 * can survive into the cleanup.
 *
 * A literal, and ANCHORED rather than trusted: a case below requires the probe
 * list to be exactly this long. The failure to fear here makes the set BIGGER —
 * a third probe added without widening the span — and a hand-kept number is
 * silent about growth unless something compares it to the real one (item 4c).
 */
const MAX_SURVIVORS = 2;

/**
 * The spawn option this file both WRITES INTO FIXTURES and SCANS THE TREE FOR,
 * assembled so that the file doing the scanning is not itself a hit.
 *
 * Not squeamishness: written as a literal it is a real occurrence in a real
 * source file, and the scan reported this file on its first run, twice, both
 * times correctly. The regex meets the true shape at match time either way —
 * how the characters became adjacent is nothing to the regex and everything to
 * the file being read.
 */
const DETACHED_KEY = `deta${'ched'}`;

/**
 * How long a teardown fixture must stay alive (finding AAAA-35).
 *
 * AAAA-30's lesson one commit later, in a harder shape. There the ordering was
 * one fixture against one wait; here the ORDINARY probe's grandchild has to
 * outlive its own probe, then the whole of the DETACHED probe, then the
 * cleanup differential — because that grandchild is only killed at the end,
 * and a survivor that expired on its own is indistinguishable from one that
 * was torn down. So the quantity is not a budget, it is the SPAN:
 *
 *   two probes, each at most SETUP_BUDGET_MS of polling plus SETTLE_MS plus one
 *   SAMPLE_GAP_MS, then a cleanup which — PER SURVIVOR, and there can be
 *   MAX_SURVIVORS of them — polls up to CLEANUP_ADVANCE_BUDGET_MS for the
 *   counter to move, kills, settles, and samples once more.
 *
 * Written as that sum rather than as a number, so tightening the budget cannot
 * silently move the fixture underneath it.
 *
 * **CORRECTED, finding AAAA-38.** The sum first written here ended
 * `+ SETTLE_MS + 400` and its sentence described "a cleanup that samples, waits
 * and samples again" — the cleanup that AAAA-34 had replaced **in the same
 * commit**. The new one is per survivor and can run twice, so the term was
 * short by roughly a factor of four. Nothing was broken, because the headroom
 * covered it; that is precisely the danger. AAAA-35's whole content was
 * replacing a guess with a derivation, and **a derivation missing a term is a
 * half-derivation** — the next person tightening `SETUP_BUDGET_MS` trusts a sum
 * that does not cover what it says it covers. One commit changed both halves
 * and only one half moved: item 7's shape, in the file that had just been
 * fixed for it.
 *
 * THE HEADROOM IS SEPARATE AND NAMED, because it is not derived. The span is
 * computed from this file's own budgets; the fixture's timer is wall-clock and
 * does not stretch when a runner is slow, so a slow machine spends longer in
 * the probes against a fixed deadline. Four times the span is the margin for
 * that, and it is a judgement rather than a measurement — which is why it is a
 * factor with a reason instead of a bigger number.
 *
 * MEASURED 2026-08-24 by running this file with the value overridden: at
 * 1200ms the cleanup differential goes RED naming the survivor it could not see
 * advancing, and at 2000ms everything still passes. So the real boundary on
 * this machine was around 1.5s against a derived value then of ~89s. That gap
 * is the point — the derivation exists so nobody has to know where the edge is,
 * and the observable half is the pre-kill advance poll, which fires instead of
 * the run passing by absence.
 */
const PROBE_SPAN_MS =
  2 * (SETUP_BUDGET_MS + SETTLE_MS + SAMPLE_GAP_MS) +
  MAX_SURVIVORS * (CLEANUP_ADVANCE_BUDGET_MS + SETTLE_MS + SAMPLE_GAP_MS);
const TEARDOWN_HEADROOM = 4;
const TEARDOWN_FIXTURE_MS = PROBE_SPAN_MS * TEARDOWN_HEADROOM;

const EXIT_ZERO = 'process.exit(0);\n';
const EXIT_ONE = "process.stderr.write('FAIL deliberate\\n');\nprocess.exit(1);\n";
const HANGS = 'setInterval(() => undefined, 1000);\n';

try {
  // -------------------------------------------------------------------------
  // 1 & 2. It can report a failure, and it does not report everything as one.
  // -------------------------------------------------------------------------
  const red = runFixture(
    { 'bad.mjs': EXIT_ONE, 'good.mjs': EXIT_ZERO },
    { 'proof:bad': 'node scripts/bad.mjs', 'proof:good': 'node scripts/good.mjs' },
  );
  check(
    'a script that exits non-zero is reported FAILED, and the sweep exits non-zero',
    !red.ok && /FAILED\s+proof:bad/u.test(red.output),
    `exit ok=${String(red.ok)}. Output:\n${red.output}`,
  );
  check(
    'CONTROL: and the passing script beside it is reported ok',
    /\bok\s+proof:good/u.test(red.output),
    `a harness that reports everything as failed satisfies the case above. Output:\n${red.output}`,
  );

  // -------------------------------------------------------------------------
  // 3. NO SHELL IS INTERPOSED. Reads the harness, not the results.
  // -------------------------------------------------------------------------
  const spaced = runFixture(
    { 'ok.mjs': EXIT_ZERO },
    { 'proof:spaced': 'node scripts/ok.mjs' },
  );
  check(
    'the interpreter is spawned directly, so a path containing a SPACE still runs',
    spaced.ok && /\bok\s+proof:spaced/u.test(spaced.output),
    `The fixture root's path contains a space. Run through a shell the command line splits ` +
      `and the script is not found; run directly it is nothing at all. This is the property ` +
      `that made the first version orphan its children on every timeout, and no assertion ` +
      `about RESULTS can see it. Output:\n${spaced.output}`,
  );

  // -------------------------------------------------------------------------
  // 4 & 5. A TIMEOUT STOPS THE SWEEP. Also a harness property.
  // -------------------------------------------------------------------------
  const marker = 'ran-second.txt';
  const writesMarker =
    `import { writeFileSync } from 'node:fs';\n` +
    `writeFileSync(new URL('../${marker}', import.meta.url), 'yes', 'utf8');\n`;
  const twoScripts = { 'a-hangs.mjs': HANGS, 'b-marks.mjs': writesMarker };
  // Named so the sort puts the hanging one FIRST — the sweep runs in sorted
  // order, and a fixture whose slow script sorts last would prove nothing.
  const twoNames = {
    'proof:a-hangs': 'node scripts/a-hangs.mjs',
    'proof:b-marks': 'node scripts/b-marks.mjs',
  };

  const stopped = runFixture(twoScripts, twoNames, ['--timeout', '2']);
  check(
    'a timeout STOPS the sweep, so the script after it never runs',
    /TIMED OUT\s+proof:a-hangs/u.test(stopped.output) &&
      !existsSync(join(stopped.root, marker)),
    `A timeout orphans the timed-out script's own children, so every result after one is ` +
      `measured against a machine carrying them — twenty invented failures, once. ` +
      `marker exists=${String(existsSync(join(stopped.root, marker)))}. Output:\n${stopped.output}`,
  );
  check(
    'CONTROL: and with nothing timing out, that second script DOES run',
    (() => {
      const clean = runFixture(
        { 'b-marks.mjs': writesMarker },
        { 'proof:b-marks': 'node scripts/b-marks.mjs' },
      );
      return clean.ok && existsSync(join(clean.root, marker));
    })(),
    'without this, "the marker is absent" is satisfied by a harness that runs nothing at all, ' +
      'or by a fixture whose second script never wrote a marker in the first place.',
  );

  // -------------------------------------------------------------------------
  // 5a & 5b. COULD NOT LOOK IS NOT A PASS (finding DDDD-6).
  //
  // The permissive could-not-look outcome exits 0 by design, so a harness
  // reading the exit code alone reports a probe that measured nothing as green.
  // Measured 2026-08-25 by moving a built module aside: `ok
  // proof:transportwrite (0.3s)`, after which the affected-proofs disclosure
  // certified that this run had reached every proof reading a changed file.
  //
  // THE FIXTURE'S MARKER COMES FROM THE MODULE THAT OWNS IT. A literal here
  // would be a second opinion about what `unverifiable.mjs` prints, and the two
  // would drift the first time its wording changed — B3a, in a fixture.
  // -------------------------------------------------------------------------
  const blindBody = `process.stdout.write(${JSON.stringify(
    `${UNVERIFIABLE_MARKER}the fixture is not measured here\n      nothing provisioned it\n`,
  )});\n`;
  const cannotLook = runFixture(
    { 'a-blind.mjs': blindBody, 'b-seeing.mjs': EXIT_ZERO },
    { 'proof:a-blind': 'node scripts/a-blind.mjs', 'proof:b-seeing': 'node scripts/b-seeing.mjs' },
  );
  check(
    'a probe that could not look is reported UNVERIFIABLE rather than as a pass',
    /UNVERIFIABLE\s+proof:a-blind/u.test(cannotLook.output) &&
      /1 unverifiable/u.test(cannotLook.output),
    `exit 0 and a green line are the same observation otherwise, and the stronger the sweep's ` +
      `coverage claim gets the more it then certifies. Output:\n${cannotLook.output}`,
  );
  check(
    'CONTROL: and an ordinary zero-exit script in the same run IS a pass',
    /1 passed,/u.test(cannotLook.output) && /\bok\s+proof:b-seeing/u.test(cannotLook.output),
    `without this, "not counted as a pass" is satisfied by a classifier that calls EVERYTHING ` +
      `unverifiable — the opposite error, and one that makes the state useless rather than ` +
      `absent. Output:\n${cannotLook.output}`,
  );

  // -------------------------------------------------------------------------
  // 6. The floor is a positive control and refuses a broken derivation.
  // -------------------------------------------------------------------------
  const belowFloor = spawnSync(
    process.execPath,
    [HARNESS, '--root', runFixture({ 'ok.mjs': EXIT_ZERO }, { 'proof:one': 'node scripts/ok.mjs' }).root, '--floor', '5'],
    { encoding: 'utf8' },
  );
  check(
    'a derivation below the declared floor is REFUSED, not reported as a quiet repository',
    belowFloor.status !== 0 && /under a floor/u.test(`${belowFloor.stdout}${belowFloor.stderr}`),
    `A renamed "scripts" key and a filter that stopped matching both derive zero scripts and ` +
      `then report zero failures. exit=${String(belowFloor.status)}`,
  );

  // -------------------------------------------------------------------------
  // 7 & 8. A script it cannot invoke is NOT a pass.
  // -------------------------------------------------------------------------
  const notNode = runFixture(
    { 'ok.mjs': EXIT_ZERO },
    { 'proof:shelled': 'npm run something-else', 'proof:fine': 'node scripts/ok.mjs' },
  );
  check(
    'a script that is not a bare node invocation is reported NOT RUN',
    /NOT RUN\s+proof:shelled/u.test(notNode.output),
    `A script this harness cannot invoke is a hole in the derivation, and a hole that prints ` +
      `nothing is the derivation lying about its own coverage. Output:\n${notNode.output}`,
  );
  check(
    'and NOT RUN makes the sweep exit non-zero, because it is not a pass',
    !notNode.ok,
    `exit ok=true. "Everything I could run passed" and "everything passed" are different ` +
      `claims, and an exit code that cannot tell them apart is the one this proof exists for.`,
  );

  // -------------------------------------------------------------------------
  // 9-12. ORDERING BY MEASURED COST (findings RRR-1, SSS-1). Harness properties:
  // the same scripts pass in any order, so no assertion about RESULTS can see
  // these. What they buy is that a stop strands the expensive TAIL rather than
  // an alphabetical remainder.
  // -------------------------------------------------------------------------
  {
    /** @param {Record<string, number>} table @param {string[]} names */
    const withTable = (table, names) => {
      /** @type {Record<string, string>} */
      const files = {};
      /** @type {Record<string, string>} */
      const manifest = {};
      for (const name of names) {
        files[`${name}.mjs`] = EXIT_ZERO;
        manifest[`proof:${name}`] = `node scripts/${name}.mjs`;
      }
      const root = mkdtempSync(join(scratch, 'ordered '));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, '.cache'), { recursive: true });
      for (const [file, body] of Object.entries(files)) {
        writeFileSync(join(root, 'scripts', file), body, 'utf8');
      }
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'fixture', scripts: manifest }, null, 2),
        'utf8',
      );
      giveFixtureWorkflows(root, manifest);
      writeFileSync(
        join(root, '.cache', 'checkLocal-durations.json'),
        JSON.stringify(table, null, 2),
        'utf8',
      );
      const run = spawnSync(process.execPath, [HARNESS, '--root', root, '--floor', '1'], {
        encoding: 'utf8',
      });
      const order = `${run.stdout ?? ''}`
        .split('\n')
        .map((line) => /^ {2}ok {2}(proof:[\w-]+)/u.exec(line)?.[1])
        .filter((name) => name !== undefined);
      return { root, order, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
    };

    // Alphabetical order is a-slow, b-mid, c-fast. Cost order is the reverse, so
    // a run that happens to be alphabetical cannot pass this by luck.
    const ordered = withTable(
      { 'proof:a-slow': 90, 'proof:b-mid': 10, 'proof:c-fast': 1 },
      ['a-slow', 'b-mid', 'c-fast'],
    );
    check(
      'the sweep runs cheapest-measured FIRST, not alphabetically',
      ordered.order.join(',') === 'proof:c-fast,proof:b-mid,proof:a-slow',
      `ran ${ordered.order.join(', ')}. The fixture's alphabetical order is the exact reverse ` +
        `of its cost order, so an unsorted run reads as a-slow first. Output:\n${ordered.output}`,
    );

    // `a-unknown` sorts FIRST alphabetically and is absent from the table.
    const unmeasured = withTable(
      { 'proof:b-known': 5 },
      ['a-unknown', 'b-known'],
    );
    check(
      'a never-measured script runs after every measured one that fits the budget',
      unmeasured.order.join(',') === 'proof:b-known,proof:a-unknown',
      `ran ${unmeasured.order.join(', ')}. Sorting an unknown cost as cheap lets one new ` +
        `expensive script strand the whole queue again, which is the failure the ordering ` +
        `exists to prevent. Output:\n${unmeasured.output}`,
    );

    // The middle bucket (finding SSS-1). Sorting the unknown behind EVERYTHING
    // stranded new scripts permanently: it sat behind a script that times out on
    // every run, was reported "never measured", and so sorted last again next
    // time — "will never be measured" printed as "not yet measured".
    //
    // Alphabetical order here is a-doomed, b-unknown, c-cheap, which is neither
    // the expected order nor a rotation of it, so neither an unsorted run nor
    // the old two-bucket sort (c-cheap, a-doomed, b-unknown) can pass by luck.
    const bucketed = withTable(
      { 'proof:a-doomed': 400, 'proof:c-cheap': 1 },
      ['a-doomed', 'b-unknown', 'c-cheap'],
    );
    check(
      'a never-measured script runs BEFORE one whose last cost hit the budget',
      bucketed.order.join(',') === 'proof:c-cheap,proof:b-unknown,proof:a-doomed',
      `ran ${bucketed.order.join(', ')}, expected proof:c-cheap, proof:b-unknown, ` +
        `proof:a-doomed. A script already measured at or over the bound is one this sweep ` +
        `knows it cannot finish, so putting the unknown behind it too is what made "never ` +
        `measured" permanent. The unknown belongs after the cheap work and ahead of the ` +
        `portion that was going to strand anyway. Output:\n${bucketed.output}`,
    );

    // The table is written BEFORE the summary, so a run that stopped early still
    // improves the next one's ordering — which is precisely the run that needs
    // it most.
    const partial = runFixture(
      { 'a-hangs.mjs': HANGS, 'b-marks.mjs': EXIT_ZERO },
      { 'proof:a-hangs': 'node scripts/a-hangs.mjs', 'proof:b-marks': 'node scripts/b-marks.mjs' },
      ['--timeout', '2'],
    );
    // -----------------------------------------------------------------------
    // 13 & 14. THE TREE MOVED (finding WWW-1). A harness property, and the one
    // that cost a tracked document: this sweep KILLS a script at the bound, a
    // killed process does not run its `finally`, and a proof that removes a
    // tracked file to make a point leaves it removed. Measured — a 90-second
    // sweep deleted `docs/ENGINE-SPIKE.md` and printed a clean summary.
    //
    // The fixture is a real git repository, because the witness asks git. The
    // script under test deletes a tracked file and exits 0, so nothing else in
    // the run has anything to complain about — which is the point: without the
    // witness this sweep reports "1 passed" over a damaged tree.
    // -----------------------------------------------------------------------
    {
      const root = mkdtempSync(join(scratch, 'moved '));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      const git = (/** @type {string[]} */ args) =>
        spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      git(['init', '--quiet']);
      git(['config', 'user.email', 'proof@example.invalid']);
      git(['config', 'user.name', 'proof']);
      writeFileSync(join(root, 'tracked.txt'), 'content\n', 'utf8');
      writeFileSync(
        join(root, 'scripts', 'deletes.mjs'),
        "import { rmSync } from 'node:fs';\n" +
          "rmSync(new URL('../tracked.txt', import.meta.url), { force: true });\n" +
          'process.exit(0);\n',
        'utf8',
      );
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
          { name: 'fixture', scripts: { 'check:deletes': 'node scripts/deletes.mjs' } },
          null,
          2,
        ),
        'utf8',
      );
      giveFixtureWorkflows(root, { 'check:deletes': 'node scripts/deletes.mjs' });
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', 'base']);

      const moved = spawnSync(
        process.execPath,
        [HARNESS, '--root', root, '--floor', '1'],
        { encoding: 'utf8' },
      );
      const output = `${moved.stdout ?? ''}${moved.stderr ?? ''}`;
      check(
        'a script that damages the tree makes the sweep report THE TREE MOVED',
        moved.status !== 0 && /THE TREE MOVED/u.test(output),
        `Every script PASSED, so nothing else in this run has a complaint — which is exactly ` +
          `the shape that deleted a tracked document and printed a clean summary. ` +
          `exit=${String(moved.status)}. Output:\n${output}`,
      );
      check(
        '  ...and NAMES THE SCRIPT that moved it, not merely the run',
        /THE TREE MOVED under check:deletes/u.test(output) && /Moved under: check:deletes/u.test(output),
        `The witness was taken once before the run and read once after, so it said "under this ` +
          `run" and named nothing — across sixty-four scripts that is a starting point, not an ` +
          `answer. Measured 2026-08-24: sampling after every script located proof:hookprobe as ` +
          `the culprit in one pass. Asserting only /THE TREE MOVED/ is satisfied by the ` +
          `run-scoped version, which is why this is a separate case.\nOutput:\n${output}`,
      );
      check(
        'CONTROL: and a sweep that damages nothing says the tree is as it found it',
        (() => {
          const clean = runFixture(
            { 'ok.mjs': EXIT_ZERO },
            { 'check:ok': 'node scripts/ok.mjs' },
          );
          // The fixture repositories runFixture builds are not git repos, so
          // this asserts the OTHER honest state rather than a clean witness —
          // "nobody looked" and "nothing moved" are different answers and this
          // file must not let them merge.
          return clean.ok && /not witnessed: this root is not a git repository/u.test(clean.output);
        })(),
        'without this, "THE TREE MOVED" is satisfied by a harness that says it every time, and ' +
          'a third state that always fires is one people learn to ignore.',
      );
    }

    check(
      'a run that STOPPED early still records what it measured',
      (() => {
        try {
          const table = JSON.parse(
            readFileSync(join(partial.root, '.cache', 'checkLocal-durations.json'), 'utf8'),
          );
          return typeof table['proof:a-hangs'] === 'number';
        } catch {
          return false;
        }
      })(),
      'the timed-out script has no recorded cost, so the next run sorts it first again and ' +
        'strands the queue in exactly the same place. A partial sweep is the one whose ' +
        'ordering most needs the measurement it just took.',
    );

    // A TIMED-OUT run is sealed `-failed`, not left `-running`: the harness got
    // to decide, so the run finished even though a script did not. That
    // distinction is the whole design — `-running` must mean "nobody was left
    // to rename this" and nothing else, or the state loses its meaning exactly
    // where it is needed.
    check(
      'a run stopped by a TIMEOUT seals its log as -failed, with the timed-out script in it',
      (() => {
        const logs = runLogs(partial.root);
        if (logs.length !== 1 || runLogState(logs[0] ?? '') !== 'failed') return false;
        return runLogRows(partial.root, logs[0] ?? '').some(
          (row) => row['name'] === 'proof:a-hangs',
        );
      })(),
      `The timeout path returned early before this was fixed, so the one run that orphans ` +
        `processes wrote NOTHING — a log with a hole at its own subject, whose silence reads ` +
        `as a quiet run. Logs found: ${JSON.stringify(runLogs(partial.root))}`,
    );
    check(
      'CONTROL: a run that PASSES seals as -ok, so -failed is not simply what sealing prints',
      (() => {
        const logs = runLogs(spaced.root);
        return logs.length === 1 && runLogState(logs[0] ?? '') === 'ok';
      })(),
      `Without this, the case above is satisfied by a harness that names every log -failed, ` +
        `and the state in the filename would carry no information. ` +
        `Logs found: ${JSON.stringify(runLogs(spaced.root))}`,
    );
  }

  // -------------------------------------------------------------------------
  // RETENTION, as a decision over a listing (finding AAAA-29).
  //
  // No processes, no repository, no kill. This is the piece that could not be
  // asserted while it lived inside the harness, and it is the piece that
  // decides which evidence still exists when somebody comes looking.
  //
  // The fixture deliberately pairs a `-running` and an `-ok` log at the SAME
  // timestamp, because the defect worth catching is a prune that goes by age
  // and ignores the state in the name — which is what the filename is for.
  // -------------------------------------------------------------------------
  {
    const listing = [
      '2026-08-01T00-00-00-1-ok.json',
      '2026-08-02T00-00-00-1-ok.json',
      '2026-08-03T00-00-00-1-ok.json',
      '2026-08-01T00-00-00-2-failed.json',
      '2026-08-01T00-00-00-3-running.json',
      'notes.txt',
    ];
    const split = retention(listing, { keepOk: 1, keepEvidence: 5 });

    check(
      'the OLDEST -ok logs are pruned and the newest survives',
      split.remove.includes('2026-08-01T00-00-00-1-ok.json') &&
        split.remove.includes('2026-08-02T00-00-00-1-ok.json') &&
        split.keep.includes('2026-08-03T00-00-00-1-ok.json'),
      `A prune that keeps the wrong end deletes exactly the runs somebody is about to read. ` +
        `remove=${JSON.stringify(split.remove)} keep=${JSON.stringify(split.keep)}`,
    );
    check(
      'a -running and a -failed log outlive an -ok log OLDER THAN NEITHER',
      split.keep.includes('2026-08-01T00-00-00-3-running.json') &&
        split.keep.includes('2026-08-01T00-00-00-2-failed.json') &&
        split.remove.includes('2026-08-01T00-00-00-1-ok.json'),
      `All three carry the same date, so age cannot separate them and only the state in the ` +
        `filename can. This is the case that fails if the two budgets are ever collapsed into ` +
        `one. keep=${JSON.stringify(split.keep)}`,
    );
    check(
      'an entry that is not a .json log is neither kept nor deleted',
      !split.keep.includes('notes.txt') && !split.remove.includes('notes.txt'),
      `This prunes a directory. A classifier that does not recognise a name must leave it ` +
        `alone rather than sweep it up. keep=${JSON.stringify(split.keep)} ` +
        `remove=${JSON.stringify(split.remove)}`,
    );
    check(
      'keeping NONE removes all of them, rather than keeping all of them',
      (() => {
        const none = retention(listing, { keepOk: 0, keepEvidence: 0 });
        return none.remove.length === 5 && none.keep.length === 0;
      })(),
      `The inline version spelt this \`slice(0, -keep)\`, and \`-0\` is \`0\`: asking to keep ` +
        `nothing kept everything. It was safe only because its one caller passed a literal 5, ` +
        `which is the property that stops being true the moment a rule has two callers.`,
    );
    check(
      'CONTROL: within budget it prunes NOTHING, so "remove" is not simply everything',
      (() => {
        const roomy = retention(listing, { keepOk: 9, keepEvidence: 9 });
        return roomy.remove.length === 0 && roomy.keep.length === 5;
      })(),
      `Deleting nothing is what every broken version of this produces, so the cases above ` +
        `need their mirror: a listing under budget must survive intact, or "prunes the right ` +
        `files" is satisfied by a function that prunes them all.`,
    );
  }

  // -------------------------------------------------------------------------
  // A KILLED RUN'S LOG STAYS `-running`, FOR EVER (finding AAAA-29).
  //
  // This is the state the whole mechanism exists for and the one nothing had
  // ever asserted — it shipped on a single hand-run kill. A killed process
  // cannot rename its own file, so `-running` is not a transient state: it is
  // the permanent record of a run that did not finish, and it is what makes
  // the hardest case to reconstruct afterwards self-identifying in a listing.
  //
  // The seal cases above are this one's control: a run that finishes leaves
  // `-ok` or `-failed` and no `-running` at all, so "the file says -running" is
  // not something every run produces.
  // -------------------------------------------------------------------------
  {
    const root = mkdtempSync(join(scratch, 'killed '));
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'a-fast.mjs'), EXIT_ZERO, 'utf8');
    // Two properties, and BOTH are about the orphan this case creates on
    // purpose. Killing the harness orphans the script it was running, and
    // nothing in this file can reap it: `taskkill /T` and a POSIX process group
    // are two implementations of tree-killing, each with a side that never
    // executes on the other platform — an unexercised branch inside a proof
    // about unexercised branches.
    //
    //   - it EXPIRES, so the orphan is bounded without that branch;
    //   - it CHDIRs out of the fixture first, because the harness spawns every
    //     script with the repository root as its cwd, and on Windows a
    //     directory that is a live process's cwd cannot be removed. Without
    //     this line the `finally` below races the orphan for the scratch tree,
    //     which is a flake that would land on one platform only.
    //
    // ITS LIFETIME IS DERIVED FROM THE WAIT BELOW, NOT CHOSEN BESIDE IT
    // (finding AAAA-30). The case only reaches the state under test while the
    // fixture is still running, so the two numbers must stay ordered — and each
    // is individually reasonable to change: bound the orphan more tightly, or
    // allow a slow runner more attempts, and the fixture starts expiring before
    // the wait ends. That failure arrives as a RED for a case that never got
    // set up, which is exactly the "could not look" this repository refuses to
    // let merge with "looked and it was wrong". A margin on one named budget
    // makes the ordering a property of the code instead of a coincidence.
    writeFileSync(
      join(root, 'scripts', 'b-hangs.mjs'),
      "import { tmpdir } from 'node:os';\nprocess.chdir(tmpdir());\nsetTimeout(() => process.exit(0), " +
        String(SETUP_BUDGET_MS + SETUP_MARGIN_MS) +
        ');\n',
      'utf8',
    );
    check(
      'SETUP: the hanging fixture outlives the wait, so a red here cannot be a fixture expiring',
      (() => {
        const written = readFileSync(join(root, 'scripts', 'b-hangs.mjs'), 'utf8');
        const match = /process\.exit\(0\), (\d+)\)/u.exec(written);
        return match !== null && Number(match[1]) > SETUP_BUDGET_MS;
      })(),
      `Read off the file this case just WROTE, not off the expression above it, so a future ` +
        `edit that puts a literal back is caught as well as a margin that goes to zero. The ` +
        `derivation makes the ordering structural; this makes it observable, which is what ` +
        `separates a case that could not be set up from a mechanism that misbehaved.`,
    );
    const killScripts = {
      'proof:a-fast': 'node scripts/a-fast.mjs',
      'proof:b-hangs': 'node scripts/b-hangs.mjs',
    };
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: killScripts }, null, 2),
      'utf8',
    );
    giveFixtureWorkflows(root, killScripts);

    // Unmeasured scripts sort alphabetically, so `a-fast` completes and writes
    // the first row while `b-hangs` is still running. That is the state this
    // case needs: a log with rows in it, mid-flight, at the moment of the kill.
    const child = spawn(process.execPath, [HARNESS, '--root', root, '--floor', '1'], {
      stdio: 'ignore',
    });
    /** @type {string[]} */
    let midFlight = [];
    let waited = 0;
    while (waited < SETUP_BUDGET_MS && midFlight.length === 0) {
      sleepSync(SETUP_POLL_MS);
      waited += SETUP_POLL_MS;
      midFlight = runLogs(root);
    }
    child.kill('SIGKILL');
    sleepSync(SETTLE_MS);
    const after = runLogs(root);

    check(
      'a run KILLED mid-sweep leaves its log named -running, because it could not rename it',
      after.length === 1 && runLogState(after[0] ?? '') === 'running',
      `A harness that seals on exit, or one whose log is a single slot the next run ` +
        `overwrites, cannot produce this. ${String(SETUP_BUDGET_MS)}ms were allowed for the ` +
        `first row to appear and the wait ended after ${String(waited)}ms; found mid-flight ` +
        `${JSON.stringify(midFlight)}, after the kill ${JSON.stringify(after)}. An EMPTY ` +
        `mid-flight list means the harness never got that far, which is a setup that did not ` +
        `complete rather than a mechanism that misbehaved.`,
    );
    check(
      '  ...and the rows it had already written are still in it',
      after.length === 1 &&
        runLogRows(root, after[0] ?? '').some((row) => row['name'] === 'proof:a-fast'),
      `An empty file named -running proves the name and nothing else. What the killed run is ` +
        `kept FOR is the account of what completed immediately before it stopped, which is ` +
        `the question WWW-2 turns on. Rows: ` +
        `${after.length === 1 ? JSON.stringify(runLogRows(root, after[0] ?? '')) : '(no log)'}`,
    );
  }

  // -------------------------------------------------------------------------
  // WHAT THE PLATFORM DOES TO A GRANDCHILD (findings AAAA-6, AAAA-31).
  //
  // The job-object requirement was WITHDRAWN on the strength of a hand-run
  // measurement written into a comment. That is the wrong home for it twice
  // over: a withdrawal is the one kind of claim that removes a check rather
  // than adding one, and this half is a property of the RUNTIME — whatever
  // libuv does with an ordinary Windows child is libuv's decision, and a node
  // bump is exactly the event that would falsify it in silence. A claim owed an
  // expiry with nothing able to fire one.
  //
  // THE DIFFERENTIAL IS THE CONTROL, and without it this is unreadable: "the
  // grandchild is gone" and "the grandchild never started" are the same
  // observation, which is the trap this file has now caught three times. So the
  // probe must SEE the grandchild alive and advancing a counter before anything
  // is killed, and the same grandchild spawned `detached` must still be
  // advancing afterwards.
  //
  // Scoped by platform, both sides asserted, neither vacuous: win32 tears the
  // tree down, and on Linux nothing ties a child's lifetime to its parent's.
  // Each leg of Guards runs its own half.
  // -------------------------------------------------------------------------
  {
    /**
     * Runs the harness against a fixture whose script spawns a grandchild that
     * keeps writing an advancing counter, kills the harness, and reports
     * whether that counter was moving before and after.
     *
     * @param {boolean} detachChild
     */
    const probeGrandchild = (detachChild) => {
      const root = mkdtempSync(join(scratch, detachChild ? 'detached ' : 'ordinary '));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      const marker = join(root, 'tick.txt').replaceAll('\\', '/');
      const pidPath = join(root, 'gc.pid').replaceAll('\\', '/');
      // Absolute paths captured BEFORE the chdir, and the chdir is here for the
      // reason it is in the kill case: a survivor holding the fixture as its
      // cwd cannot be removed on Windows.
      writeFileSync(
        join(root, 'scripts', 'grandchild.mjs'),
        "import { writeFileSync } from 'node:fs';\n" +
          "import { tmpdir } from 'node:os';\n" +
          `writeFileSync('${pidPath}', String(process.pid), 'utf8');\n` +
          'process.chdir(tmpdir());\n' +
          'let n = 0;\n' +
          `setInterval(() => { n += 1; writeFileSync('${marker}', String(n), 'utf8'); }, 100);\n` +
          `setTimeout(() => process.exit(0), ${String(TEARDOWN_FIXTURE_MS)});\n`,
        'utf8',
      );
      writeFileSync(
        join(root, 'scripts', 'a-spawns.mjs'),
        "import { spawn } from 'node:child_process';\n" +
          "import { fileURLToPath } from 'node:url';\n" +
          "const gc = fileURLToPath(new URL('./grandchild.mjs', import.meta.url));\n" +
          `const c = spawn(process.execPath, [gc], { stdio: 'ignore', ${DETACHED_KEY}: ${String(detachChild)} });\n` +
          (detachChild ? 'c.unref();\n' : '') +
          `setTimeout(() => process.exit(0), ${String(TEARDOWN_FIXTURE_MS)});\n`,
        'utf8',
      );
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
          { name: 'fixture', scripts: { 'proof:a-spawns': 'node scripts/a-spawns.mjs' } },
          null,
          2,
        ),
        'utf8',
      );
      giveFixtureWorkflows(root, { 'proof:a-spawns': 'node scripts/a-spawns.mjs' });

      /** @returns {number | null} */
      const tick = () => {
        try {
          const value = Number(readFileSync(marker, 'utf8').trim());
          return Number.isFinite(value) ? value : null;
        } catch {
          return null;
        }
      };

      const child = spawn(process.execPath, [HARNESS, '--root', root, '--floor', '1'], {
        stdio: 'ignore',
      });

      // ALIVE means the counter MOVED, not that a file appeared. A grandchild
      // that wrote once and died would satisfy the weaker form, and that is the
      // same observation as the teardown this case is trying to detect.
      let first = null;
      let sawAdvance = false;
      let waited = 0;
      while (waited < SETUP_BUDGET_MS && !sawAdvance) {
        sleepSync(SETUP_POLL_MS);
        waited += SETUP_POLL_MS;
        const now = tick();
        if (now === null) continue;
        if (first === null) first = now;
        else if (now > first) sawAdvance = true;
      }

      child.kill('SIGKILL');
      sleepSync(SETTLE_MS);
      const afterKill = tick();
      sleepSync(SAMPLE_GAP_MS);
      const later = tick();

      /** @type {number | null} */
      let pid;
      try {
        pid = Number(readFileSync(pidPath, 'utf8').trim());
      } catch {
        pid = null;
      }
      return {
        sawAdvance,
        stillAdvancing: afterKill !== null && later !== null && later > afterKill,
        pid: Number.isFinite(pid) ? pid : null,
        tick,
      };
    };

    const ordinary = probeGrandchild(false);
    const detachedGrandchild = probeGrandchild(true);

    check(
      'CONTROL: both grandchildren were seen ADVANCING before anything was killed',
      ordinary.sawAdvance && detachedGrandchild.sawAdvance,
      `"it stopped" and "it never started" are the same observation, and this is the only ` +
        `thing separating them. ordinary advanced=${String(ordinary.sawAdvance)} ` +
        `detached advanced=${String(detachedGrandchild.sawAdvance)}.`,
    );

    if (process.platform === 'win32') {
      check(
        'win32: an ORDINARY grandchild stops when the harness is killed',
        !ordinary.stillAdvancing,
        `This is the measurement the job-object withdrawal rests on, and it is a property of ` +
          `the RUNTIME rather than of this repository — libuv puts an ordinary Windows child ` +
          `in a job object, and a node bump could take that away in silence. If this is red, ` +
          `the withdrawal in the FEATURES row is what has to be revisited, not this case.`,
      );
      check(
        'win32 CONTROL: a DETACHED grandchild survives the same kill',
        detachedGrandchild.stillAdvancing,
        `Without this, the case above is satisfied by everything dying for any reason at all — ` +
          `the machine going quiet, the fixture expiring, the probe losing the file. The ` +
          `differential is what makes it teardown.`,
      );
    } else {
      check(
        'not win32: an ordinary grandchild SURVIVES, because nothing here ties it to its parent',
        ordinary.stillAdvancing,
        `The opposite half of the same claim, asserted on its own Guards leg so neither side ` +
          `is a platform nobody runs. If this is red, the finding is that this platform DOES ` +
          `tear the tree down, which would be worth knowing and is not something this ` +
          `repository has ever measured.`,
      );
      check(
        'not win32 CONTROL: a detached grandchild survives too, so the probe is not reading win32',
        detachedGrandchild.stillAdvancing,
        'both variants survive here, and a probe that reported teardown on this platform would ' +
          'be reporting something other than the process tree.',
      );
    }

    // CLEANUP IS ALSO THE CONTROL THAT THIS PROBE CAN SEE A STOP AT ALL, and
    // it is a DIFFERENTIAL rather than a single reading (finding AAAA-34).
    //
    // The first version sampled, killed, sampled again and required stillness.
    // A process killed a second ago produces that — and so does one that died
    // four minutes ago, because a stale file reads identically to a stilled
    // one. `stillAdvancing` is not the protection it looks like: it was
    // measured at PROBE time, and for the ordinary survivor on the non-win32
    // leg that is a whole second probe earlier. Had it died in between,
    // `process.kill` throws ESRCH, the catch swallows it, and the control
    // passes having proven nothing.
    //
    // That is this file's own sentence — "it stopped" and "it never started"
    // are the same observation — reappearing INSIDE the control added to close
    // it. The placement is the finding, not the odds. So the rule
    // `probeGrandchild` applies to itself is applied here too: require the
    // counter to ADVANCE before the kill, then require stillness after.
    /** @type {Array<{ label: string, probe: ReturnType<typeof probeGrandchild> }>} */
    const probes = [
      { label: 'ordinary', probe: ordinary },
      { label: 'detached', probe: detachedGrandchild },
    ];
    check(
      'SETUP: the teardown block probes exactly the number the fixture lifetime assumes',
      probes.length === MAX_SURVIVORS,
      `TEARDOWN_FIXTURE_MS is derived assuming at most ${String(MAX_SURVIVORS)} survivors reach ` +
        `the cleanup, each costing an advance poll, a settle and a sample gap. A third probe ` +
        `added without widening that sum would leave the fixtures expiring underneath it, and ` +
        `nothing else in this file compares the two. Probes: ${String(probes.length)}.`,
    );
    const survivors = probes.filter((entry) => entry.probe.stillAdvancing);

    /**
     * POLLED, not sampled once (finding AAAA-37).
     *
     * This was one 150ms window against a counter written every 100ms, so a
     * single stretched tick on a loaded runner reported "did not advance" — a
     * red for a case that could not be set up, which is the outcome the SETUP
     * case above exists to keep separate from a real failure. The probe gives
     * this same property ten seconds of polling; the cleanup gave it one look.
     *
     * @param {ReturnType<typeof probeGrandchild>} probe
     */
    const seenAdvancing = (probe) => {
      const before = probe.tick();
      if (before === null) return false;
      let waited = 0;
      while (waited < CLEANUP_ADVANCE_BUDGET_MS) {
        sleepSync(SETUP_POLL_MS);
        waited += SETUP_POLL_MS;
        const now = probe.tick();
        if (now !== null && now > before) return true;
      }
      return false;
    };

    /** @type {string[]} */
    const stopped = [];
    for (const { label, probe } of survivors) {
      const wasAlive = seenAdvancing(probe);

      if (probe.pid !== null) {
        try {
          process.kill(probe.pid, 'SIGKILL');
        } catch {
          // Already gone. `wasAlive` above is what decides whether that is a
          // problem, and it is read below rather than swallowed here.
        }
      }
      sleepSync(SETTLE_MS);
      const settled = probe.tick();
      sleepSync(SAMPLE_GAP_MS);
      const later = probe.tick();
      const wentStill = settled !== null && later !== null && later === settled;

      if (wasAlive && wentStill) stopped.push(label);
    }

    check(
      'CONTROL: a survivor is seen ADVANCING, then killed, then seen still',
      survivors.length > 0 && stopped.length === survivors.length,
      `A probe that can only ever report "advancing" would pass every case above on the ` +
        `platform where survival is the expected answer, so this kills the survivors — which ` +
        `it must do anyway — and requires the counter to go still. The ADVANCE half is what ` +
        `stops a process that died minutes ago from satisfying it: a stale file is still a ` +
        `still one — and it is POLLED for up to ${String(CLEANUP_ADVANCE_BUDGET_MS)}ms, so a ` +
        `slow tick is not read as a dead process. Survivors: ${String(survivors.length)}, of ` +
        `which seen alive then stilled: ${String(stopped.length)} ` +
        `(${stopped.join(', ') || 'none'}).`,
    );
  }

  // -------------------------------------------------------------------------
  // NOTHING IN THIS REPOSITORY SPAWNS DETACHED (finding AAAA-6).
  //
  // The harness stops at a timeout, and its comment used to justify that by
  // orphaned grandchildren accumulating. Measured 2026-08-24, three runs of
  // each variant: an ordinary grandchild died with the harness 3 of 3, and a
  // `detached` one survived 3 of 3. So Windows already tears down the tree, and
  // the job-object work the FEATURES row still owed has no premise left — for
  // every spawn shape this repository actually uses.
  //
  // That last clause is the dependency, so it is a case rather than a sentence.
  // DERIVED from the tree deliberately: the failure to fear is somebody ADDING
  // a detached spawn, which makes the set BIGGER, and a derived count tracks
  // growth perfectly (item 4c). A hand-kept list would be the wrong instrument
  // here for exactly the reason it is the right one elsewhere.
  //
  // STATED LIMIT: the pattern sees a literal option KEY. Three things escape
  // it — a spread, an options object assembled somewhere else and passed in,
  // and A KEY ASSEMBLED FROM FRAGMENTS. The same textual reach ZZZ-2 has, in a
  // cheaper setting.
  //
  // The third one is not hypothetical: `DETACHED_KEY` at the top of this file
  // does exactly that, deliberately, so that the scanner is not itself a hit.
  // The limit was first written with only the first two clauses, every one of
  // them true, which is why nobody re-reads such a sentence (finding AAAA-36) —
  // and the escape it omitted was in the same file, 700 lines up. A reader
  // should learn the reach from the limit, not from a constant they happen to
  // meet later.
  //
  // Not closed, because the realistic way somebody adds a detached spawn is by
  // typing the option where the spawn is, and a scan that followed an object
  // through a call would be a second, worse implementation of the type checker
  // that already reads these files.
  // -------------------------------------------------------------------------
  {
    /** @param {string} dir @returns {string[]} */
    const sources = (dir) => {
      /** @type {string[]} */
      const found = [];
      /** @param {string} at */
      const walk = (at) => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const full = join(at, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(mjs|js|ts|tsx)$/u.test(entry.name)) found.push(full);
        }
      };
      try {
        walk(join(REPO, dir));
      } catch {
        // A root that is not there contributes nothing; the count assertion
        // below is what turns an empty total into a failure.
      }
      return found;
    };

    const files = [...sources('scripts'), ...sources('packages'), ...sources('apps')];
    const detached = files.filter((file) => /\bdetached\s*:/u.test(readFileSync(file, 'utf8')));

    const sample = `spawn(exe, [], { ${DETACHED_KEY}: true })`;
    check(
      'CONTROL: the scan reads a real file set and can match the thing it looks for',
      files.length > 50 && /\bdetached\s*:/u.test(sample),
      `An empty file list and a pattern that matches nothing both report "no detached spawns", ` +
        `which is the answer this case exists to trust. Files read: ${String(files.length)}.`,
    );
    check(
      'no spawn in this repository is detached, which is what makes the timeout kill a TREE',
      detached.length === 0,
      `Measured 2026-08-24: an ordinary grandchild dies with the harness 3 of 3, a detached one ` +
        `survives 3 of 3. So the harness's tree-kill is real and it is conditional on this. ` +
        `If you are adding a detached spawn deliberately, the FEATURES row's job-object work ` +
        `comes back with it. Found: ${detached.map((f) => f.slice(REPO.length + 1)).join(', ')}`,
    );
  }

  // -------------------------------------------------------------------------
  // A SPAWN THAT NEVER BECAME A PROCESS (finding AAAA-6).
  //
  // WWW-2's founding observation is 35 failures at 0.0s that each passed alone,
  // and AAAA-23 asked what those 35 printed. Nothing — and nothing could have,
  // because the harness read `status`, `signal`, `stdout` and `stderr` and
  // never `error`, which is the only field that says why no process appeared.
  //
  // The measurement that makes this more than a matching shape is in
  // `lib/spawnOutcome.mjs`: the cheapest successful node spawn on the machine
  // that produced the founding pass is 116ms at its FASTEST over 15 runs, and
  // `0.0s` means under 50ms. Nothing that started node can render as 0.0s
  // there.
  //
  // The load-bearing case is the branch ORDER. A timed-out spawn carries
  // `signal: 'SIGTERM'` AND `error: ETIMEDOUT` together, so a classifier that
  // tested `error` first would call every timeout a failure-to-spawn — and
  // that mistake is invisible in the field names, which is why it is a case.
  // -------------------------------------------------------------------------
  {
    const ran = classifySpawn({ status: 3, signal: null });
    check(
      'an ordinary non-zero exit is a script that RAN, and keeps its exit code',
      ran.kind === 'ran' && ran.exit === 3,
      `A check that says no must never be reported as a machine that could not start it. ` +
        `Got ${JSON.stringify(ran)}`,
    );
    check(
      'CONTROL: a clean exit is also "ran", so "ran" is not merely what non-zero prints',
      (() => {
        const clean = classifySpawn({ status: 0, signal: null });
        return clean.kind === 'ran' && clean.exit === 0;
      })(),
      'without this, a classifier returning "ran" for everything satisfies the case above.',
    );
    check(
      'a spawn that reported an error and no signal DID NOT START, and carries the errno',
      (() => {
        const failure = classifySpawn({
          status: null,
          signal: null,
          error: Object.assign(new Error('spawnSync node.exe ENOENT'), { code: 'ENOENT' }),
        });
        return failure.kind === 'didNotStart' && (failure.detail ?? '').includes('ENOENT');
      })(),
      'the errno is the whole point: 35 lines of "(no diagnostic line found)" is what the ' +
        'previous version could say, and it is indistinguishable from a guard refusing ' +
        'quietly.',
    );
    check(
      'a TIMED-OUT spawn is a timeout, even though it also carries an ETIMEDOUT error',
      (() => {
        const killed = classifySpawn({
          status: null,
          signal: 'SIGTERM',
          error: Object.assign(new Error('spawnSync node.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        });
        return killed.kind === 'timedOut';
      })(),
      `Measured 2026-08-24: spawnSync sets BOTH fields when it kills a child at the bound. ` +
        `Testing \`error\` first would reclassify every timeout as a failure to spawn — the ` +
        `sweep would still stop, so no case about stopping could see it, and the harness ` +
        `would print the wrong reason for the rest of this project's life.`,
    );
    check(
      'the summary counts scripts that never started, as their own state',
      (() => {
        const counted = runFixture({ 'ok.mjs': EXIT_ZERO }, { 'check:ok': 'node scripts/ok.mjs' });
        return counted.ok && /0 never started/u.test(counted.output);
      })(),
      `The classifier can be perfect and reach nobody. The counter appearing in the summary is ` +
        `the cheapest half of the wiring; the two cases below drive the branch itself.`,
    );

    // -----------------------------------------------------------------------
    // THE NON-START, INJECTED. This used to be recorded as unreachable from a
    // fixture, and it is not: a command line past Windows' 32767-character
    // limit makes CreateProcess fail before any process exists.
    //
    // Measured 2026-08-27, against a normal spawn at 112.4ms:
    //   nonexistent executable      status=null  ENOENT         1.5ms
    //   argument list past 32767    status=null  ENAMETOOLONG   2.5ms
    //
    // `status: null`, no output, single-digit milliseconds — WWW-2's founding
    // signature exactly. An over-long argument is the one reachable THROUGH the
    // harness, because it always spawns `process.execPath` and takes the
    // arguments from the manifest, so a fixture can supply them and an
    // executable name cannot.
    //
    // THE LENGTH CLEARS BOTH PLATFORMS' LIMITS, and the first version did not.
    // 40,000 characters exceeds Windows' 32767-character command line and
    // reddened nothing on Linux, where the ceiling is `MAX_ARG_STRLEN` — 32
    // pages, 131072 bytes, per single argument. Guards caught it and this
    // machine could not: the case passed here and failed there, which is
    // audit item 2's easy shape with the platforms swapped.
    //
    // The errno differs by platform for the same reason, so the assertion names
    // the CLASS rather than one code: `ENAMETOOLONG` here, `E2BIG` there.
    //
    // Both directions are asserted, in this case and the next. A harness that
    // called EVERYTHING a non-start would satisfy this one alone.
    // -----------------------------------------------------------------------
    {
      const past = 'x'.repeat(200000);
      const swept = runFixture(
        { 'ok.mjs': EXIT_ZERO, 'later.mjs': EXIT_ZERO },
        {
          // Declared first so something remains to be skipped. Everything here
          // is never-measured, which the harness runs in one bucket in the
          // order the manifest declares.
          'check:a-nostart': `node scripts/ok.mjs ${past}`,
          'check:b-later': 'node scripts/later.mjs',
          'check:c-later': 'node scripts/ok.mjs',
        },
        [],
      );

      check(
        'a spawn that never starts is reported as DID NOT START and carries its errno',
        /DID NOT START/u.test(swept.output) && /ENAMETOOLONG|E2BIG/u.test(swept.output),
        `output did not name the state or the cause. The errno is platform-specific — ` +
          `ENAMETOOLONG on win32, E2BIG on Linux — so both are accepted and the absence of ` +
          `either means no cause was carried at all:\n${swept.output.slice(0, 900)}`,
      );

      check(
        '  ...and is NOT counted as a failure, which is the whole distinction',
        /0 failed/u.test(swept.output) && /1 never started/u.test(swept.output),
        `the summary called it something else. A spawn that never became a process is not a ` +
          `check that said no — reading it as one is what produced 35 invented failures and ` +
          `cost this repository the multi-proof sweep:\n${swept.output.slice(0, 900)}`,
      );

      check(
        '  ...and the run STOPS there rather than measuring against the same machine',
        /never reached and are NOT passes/u.test(swept.output) &&
          /1 of 3 attempted/u.test(swept.output),
        `the sweep continued past a machine that had just refused to create a process. ` +
          `Everything after one is a result about that machine, not about the script:\n` +
          `${swept.output.slice(0, 900)}`,
      );
    }

    // -----------------------------------------------------------------------
    // THE OTHER DIRECTION. A genuine failure must still be a failure, still be
    // counted, and must NOT stop the sweep — otherwise the case above is
    // satisfied by a harness that treats every non-zero exit as a machine
    // fault, which is the same collapse wearing the opposite label.
    // -----------------------------------------------------------------------
    {
      const swept = runFixture(
        { 'bad.mjs': 'process.exit(1);\n', 'ok.mjs': EXIT_ZERO },
        { 'check:a-bad': 'node scripts/bad.mjs', 'check:b-ok': 'node scripts/ok.mjs' },
      );
      check(
        'CONTROL: a real failure is still a FAILURE, still counted, and does not stop the run',
        !swept.ok &&
          /1 failed/u.test(swept.output) &&
          /0 never started/u.test(swept.output) &&
          /2 of 2 attempted/u.test(swept.output),
        `a script that ran and exited 1 was misreported:\n${swept.output.slice(0, 900)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 20-21. WHAT THE CHECKS ACTUALLY READ (finding AAAA-7).
  //
  // Six checks in the real set read the INDEX, so a sweep run before `git add`
  // inspects the previous content and passes about a question nobody asked.
  // Measured: a `|` inside a FEATURES cell split a table row, `check:docs` was
  // run straight afterwards and printed nine passes, and Guards went red.
  //
  // Both directions, because "always warns" is as useless as "never warns" —
  // and the warning is the one that would get the harness ignored.
  // -------------------------------------------------------------------------
  {
    const root = mkdtempSync(join(scratch, 'staged '));
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const git = (/** @type {string[]} */ args) =>
      spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '--quiet']);
    git(['config', 'user.email', 'proof@example.invalid']);
    git(['config', 'user.name', 'proof']);
    writeFileSync(join(root, 'tracked.txt'), 'content\n', 'utf8');
    writeFileSync(join(root, 'scripts', 'ok.mjs'), EXIT_ZERO, 'utf8');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { 'check:ok': 'node scripts/ok.mjs' } }, null, 2),
      'utf8',
    );
    giveFixtureWorkflows(root, { 'check:ok': 'node scripts/ok.mjs' });
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'base']);

    const runHarness = () =>
      spawnSync(process.execPath, [HARNESS, '--root', root, '--floor', '1'], {
        encoding: 'utf8',
      });

    const clean = runHarness();
    check(
      'CONTROL: with the index matching the tree, the sweep says the checks saw your edits',
      /index matches the working tree/u.test(`${clean.stdout ?? ''}${clean.stderr ?? ''}`),
      `a warning that always fires is one people stop reading, and this is the case that ` +
        `catches it. Output:\n${clean.stdout ?? ''}${clean.stderr ?? ''}`,
    );

    // The edit is to a TRACKED file and is left unstaged — which is exactly the
    // state the FEATURES row was in when check:docs passed over it.
    writeFileSync(join(root, 'tracked.txt'), 'edited\n', 'utf8');
    const dirty = runHarness();
    const dirtyOutput = `${dirty.stdout ?? ''}${dirty.stderr ?? ''}`;
    check(
      'an unstaged change makes the sweep say the index-reading checks read the OLD content',
      /differ between your working tree and the index/u.test(dirtyOutput) &&
        /tracked\.txt/u.test(dirtyOutput) &&
        dirty.status === 0,
      `The exit code must stay 0: editing and sweeping before staging is ordinary work, and a ` +
        `harness that failed on it would be turned off. exit=${String(dirty.status)}. ` +
        `Output:\n${dirtyOutput}`,
    );
  }

  // -------------------------------------------------------------------------
  // 15-18. THE MULTI-PROOF SWEEP RUNS, AND A CHECK-ONLY SELECTION PICKS UP THE
  // SCANNING ROSTER (finding UUUU-1, replacing WWW-2's refusal).
  //
  // These five cases used to assert that a run selecting more than one proof
  // was REFUSED. The refusal is gone — see the block comment where it stood —
  // so what they assert is inverted, and the inversion needs the same two
  // directions the old ones had: a sweep runs, and a deliberate single-proof
  // run is not quietly widened.
  // -------------------------------------------------------------------------
  {
    const many = runFixture(
      { 'a.mjs': EXIT_ZERO, 'b.mjs': EXIT_ZERO, 'c.mjs': EXIT_ZERO },
      {
        'proof:a': 'node scripts/a.mjs',
        'proof:b': 'node scripts/b.mjs',
        'proof:c': 'node scripts/c.mjs',
      },
    );
    check(
      'a run selecting three proofs executes all three rather than refusing',
      many.ok && /3 of 3 attempted/u.test(many.output),
      `ok=${String(many.ok)}. This is the capability WWW-2's refusal cost, and it is what the ` +
        `non-start cases above pay for.\n${many.output.slice(0, 700)}`,
    );
  }
  {
    // `proof:kernelload` is a roster member; `proof:unrelated` is not. Both are
    // declared, and only one may be picked up.
    const roster = runFixture(
      { 'k.mjs': EXIT_ZERO, 'ok.mjs': EXIT_ZERO },
      {
        'check:ok': 'node scripts/ok.mjs',
        'proof:kernelload': 'node scripts/k.mjs',
        'proof:unrelated': 'node scripts/ok.mjs',
      },
      ['--only', 'check:'],
    );
    check(
      'a check-only selection also RUNS the scanning roster rather than printing it',
      /2 of 2 attempted/u.test(roster.output) && /proof:kernelload/u.test(roster.output),
      `the roster was not picked up. A sweep that selects only checks reaches no proof at all, ` +
        `and these are exactly the proofs no changed-file analysis can name for it — which is ` +
        `why the printed list reddened main three times.\n${roster.output.slice(0, 700)}`,
    );
    check(
      'CONTROL: it picks up the ROSTER, not every proof the manifest declares',
      !/proof:unrelated/u.test(roster.output),
      `a non-roster proof was swept in. Then the rule is "run everything", the check sweep ` +
        `costs what a full sweep costs, and the roster's whole point — that these nine are the ` +
        `ones an import walk structurally cannot see — has been thrown away.\n` +
        `${roster.output.slice(0, 700)}`,
    );
  }
  {
    const single = runFixture(
      { 'k.mjs': EXIT_ZERO, 'ok.mjs': EXIT_ZERO },
      { 'check:ok': 'node scripts/ok.mjs', 'proof:kernelload': 'node scripts/k.mjs' },
      ['--only', 'proof:kernelload'],
    );
    check(
      'CONTROL: a deliberate single-proof run stays one script',
      /1 of 1 attempted/u.test(single.output),
      `\`--only proof:x\` is someone asking for one thing. Widening it would make the roster ` +
        `unavoidable, and the first person who wanted one proof would stop using --only.\n` +
        `${single.output.slice(0, 700)}`,
    );
    check(
      'the roster this all turns on is the shared one, not a list spelled here',
      SCANNING_PROOFS.includes('proof:kernelload') && SCANNING_PROOFS.length >= 9,
      `SCANNING_PROOFS is ${JSON.stringify(SCANNING_PROOFS)}. The fixtures above name ` +
        `proof:kernelload as a roster member; if this file decided that for itself the cases ` +
        `would pass against a roster that no longer contains it.`,
    );
  }
  {
    // THE FIXTURE IS BUILT FROM WHAT THE BUG LETS THROUGH. An untracked file is
    // the one shape `git diff --name-only HEAD` cannot see, so a tracked edit
    // here would be reported correctly by the defect too and separate nothing.
    const fresh = runGitFixture(
      { 'a.mjs': EXIT_ZERO },
      { 'proof:a': 'node scripts/a.mjs' },
      { 'new.mjs': EXIT_ZERO },
      ['--only', 'proof:a'],
    );
    check(
      'a brand-new UNTRACKED file counts as a change the coverage report must account for',
      /1 file\(s\) changed against HEAD/u.test(fresh.output),
      `the report did not name the untracked file. \`git diff\` reports tracked modifications ` +
        `only, so adding a module — the ordinary shape of building a feature — contributed ` +
        `nothing and the run printed the sentence a CLEAN tree prints. That is item 4b in the ` +
        `INPUT to a search: the walk was working perfectly on the set it was handed.\n` +
        `${fresh.output.slice(-700)}`,
    );
    check(
      'and it does NOT claim the tree is unchanged',
      !/nothing is changed against HEAD/u.test(fresh.output),
      `both sentences cannot be true of one run, and this is the one the defect printed. ` +
        `Asserted separately from the case above because "names the file" and "stops claiming ` +
        `nothing changed" are two failures, and a report could regress into either.\n` +
        `${fresh.output.slice(-700)}`,
    );
  }
  {
    // THE CONTROL, and it is the one that matters: without it, an
    // implementation that reported "1 file changed" unconditionally would pass
    // the pair above. Same fixture, same command, nothing written after the
    // commit — so the only difference is the thing under test.
    const clean = runGitFixture(
      { 'a.mjs': EXIT_ZERO },
      { 'proof:a': 'node scripts/a.mjs' },
      {},
      ['--only', 'proof:a'],
    );
    check(
      'CONTROL: a genuinely clean repository still reports nothing changed',
      /nothing is changed against HEAD/u.test(clean.output),
      `a clean tree must still be able to say so. If this fails the report has stopped ` +
        `distinguishing "no change" from "a change", and the case above is satisfied by an ` +
        `instrument that always claims one.\n${clean.output.slice(-700)}`,
    );
  }
  {
    // A directory that is not a repository is a real state — every other
    // fixture in this file is one — and the question is genuinely unaskable
    // there. It must not arrive looking like an answer of "nothing".
    const bare = runFixture({ 'a.mjs': EXIT_ZERO }, { 'proof:a': 'node scripts/a.mjs' });
    check(
      'a root that is not a repository SAYS the question could not be asked',
      /could not ask git what this tree changed/u.test(bare.output),
      `the previous guard skipped the block silently on a non-zero git exit, which prints ` +
        `nothing — indistinguishable from the report not existing, and from a clean tree. ` +
        `"Could not look" is not "looked and found nothing".\n${bare.output.slice(-700)}`,
    );
  }
  {
    // THE VERDICT IS THE LAST LINE, in both directions.
    //
    // The file name is the authority and `| tail` discards the exit code, so a
    // piped run was read as green three times in one session by somebody who had
    // written the rule down twice. Printing the seal state last makes the common
    // wrong action produce the right answer — B5 applied to a habit — and that is
    // only true if it is genuinely last, which nothing but a case can say.
    //
    // TAKEN FROM THE TAIL, not searched for anywhere in the output: a `SEALED:`
    // line in the middle satisfies a `.includes` and satisfies nothing a reader
    // piping through `tail` needs.
    const lastLine = (/** @type {string} */ output) =>
      output.trimEnd().split(/\r?\n/).at(-1) ?? '';

    const passing = runFixture({ 'a.mjs': EXIT_ZERO }, { 'proof:a': 'node scripts/a.mjs' });
    check(
      'the SEAL STATE is the last line, so a piped run reads the truth',
      /^SEALED: ok \(\d+ passed\)$/u.test(lastLine(passing.output)),
      `the last line was "${lastLine(passing.output)}". Anything after it is what a reader ` +
        `piping through \`tail\` sees instead of the verdict.\n${passing.output.slice(-700)}`,
    );

    // THE CONTROL, and its direction is what makes it one. A harness that always
    // printed `SEALED: ok` satisfies the case above perfectly, and would be
    // exactly the green-check-that-verifies-nothing this line exists to reject.
    const failing = runFixture({ 'a.mjs': EXIT_ONE }, { 'proof:a': 'node scripts/a.mjs' });
    check(
      'CONTROL: a failing run seals as FAILED on that same last line, with a reason',
      /^SEALED: failed \(.+\)$/u.test(lastLine(failing.output)),
      `the last line was "${lastLine(failing.output)}". A seal line that says "ok" whatever ` +
        `happened is the display-only defect living inside the mechanism that reports ` +
        `it.\n${failing.output.slice(-700)}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} checkLocal case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('checkLocal case'),
);
// `process.exitCode`, NOT `process.exit()`. Measured: with `process.exit()` this
// file printed all eight case lines TWICE and the summary once — Node tears the
// process down with writes still in flight and the pending stdout buffer is
// re-emitted. Every case still ran exactly once, which is what makes it nasty:
// the roster counted eight while the output claimed sixteen, so the duplication
// is invisible to every assertion in the file and shows up only to a reader.
//
// This file spawns more child processes than its siblings, which is why it met
// the condition first rather than why it is special.
process.exitCode = failures.length === 0 ? 0 : 1;
