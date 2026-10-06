// @ts-check
/**
 * The machine witness, resolution-tested before it measures anything real.
 *
 * Audit item 4a, and this instrument is the reason the rule exists: it was
 * written to explain a 6.6× spread that four notes saying *nothing else was
 * running* could not. An instrument that cannot tell a busy machine from an idle
 * one would produce a fifth such note, in a field that looks like evidence.
 *
 * So the load-bearing case is the pair: the same interval length, once with a
 * core deliberately spinning and once without, and the busy fraction must be
 * **higher** for the busy one. Mutating `busyFraction` to return a constant
 * reddens it, which a case asserting only *a number came back* would not.
 *
 * ## That pair has a PRECONDITION, and it used to be unstated (2026-09-20)
 *
 * The comparison is machine-wide, so it can only separate the two intervals when
 * the quiet one left at least one core idle — `canSeeOneMoreCore` carries the
 * arithmetic. On a saturated machine the spin has nowhere to rise into, and this
 * file reported *the instrument is blind* for what was really *the machine could
 * not be looked at*: the two outputs this project keeps apart everywhere else.
 *
 * Measured, and the harness's own field is the witness: `npm run local` records a
 * `busy` fraction per script, and this proof exits 0 at `busy` 0.19 and 0.27 and
 * exits 1 at `busy` 1.00, on a 4-core machine whose company was a browser.
 *
 * **This is a REDUCTION where the machine is loaded and it is stated rather than
 * slipped in** (audit item 2a). On a saturated machine the pair no longer runs at
 * all; it records as *not applicable*, which the roster prints and the harness
 * tallies separately from a pass. The two controls below are what stop that
 * becoming a permanent skip — a predicate that always answered *no* would make
 * this file green for ever, which is the same defect one layer up.
 *
 * ## And a SECOND precondition: the machine's own load held still (2026-10-04)
 *
 * Headroom is not enough, because the comparison also assumes the machine's other
 * work was the same in both intervals. On windows-latest it fell by more than a
 * core between them (`ambientHeld`'s reading), and the pinned interval read
 * quieter than the idle one. So the pinned interval is bracketed by a quiet one
 * either side, a bracket that moved by half a core or more is taken again, at most
 * `BRACKETS` times, and five that all moved are reported as not looked at. The
 * comparison's own answer is never the reason for another bracket.
 */

import { createRoster } from './passRoster.mjs';
import {
  ambientHeld,
  busyFraction,
  canSeeOneMoreCore,
  describeMachine,
  idleCores,
  sampleCpu,
  witnessMachine,
} from './machineWitness.mjs';

/** @type {string[]} */
const failures = [];

/**
 * Ten, a literal, measured by running this file.
 *
 * Not `CASES.length` (finding FFFFFF-2): deleting a case and its label together
 * shrinks a derived count and its roster agrees, where a literal cannot.
 *
 * Six until 2026-09-20, when the resolution test's precondition gained the two
 * controls that keep it from skipping for ever; eight until 2026-10-04, when the
 * bracket's stability rule gained the same pair.
 */
const DECLARED_CASES = 10;

const roster = createRoster(failures, { cases: DECLARED_CASES });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * Burns one core for `ms`, which is what "busy" has to mean to be measurable.
 *
 * @param {number} ms
 */
function spin(ms) {
  const until = Date.now() + ms;
  let n = 0;
  while (Date.now() < until) n += 1;
  return n;
}

/**
 * Sleeps without burning anything.
 *
 * @param {number} ms
 */
function idle(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const INTERVAL_MS = 400;

/**
 * How many brackets are taken before the pair is reported as not looked at. A DECISION: each costs 1.2 s, and a runner
 * whose own load moves by half a core in five consecutive brackets is one this case cannot resolve a core on.
 */
const BRACKETS = 5;

/** A pinned interval with a quiet one either side, all three the same length. */
async function bracket() {
  const beforeWitness = witnessMachine();
  await idle(INTERVAL_MS);
  const before = beforeWitness();
  const loadedWitness = witnessMachine();
  spin(INTERVAL_MS);
  const loaded = loadedWitness();
  const afterWitness = witnessMachine();
  await idle(INTERVAL_MS);
  const after = afterWitness();
  return { before, loaded, after };
}

try {
  process.stdout.write('# The machine witness\n\n');

  // POSITIVE CONTROL FIRST (item 4b): an instrument that reads zeros from the OS
  // reports an idle machine for ever, and "idle" is the reassuring answer for a
  // duration nobody wants to explain.
  const sample = sampleCpu();
  check(
    'the OS reports a machine that has done work and has cores',
    sample.cores > 0 && sample.busy > 0 && sample.idle > 0,
    `cores=${String(sample.cores)} busy=${String(sample.busy)} idle=${String(sample.idle)}. ` +
      'These are cumulative since boot, so a zero in any of them is a read that failed rather ' +
      'than a machine that has been idle since it started.',
  );

  // TAKEN AGAIN ONLY WHILE THE MACHINE'S OWN LOAD MOVED, never because the comparison said no: a bracket either
  // held still and answers, or it did not and has not looked (`ambientHeld`).
  let taken = await bracket();
  let brackets = 1;
  while (!ambientHeld(taken.before, taken.after) && brackets < BRACKETS) {
    taken = await bracket();
    brackets += 1;
  }
  const { before: quiet, loaded, after } = taken;

  // THE PRECONDITION IS CHECKED AGAINST THE QUIET INTERVAL, which is the one that
  // has to hold the headroom. Checking the loaded one instead would ask whether the
  // spin had already happened, which is the question this case exists to answer.
  const RESOLUTION =
    'THE RESOLUTION TEST: a spinning core reads busier than an idle interval of the same length';
  if (!ambientHeld(quiet, after)) {
    // NOT A PASS, for the saturated branch's reason below: the machine's own load moved by half a core or more
    // across every bracket, so no comparison here could have separated one more core from it.
    process.stdout.write(
      `  the machine's own load moved by half a core or more across all ${String(brackets)} brackets (last: ` +
        `before=${JSON.stringify(quiet.busy)} after=${JSON.stringify(after.busy)} of ${String(quiet.cores)} cores), so ` +
        'the comparison is not attempted rather than answered.\n',
    );
    roster.record(roster.mark(), RESOLUTION, false);
  } else if (canSeeOneMoreCore(quiet) && canSeeOneMoreCore(after)) {
    check(
      RESOLUTION,
      quiet.busy !== null &&
        after.busy !== null &&
        loaded.busy !== null &&
        loaded.busy > Math.max(quiet.busy, after.busy),
      `before=${JSON.stringify(quiet)} pinned=${JSON.stringify(loaded)} after=${JSON.stringify(after)}, bracket ` +
        `${String(brackets)}. The three intervals are the same ${String(INTERVAL_MS)} ms, the middle one had a core ` +
        "pinned and the machine's own load held within half a core across them. An instrument that cannot separate " +
        'them would answer every question about a slow run with the same number.',
    );
  } else {
    // NOT A PASS. The roster prints this as *nothing to check* and the harness
    // tallies it apart from the passes, so a run that could not look reads as one.
    process.stdout.write(
      `  the quiet interval left ${JSON.stringify(idleCores(quiet))} of ` +
        `${String(quiet.cores)} cores idle, so a pinned core could not have raised the ` +
        'fraction. The comparison is not attempted rather than answered.\n',
    );
    roster.record(roster.mark(), RESOLUTION, false);
  }

  // THE PRECONDITION'S OWN PAIR, on CONSTRUCTED readings rather than by waiting for
  // a machine in either state — item 4b, and the only way the loaded side is
  // reachable on a quiet machine at all.
  check(
    'a saturated interval is reported as one a pinned core could not show in',
    !canSeeOneMoreCore({ busy: 1, cores: 4 }) && !canSeeOneMoreCore({ busy: 0.9, cores: 4 }),
    `busy=1 → ${String(canSeeOneMoreCore({ busy: 1, cores: 4 }))}, busy=0.9 of 4 cores → ` +
      `${String(canSeeOneMoreCore({ busy: 0.9, cores: 4 }))}. 0.9 of four cores leaves 0.4 of a ` +
      'core, and one more busy core cannot fit in it.',
  );

  // THE CONTROL, and it is the load-bearing half: without it a predicate that
  // always answered *no* would skip the resolution test on every machine for ever
  // and this file would be green having measured nothing.
  check(
    'CONTROL: an interval with a core to spare is NOT reported as unseeable',
    canSeeOneMoreCore({ busy: 0.2, cores: 4 }) && canSeeOneMoreCore({ busy: 0.75, cores: 4 }),
    `busy=0.2 → ${String(canSeeOneMoreCore({ busy: 0.2, cores: 4 }))}, busy=0.75 of 4 cores → ` +
      `${String(canSeeOneMoreCore({ busy: 0.75, cores: 4 }))}. 0.75 leaves exactly one core, ` +
      'which is the boundary the arithmetic gives and not a number chosen to pass.',
  );

  // THE BRACKET'S OWN PAIR, constructed for the same reason as the headroom's: a machine whose load moves on cue is
  // not one a case can wait for. The first reading is the run that found it.
  check(
    "a bracket whose quiet ends differ by a core is reported as one that could not resolve a core",
    !ambientHeld({ busy: 0.276, cores: 4 }, { busy: 0.01, cores: 4 }) &&
      !ambientHeld({ busy: 0.2, cores: 4 }, { busy: 0.325, cores: 4 }),
    `0.276 then 0.01 of 4 cores → ${String(ambientHeld({ busy: 0.276, cores: 4 }, { busy: 0.01, cores: 4 }))}, 0.2 ` +
      `then 0.325 → ${String(ambientHeld({ busy: 0.2, cores: 4 }, { busy: 0.325, cores: 4 }))}. Half a core of 4 is ` +
      '0.125, and both move by at least that.',
  );

  // THE CONTROL, load-bearing for the same reason: a rule that never held would skip the resolution test for ever.
  check(
    "CONTROL: a bracket whose quiet ends agree within half a core is one that can resolve a core",
    ambientHeld({ busy: 0.2, cores: 4 }, { busy: 0.3, cores: 4 }) &&
      ambientHeld({ busy: 0.05, cores: 8 }, { busy: 0.05, cores: 8 }),
    `0.2 then 0.3 of 4 cores → ${String(ambientHeld({ busy: 0.2, cores: 4 }, { busy: 0.3, cores: 4 }))}, an ` +
      `unmoved 8-core machine → ${String(ambientHeld({ busy: 0.05, cores: 8 }, { busy: 0.05, cores: 8 }))}.`,
  );

  check(
    'and both intervals are reported at all, rather than as could-not-look',
    quiet.busy !== null && loaded.busy !== null,
    `idle=${JSON.stringify(quiet.busy)} busy=${JSON.stringify(loaded.busy)}. A null here is the ` +
      'absent-value path, which is correct only for an interval carrying no CPU time at all.',
  );

  // THE COULD-NOT-LOOK PATH, on a constructed pair rather than by waiting for one.
  const still = { busy: 10, idle: 20, cores: 4 };
  check(
    'an interval carrying no CPU time answers null rather than NaN',
    busyFraction(still, still) === null,
    `it answered ${String(busyFraction(still, still))}. A NaN renders, sorts and reads as a ` +
      'measurement; an absent value is the could-not-look this project spells out everywhere else.',
  );

  // THE GAP, RECORDED AS A PASSING CASE rather than left in prose, and it is not
  // the gap this case first claimed. It asserted that a reversed pair reports a
  // NEGATIVE fraction; it reports `null`, because the same `total <= 0` guard that
  // catches an empty interval catches a reversed one — the roster caught the wrong
  // claim before the file ever ran green. That is better behaviour than the case
  // demanded and it is written as what it is: reversing degrades to *could not
  // look*, never to a plausible reading, and `witnessMachine` still takes the pair
  // itself so the question does not arise at a call site.
  check(
    'samples in the wrong order answer null — could-not-look, never a plausible reading',
    busyFraction({ busy: 20, idle: 40, cores: 4 }, { busy: 10, idle: 20, cores: 4 }) === null,
    'a reversed pair answered a number, so nothing distinguishes it from a real reading and a ' +
      'caller that held the samples itself could report one.',
  );

  check(
    'the description separates one core from a loaded machine',
    describeMachine({ busy: 0.1, cores: 8 }).includes('about one core') &&
      describeMachine({ busy: 0.9, cores: 8 }).includes('company'),
    `one core → ${JSON.stringify(describeMachine({ busy: 0.1, cores: 8 }))}, loaded → ` +
      `${JSON.stringify(describeMachine({ busy: 0.9, cores: 8 }))}. A description that reads the ` +
      'same either way puts the reader back where the note *nothing else was running* left them.',
  );

  process.stdout.write(`\n${roster.format('machine-witness case')}`);
  if (failures.length > 0) {
    process.stdout.write(`\nMachine witness — ${String(failures.length)} failure(s):\n\n`);
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
    process.exit(1);
  }
} catch (error) {
  // THE FAILURES GO OUT WITH THE THROW. `format` throws on a case-count mismatch,
  // and a failing case is never recorded — so the roster's complaint arrives
  // instead of the finding, and the run says *a case stopped running* about a case
  // that ran and said no. Printing both is what stops the harness hiding its own
  // subject.
  process.stdout.write(`\nMachine witness — threw: ${String(error)}\n`);
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  process.exit(1);
}
