// @ts-check
/**
 * The control cell for `hostFixedCost.mjs`, and its resolution cell, in one
 * program at two settings.
 *
 * At `0` it is a bare runtime doing nothing — the same binary, in the same mode,
 * that the host runs in — which is what makes the host's reading a measurement
 * of the ENGINE rather than of Node. At any other value it allocates that many
 * megabytes and touches every page, which is what the parent uses to prove it
 * can separate two readings before it reports any real one.
 *
 * ## Why the allocation is written and not merely allocated
 *
 * `Buffer.allocUnsafe` reserves address space the OS need not back until it is
 * touched, and `WorkingSet64` counts backed pages. An untouched buffer would
 * read as nearly free — the instrument would report no difference and the
 * resolution test would fail for a reason that has nothing to do with the
 * instrument. `.fill()` makes the pages resident.
 *
 * Usage: <runtime> hostFixedCostChild.mjs <megabytes>
 *
 * Prints `ready` on stdout once it is settled, then idles until killed. The
 * parent kills it; nothing here exits on its own, because a child that exits
 * while the parent is reading its working set produces a missing reading rather
 * than a wrong one, and those are not the same finding.
 */

import { peakRssBytes } from '../perf/peakRss.mjs';

const megabytes = Number(process.argv[2] ?? '0');
if (!Number.isInteger(megabytes) || megabytes < 0) {
  process.stderr.write(`hostFixedCostChild: expected a non-negative integer, got ${process.argv[2]}\n`);
  process.exit(2);
}

/** Held in a module-scope binding so nothing collects it while the parent reads. */
const resident = megabytes === 0 ? null : Buffer.allocUnsafe(megabytes * 1024 * 1024).fill(0x5a);

// The self-reported peak is what lets the parent prove `PeakWorkingSet64` and
// `maxRSS` are one counter reached two ways, on every run rather than once in an
// argument. This cell is our own program and may report on itself; the HOST may
// not, which is the whole reason the parent-side spelling exists.
process.stdout.write(`ready ${resident === null ? 0 : resident.length} ${peakRssBytes()}\n`);

// Idle without spinning. An open handle keeps the loop alive and costs nothing
// measurable; a busy wait would put CPU pressure into a memory measurement, and
// an empty-bodied timer is a lint error rather than a way to wait.
process.stdin.resume();
