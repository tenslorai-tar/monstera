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
 */

import { createRoster } from './passRoster.mjs';
import { busyFraction, describeMachine, sampleCpu, witnessMachine } from './machineWitness.mjs';

/** @type {string[]} */
const failures = [];

/**
 * Six, a literal, measured by running this file.
 *
 * Not `CASES.length` (finding FFFFFF-2): deleting a case and its label together
 * shrinks a derived count and its roster agrees, where a literal cannot.
 */
const DECLARED_CASES = 6;

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

  const idleWitness = witnessMachine();
  await idle(INTERVAL_MS);
  const quiet = idleWitness();

  const busyWitness = witnessMachine();
  spin(INTERVAL_MS);
  const loaded = busyWitness();

  check(
    'THE RESOLUTION TEST: a spinning core reads busier than an idle interval of the same length',
    quiet.busy !== null && loaded.busy !== null && loaded.busy > quiet.busy,
    `idle=${JSON.stringify(quiet)} busy=${JSON.stringify(loaded)}. The two intervals are the ` +
      `same ${String(INTERVAL_MS)} ms and one of them had a core pinned. An instrument that ` +
      'cannot separate them would answer every question about a slow run with the same number.',
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
