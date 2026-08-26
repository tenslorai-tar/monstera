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
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

// THE SNAPSHOT WRITE, INSIDE THE MEASURED WINDOW (ADR-0023 Decision 7, and the
// `perf:gate` coverage row that named this as its trigger).
//
// Decision 7's third supporting argument is that *"re-transmitting hundreds of
// megabytes from a main process already near its ceiling is the worst possible
// moment to do the most expensive thing"*, and until a snapshot write existed
// the gate reported green while blind to exactly that operation — audit item
// 4's *branch nothing arrives at*, sitting inside an instrument a decision
// leans on.
//
// This is the same call `SessionAreaSurface.writeSnapshot` makes: the canonical
// bytes already held, handed to the filesystem. The question it answers is
// whether that hand-off adds a resident copy — `writeFileSync` writing from an
// existing buffer should not, and *should not* is what a gate is for.
//
// The bytes are still referenced afterwards, deliberately: releasing them first
// would measure a write by a process that no longer holds the document, which
// is the opposite of the moment the argument is about.
const snapshot = join(mkdtempSync(join(tmpdir(), 'monstera-role-main-')), 'image');
writeFileSync(snapshot, canonical);
const wrote = statSync(snapshot).size;
rmSync(dirname(snapshot), { recursive: true, force: true });
if (wrote !== size) {
  // A short write would make the peak below a measurement of writing something
  // smaller than the document, which is the number this role exists to compare
  // against the document.
  process.stderr.write(
    `roleMain: wrote ${String(wrote)} bytes for a ${String(size)}-byte document.\n`,
  );
  process.exit(1);
}

reportPeak({
  role: 'main',
  document: documentPath,
  documentBytes: size,
  identity: identity.slice(0, 16),
  checksum,
  snapshotBytes: wrote,
  // Touched after the write so the buffer cannot have been collected during it.
  stillHeld: canonical.length,
});
