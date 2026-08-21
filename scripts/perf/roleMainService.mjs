// @ts-check
/**
 * The `main` role again — but through the REAL `DocumentService`.
 *
 * ## Why this exists beside `roleMain.mjs` rather than replacing it
 *
 * `roleMain.mjs` is a **model** of main: read, hash, hold, report. Its figures
 * are arithmetic about bytes and they are sound as that — but ADR-0021 read them
 * as though the retention *implementation* had been measured, and it had not
 * (finding LL-4/JJ-1). A path that copied the buffer, held a second live
 * reference across a save, or stored a view of a larger allocation would breach
 * the budget and be invisible to a harness that never executes it.
 *
 * That is the harness axis this project paid for at BB-4 — *what does the
 * harness hand its child that the real caller does not* — and here the harness
 * did the retaining itself, so the real caller's version was exercised by
 * nothing.
 *
 * The model is kept. Its no-shim constraint is load-bearing and it is the
 * cheapest description of what main is *supposed* to cost; this one is what main
 * *does* cost. Two roles measured against one budget, and a divergence between
 * them is the finding.
 *
 * ## It was blocked until 2026-08-21, and by what
 *
 * Importing `DocumentService` used to load the native MuPDF binding — 38.1 MB,
 * through a type-only import that survived compilation — so a role built on it
 * could not have measured `main` without the parser in it, which is the one
 * thing main's budget exists to detect. `proof:kernelload` now holds that
 * closed, which is what makes this role possible at all.
 *
 * ## The real reader, deliberately
 *
 * `DocumentService` takes an injectable `BytesReader` and this passes none, so
 * the production `readFile` path is what runs. Injecting one would substitute
 * the exact step being measured — the same mistake in miniature as measuring a
 * model and reading it as the implementation.
 *
 * Usage: node scripts/perf/roleMainService.mjs <document-path>
 */

import { statSync } from 'node:fs';

// THE SPECIFIC MODULES, NOT THE BARREL. `packages/kernel/dist/index.js`
// re-exports the MuPDF adapter, and a re-export loads the module exactly as an
// import does — `proof:kernelload` establishes that the barrel reaches
// `mupdfWriter.js` and uses it as its known-present control. Importing it here
// would put the native parser in the process whose budget exists to detect
// exactly that, and the role would measure the thing it is meant to refuse.
import { CapabilityRegistry } from '../../packages/kernel/dist/capabilityRegistry.js';
import { DocumentService } from '../../packages/kernel/dist/documentService.js';

import { reportPeak } from './peakRss.mjs';

const documentPath = process.argv[2];
if (documentPath === undefined) {
  process.stderr.write('Usage: roleMainService.mjs <document-path>\n');
  process.exit(2);
}

const size = statSync(documentPath).size;

const capabilities = new CapabilityRegistry();
const documents = new DocumentService(capabilities, {
  // Generous on purpose: this role measures what holding a document COSTS, and a
  // ceiling that refused the open would measure a refusal.
  documentBytesCeiling: 8 * 1024 * 1024 * 1024,
});

const outcome = await documents.open(capabilities.mint(documentPath));
if (outcome.kind !== 'opened') {
  // A role that reported a peak for a document it never opened would report the
  // cost of an empty service and read as a pass. Refuse loudly instead.
  process.stderr.write(`roleMainService: expected 'opened', got '${outcome.kind}'\n`);
  process.exit(1);
}

// The service now holds the canonical image. Touched through its own accessor
// rather than through a private field, so what is measured is the number the
// ceiling is compared against — the same one `at-capacity` is computed from.
const resident = documents.residentDocumentBytes();
if (resident !== size) {
  process.stderr.write(
    `roleMainService: service holds ${String(resident)} bytes for a ${String(size)}-byte ` +
      `document. The peak below would be a measurement of the wrong quantity.\n`,
  );
  process.exit(1);
}

reportPeak({
  role: 'main-service',
  document: documentPath,
  documentBytes: size,
  docId: outcome.docId.slice(0, 8),
  residentBytes: resident,
});
