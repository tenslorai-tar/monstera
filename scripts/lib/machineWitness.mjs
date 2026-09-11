// @ts-check
/**
 * What the MACHINE was doing while something was timed.
 *
 * ## The finding this exists for
 *
 * `proof:guards` has nine readings of one command on one machine, and the three
 * this project calls **clean** span 137 s, 164.5 s, 165.36 s and 1093 s. Each
 * clean reading carries the same note — *nothing else was running* — and that
 * note is the defect: it means **nothing I started**. A developer's own processes
 * are the only ones a person thinks to account for, and they are a small part of
 * what a desktop is doing. An antivirus scanning a few hundred spawned children,
 * an indexer, an update service and a thermal cap are all *nothing else running*
 * by that definition, and a 6.6× spread is exactly the size they produce.
 *
 * Two readings were withdrawn on that phrase already: *it reproduces at 602 s*,
 * withdrawn when two fast readings arrived, and *the figure is 165 s*, withdrawn
 * when a slow one did. Both were right about their samples. Neither could say what
 * the other end of the spread was, because **no reading carried anything about the
 * machine**.
 *
 * So the remedy is not another reading. It is that every reading from now on says
 * what the machine was doing while it was taken — which turns *an unexplained
 * spread* into a spread that explains itself the next time it happens.
 *
 * ## What it measures, and what it cannot
 *
 * `os.cpus()` returns each core's cumulative time in user, nice, sys, idle and
 * irq **since boot, for the whole machine** — every process, not this one. The
 * difference across an interval is therefore *all the work the machine did*, and
 * dividing the non-idle part by the total gives the fraction of the machine that
 * was busy. A run whose own work is unchanged but whose busy fraction is far
 * higher had company.
 *
 * It cannot name the company: this is a scalar, not a process list. That is
 * deliberate — naming a process needs a platform-specific enumeration, and the
 * question a duration raises first is *was this machine loaded*, which one number
 * answers. It also cannot see thermal throttling, which shows up as the opposite
 * signature — a long run at a LOW busy fraction — and is worth knowing as the
 * shape rather than as a measurement this file could take.
 *
 * A fraction near 1 with a long duration is company. A fraction near the core
 * count's reciprocal is one busy core, which is what a single-threaded script
 * alone looks like.
 */

import { cpus } from 'node:os';

/**
 * @typedef {{ readonly busy: number, readonly idle: number, readonly cores: number }} CpuSample
 */

/**
 * Cumulative machine-wide CPU time, in milliseconds, split busy against idle.
 *
 * @returns {CpuSample}
 */
export function sampleCpu() {
  let busy = 0;
  let idle = 0;
  const cores = cpus();
  for (const core of cores) {
    const times = core.times;
    busy += times.user + times.nice + times.sys + times.irq;
    idle += times.idle;
  }
  return { busy, idle, cores: cores.length };
}

/**
 * The machine's busy fraction between two samples, and the wall time they span.
 *
 * **`null` rather than a number when the interval carries no CPU time at all.**
 * A zero-length interval divides by zero, and a `NaN` in a diagnostic field is
 * worse than an absence: it renders, it sorts, and nothing about reading it says
 * the instrument could not look. An absent value is the *could not look* this
 * project's register spells out everywhere else.
 *
 * @param {CpuSample} before
 * @param {CpuSample} after
 * @returns {number | null} 0 to 1, or `null` when nothing elapsed
 */
export function busyFraction(before, after) {
  const busy = after.busy - before.busy;
  const idle = after.idle - before.idle;
  const total = busy + idle;
  if (total <= 0) return null;
  return busy / total;
}

/**
 * Starts a witness. Call the returned function when the timed work is done.
 *
 * The shape is a closure rather than two exported calls because the pair must be
 * taken around the SAME interval, and a caller holding two samples can pass them
 * in either order — which reads as a negative busy fraction and would be reported
 * as one.
 *
 * @returns {() => { seconds: number, busy: number | null, cores: number }}
 */
export function witnessMachine() {
  const startedAt = process.hrtime.bigint();
  const before = sampleCpu();
  return () => {
    const after = sampleCpu();
    return {
      seconds: Number(process.hrtime.bigint() - startedAt) / 1e9,
      busy: busyFraction(before, after),
      cores: after.cores,
    };
  };
}

/**
 * One line a human reads, for a row that already carries the seconds.
 *
 * @param {{ busy: number | null, cores: number }} witness
 * @returns {string}
 */
export function describeMachine(witness) {
  if (witness.busy === null) return 'machine: not measurable over this interval';
  const percent = (witness.busy * 100).toFixed(0);
  const oneCore = 100 / witness.cores;
  // THE COMPARISON IS TO ONE CORE, because that is what a single-threaded script
  // running alone looks like on this machine — and a reader who does not know the
  // core count cannot tell 12% from loaded without it.
  const note =
    witness.busy * 100 <= oneCore * 1.5
      ? `about one core of ${String(witness.cores)}`
      : `${percent}% of ${String(witness.cores)} cores — this machine had company`;
  return `machine: ${percent}% busy (${note})`;
}
