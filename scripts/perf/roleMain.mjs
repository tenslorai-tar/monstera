// @ts-check
/**
 * The `main` role, measured: the process that owns the document's canonical
 * bytes and never parses them.
 *
 * That is the whole argument behind main's budget, and it is why the budget is
 * tight rather than generous. Main holds the bytes, hashes them for identity,
 * and hands work to the host. It does not open a document, so its peak should
 * sit a little above one copy of the file — and a figure meaningfully above that
 * means parsing crept back in, which is the regression the number exists to
 * catch.
 *
 * The absence here is load-bearing: this script must not load the shim, and must
 * not import anything that does. If a future version needs to, the budget is
 * wrong or the boundary is.
 *
 * Usage: node scripts/perf/roleMain.mjs <document-path>
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

import { reportPeak } from './peakRss.mjs';

const documentPath = process.argv[2];
if (documentPath === undefined) {
  process.stderr.write('Usage: roleMain.mjs <document-path>\n');
  process.exit(2);
}

const size = statSync(documentPath).size;

// One copy, read whole. This is what "main owns the document" means: the
// canonical bytes live here and the renderer never sees them.
const canonical = readFileSync(documentPath);

// Identity is a hash of the bytes, not a parse of them. Hashing streams through
// the buffer already held and allocates nothing proportional to it.
const identity = createHash('sha256').update(canonical).digest('hex');

// Holds the bytes across a save-shaped operation the way main does: the bytes
// stay resident while something else works. Touched so nothing is optimised out
// and the pages stay resident.
let checksum = 0;
for (let offset = 0; offset < canonical.length; offset += 1024 * 1024) {
  checksum = (checksum + (canonical[offset] ?? 0)) & 0xff;
}

reportPeak({
  role: 'main',
  document: documentPath,
  documentBytes: size,
  identity: identity.slice(0, 16),
  checksum,
});
