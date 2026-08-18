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

import { formatBytes, measurePeak } from '../perf/peakRss.mjs';

const PERF = join(dirname(fileURLToPath(import.meta.url)), '..', 'perf');
const ALLOCATE = join(PERF, 'allocateFixture.mjs');
const MB = 1024 ** 2;

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

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

if (failures.length > 0) {
  process.stderr.write(
    `\nPeak-RSS instrument proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThis instrument is not trusted with a real workload until these pass.\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} peak-RSS instrument cases passed.\n`);
