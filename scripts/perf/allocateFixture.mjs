// @ts-check
/**
 * A measured process that allocates a requested number of megabytes and touches
 * every page. Exists so the instrument can be resolution-tested against a known
 * quantity before it is trusted with a real workload.
 *
 * Usage: node scripts/perf/allocateFixture.mjs <megabytes> [--block]
 */

import { reportPeak } from './peakRss.mjs';

const megabytes = Number(process.argv[2]);
if (!Number.isFinite(megabytes) || megabytes <= 0) {
  process.stderr.write('Usage: allocateFixture.mjs <megabytes> [--block]\n');
  process.exit(2);
}

// Touched page by page. An untouched Buffer.alloc is not necessarily resident,
// so an instrument validated against one would be validated against nothing.
const buffer = Buffer.alloc(megabytes * 1024 * 1024);
for (let offset = 0; offset < buffer.length; offset += 4096) buffer[offset] = 1;

if (process.argv.includes('--block')) {
  // Holds the event loop the way a synchronous FFI call does. A sampler-based
  // instrument goes blind here; a kernel-maintained peak does not.
  const until = Date.now() + 500;
  while (Date.now() < until) {
    /* spin */
  }
}

reportPeak({ requestedBytes: buffer.length, touched: buffer[0] });
