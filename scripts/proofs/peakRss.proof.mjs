// @ts-check
/**
 * Resolution test for the peak-RSS instrument, before it measures anything real
 * (rule B2, stage-audit item 4a).
 *
 * This project has had four instruments produce confidently wrong numbers, and
 * all four would have died at this step: feed it two values you know differ by
 * the smallest amount that would change a decision, and confirm it reports them
 * as different. A blind instrument and a vacuous proof are the same failure in
 * different clothes.
 *
 * The specific predecessor here is the `setInterval` peak sampler that could not
 * fire while a synchronous FFI loop held the event loop and reported 63 MB for a
 * walk that cost 526 MB — reproducibly, which is what made it convincing. So the
 * blocked-loop case below is not a nicety; it is the exact failure mode being
 * ruled out.
 *
 * Usage: node scripts/proofs/peakRss.proof.mjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatBytes, measurePeak, reportPeakOf } from '../perf/peakRss.mjs';

const PERF = join(dirname(fileURLToPath(import.meta.url)), '..', 'perf');
const ALLOCATE = join(PERF, 'allocateFixture.mjs');
const MB = 1024 ** 2;

/**
 * A pid no process can have.
 *
 * Windows pids are multiples of four and this is not one, so it cannot collide
 * with a live process the way a large number eventually can — which matters
 * because the case using it would then measure a real process and pass for the
 * wrong reason.
 */
const GONE_PID = 999_999_999;

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];
/**
 * Cases this platform cannot run, named.
 *
 * Three states rather than two, for the reason `checkLocal.mjs` reports three:
 * a case that did not run has not passed, and printing only `ok` lines would
 * make a proof that skipped half of itself look identical to one that did not.
 */
const skipped = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// Resolution: two allocations differing by a known amount must differ by about
// that amount.
// ---------------------------------------------------------------------------
const small = measurePeak(ALLOCATE, ['50']);
const large = measurePeak(ALLOCATE, ['300']);

check(
  'a 50 MB run and a 300 MB run are distinguishable',
  large.peakRssBytes > small.peakRssBytes,
  `50 MB run: ${formatBytes(small.peakRssBytes)}, 300 MB run: ${formatBytes(large.peakRssBytes)}`,
);

{
  // The difference is the load-bearing number: an instrument reporting a
  // plausible-looking absolute figure for both, differing by noise, would pass
  // the comparison above and still be useless.
  const observed = large.peakRssBytes - small.peakRssBytes;
  const expected = 250 * MB;
  const ratio = observed / expected;
  check(
    'and the difference matches the 250 MB actually allocated',
    ratio > 0.9 && ratio < 1.15,
    `expected ~${formatBytes(expected)}, observed ${formatBytes(observed)} (${ratio.toFixed(2)}x). ` +
      `A difference far from 1.0 means the reading is not tracking allocation — most likely a ` +
      `kilobyte/byte confusion, which reads as three orders of magnitude of headroom.`,
  );
}

// ---------------------------------------------------------------------------
// The failure that killed the predecessor: a blocked event loop.
// ---------------------------------------------------------------------------
{
  const blocked = measurePeak(ALLOCATE, ['300', '--block']);
  const drift = Math.abs(blocked.peakRssBytes - large.peakRssBytes) / large.peakRssBytes;
  check(
    'holding the event loop for 500 ms does not hide the allocation',
    drift < 0.1,
    `unblocked ${formatBytes(large.peakRssBytes)}, blocked ${formatBytes(blocked.peakRssBytes)} ` +
      `(${(drift * 100).toFixed(1)}% apart). A sampler-based instrument reports a fraction here; ` +
      `that is how 526 MB was once reported as 63 MB.`,
  );
}

// ---------------------------------------------------------------------------
// Absolute sanity: the figure is in the right unit.
// ---------------------------------------------------------------------------
check(
  'a 300 MB allocation reports at least 300 MB and less than 2 GB',
  large.peakRssBytes >= 300 * MB && large.peakRssBytes < 2048 * MB,
  `got ${formatBytes(large.peakRssBytes)}. Below 300 MB means the allocation was not counted; a ` +
    `wild figure means kilobytes were read as bytes or vice versa.`,
);

// ---------------------------------------------------------------------------
// A missing measurement is a failure, never a zero.
// ---------------------------------------------------------------------------
{
  const silent = join(PERF, '__silent_probe__.mjs');
  const { writeFileSync, rmSync } = await import('node:fs');
  try {
    writeFileSync(silent, "process.stdout.write('did some work\\n');\n", 'utf8');
    let threw = false;
    let message = '';
    try {
      measurePeak(silent, []);
    } catch (error) {
      threw = true;
      message = error instanceof Error ? error.message : String(error);
    }
    check(
      'a script that reports no peak fails rather than measuring zero',
      threw && /no measurement/iu.test(message),
      `A zero would pass every budget silently. Got: ${message.slice(0, 200)}`,
    );
  } finally {
    rmSync(silent, { force: true });
  }
}

// ---------------------------------------------------------------------------
// THE RUNTIME OPTION IS HONOURED — a harness fix asserted at the harness.
//
// `runtime` was added because ADR-0025 added a figure measured under system
// node to a floor measured under the pinned Electron binary (SSSS-2). The
// repair is one `??`, and every assertion in this file reads a peak the default
// runtime produces perfectly well — so with the option deleted the whole file
// still passes, which is the shape a harness fix always has: it changes an
// INPUT, and assertions look at outputs.
//
// The case therefore asserts what `measurePeak` PASSES, and it does so without
// needing a second working interpreter — a case keyed on the Electron binary
// would be UNVERIFIABLE on any runner that installs nothing, which is a branch
// keyed on provisioning and the richer world is the one that hides the defect.
// A runtime that cannot exist separates the two states with nothing installed:
// honoured, the spawn fails and the message names the path; ignored, the
// measurement succeeds.
// ---------------------------------------------------------------------------
{
  const absent = join(PERF, '__no_such_runtime__.exe');
  let threw = false;
  let message = '';
  try {
    measurePeak(ALLOCATE, ['10'], { runtime: absent });
  } catch (error) {
    threw = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    'measurePeak spawns the runtime it was given rather than this process',
    threw && message.includes(absent),
    threw
      ? `It failed, but the message does not name the runtime it tried, so this case cannot ` +
        `tell "used the option" from "failed for another reason": ${message.slice(0, 300)}`
      : `It SUCCEEDED with a runtime that does not exist, which means the option was ignored ` +
        `and every caller silently gets this process's interpreter.`,
  );

  // VACUITY GUARD. The case above proves nothing if the fixture would fail
  // anyway — the negative-probe rule: build the input from something that
  // WOULD succeed if the guard were absent.
  const control = measurePeak(ALLOCATE, ['10']);
  check(
    'the same call with no runtime option succeeds, so the refusal above is the option',
    control.peakRssBytes > 0,
    `The default-runtime control failed too, so the case above is impossibility rather than ` +
      `refusal and separates nothing.`,
  );
}

// ---------------------------------------------------------------------------
// `reportPeakOf` — the seam a role uses when its SUBJECT is another process.
// ---------------------------------------------------------------------------
// WINDOWS ONLY, AND SKIPPED RATHER THAN QUIETLY ABSENT.
//
// `peakWorkingSetOf` is `Get-Process` and throws on every other platform by
// design. On Linux BOTH calls below throw, so the refusal case passes for the
// wrong reason and the control fails — which is exactly what happened: this
// proof reddened `main` on ubuntu the first time it ran (finding YYYY-2). The
// control did its job on the platform where the pair stops separating anything.
//
// Reported as skipped rather than omitted, because *could not look* and *looked
// and found nothing* are the distinction this repository draws everywhere else,
// and a case that silently does not exist on a platform is the second one
// wearing the first one's clothes.
if (process.platform !== 'win32') {
  skipped.push(
    `reportPeakOf's two cases need Win32: peakWorkingSetOf is Get-Process and throws ` +
      `elsewhere, so refusal and impossibility are the same observation here`,
  );
} else {
  // A pid that cannot exist. `peakWorkingSetOf` answers `null` for a process
  // that is gone, and the whole point of this function is that it REFUSES that
  // rather than reporting it: a host that died early and a host that cost
  // little are the same missing number otherwise, and the second passes every
  // budget. Fourth entry in CLAUDE.md's list of blind instruments, in the one
  // place a role's figure comes from something it did not measure itself.
  let refused = false;
  try {
    reportPeakOf(GONE_PID, {});
  } catch {
    refused = true;
  }
  check(
    'reporting the peak of a process that is gone is REFUSED, not reported as a small number',
    refused,
    `reportPeakOf(${String(GONE_PID)}) returned instead of throwing. A role that reported that ` +
      `would hand a budget check a figure nobody measured.`,
  );

  // VACUITY GUARD, and it is the negative-probe rule rather than a formality:
  // the case above is worthless if the call would fail for ANY pid. This
  // process exists, so a build with the refusal deleted still passes here and
  // only the case above separates the two.
  //
  // It emits a real `__MONSTERA_PEAK__` line onto this proof's stdout, because
  // emitting one is what the function does and asserting anything less would be
  // asserting around the behaviour. Nothing reads this proof through
  // `measurePeak`, so the line is inert — said here because a stray marker in
  // an output is otherwise exactly the thing somebody later mistakes for a
  // measurement.
  let reportedForALivePid = false;
  try {
    reportPeakOf(process.pid, { control: true });
    reportedForALivePid = true;
  } catch {
    // Left false. A throw here means the control itself failed, which is what
    // the case below reports — re-assigning false would be the same value
    // written twice and says nothing the initialiser did not.
  }
  check(
    'the same call for a LIVE pid reports, so the refusal above is about the process being gone',
    reportedForALivePid,
    `reportPeakOf refused this process's own pid, so the case above is impossibility rather ` +
      `than a refusal and separates nothing.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nPeak-RSS instrument proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThis instrument is not trusted with a real workload until these pass.\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
for (const reason of skipped) process.stdout.write(`  --  SKIPPED: ${reason}\n`);
process.stdout.write(
  `\n${passed.length} peak-RSS instrument cases passed` +
    (skipped.length > 0 ? `, ${skipped.length} skipped on ${process.platform}` : '') +
    `.\n`,
);
