// @ts-check
/**
 * The `main` role through a BYTE-IMAGE command: what `main` holds at its peak, and afterwards, while a command
 * routed to a byte-image writer runs (the owner's list of 28 September, item 4 — *"the two-image peak"*).
 *
 * ## Why this exists beside `roleMainService.mjs`
 *
 * `roleMainService.mjs` measures `main` opening a document and writing its snapshot: **1.00×**, one image. The
 * `DocumentService holds the canonical bytes` row notes `perf:gate` reading **2.00×** for a `main` holding two, and
 * that is exactly what a byte-image command does by construction — `ByteImageAccess.current` brings the document's
 * bytes back from the engine, the writer's `apply` returns a whole new image, and the canonical image is still held
 * until `replaceCanonicalImage`. A terminal entry keeps a `Checkpoint`, which is a whole image, for undo. Nobody had
 * measured it.
 *
 * ## What is real and what stands in
 *
 * REAL: `DocumentService` with the production reader, `CommandBus`, and the shipped local pdf-lib writer
 * (`localPdfLibWriter`, which runs in `main`). STANDING IN: the engine host. `current` is its serialise, and here it
 * is the canonical image written out and read back — a fresh buffer of the document's size, which is what the host's
 * answer is when it reaches `main`. `adopt` writes the new image where the host would reopen it and does no more.
 *
 * Usage: node scripts/perf/roleMainByteImage.mjs <document-path>
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROLE_MAIN_SERVICE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { peakRssBytes, reportPeak } from './peakRss.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
refuseStaleBuild(REPO_ROOT, ROLE_MAIN_SERVICE, 2);

// THE SPECIFIC MODULES, not the kernel's barrel, and dynamically, for `roleMainService.mjs`' two reasons: the barrel
// loads the MuPDF adapter into the process being measured, and a static import would run before the freshness check.
const { CapabilityRegistry } = await import('../../packages/kernel/dist/capabilityRegistry.js');
const { DocumentService } = await import('../../packages/kernel/dist/documentService.js');
const { CommandBus } = await import('../../packages/kernel/dist/commandBus.js');
const { localPdfLibWriter } = await import('../../packages/kernel/dist/pdfLibWriter.js');
const { SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS } = await import('../../apps/desktop/dist/engineSessions.js');

const documentPath = process.argv[2];
if (documentPath === undefined) {
  process.stderr.write('Usage: roleMainByteImage.mjs <document-path>\n');
  process.exit(2);
}
const size = statSync(documentPath).size;

// THE BASELINE: the process with its modules loaded and no document, read as the peak so far.
const baseline = peakRssBytes();

const scratch = mkdtempSync(join(tmpdir(), 'monstera-role-byte-image-'));
const capabilities = new CapabilityRegistry();
const documents = new DocumentService(capabilities, {
  documentBytesCeiling: 8 * 1024 * 1024 * 1024,
  checkpointDirectory: join(scratch, 'checkpoints'),
});
const outcome = await documents.open(capabilities.mint(documentPath));
if (outcome.kind !== 'opened') {
  process.stderr.write(`roleMainByteImage: expected 'opened', got '${outcome.kind}'\n`);
  process.exit(1);
}
const afterOpen = peakRssBytes();

let serialised = 0;
/** @type {import('../../packages/kernel/dist/commandBus.js').CommandInputs} */
const inputs = {
  // THE HOST'S SERIALISE, standing in: the canonical image out to disk and a fresh buffer back.
  current: async () => {
    const path = join(scratch, `current-${String((serialised += 1))}`);
    await documents.writeCanonicalImage(SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS, outcome.docId, path);
    // THE READ'S OWN BUFFER, not a copy of it: a copy would charge this stand-in a second image the host's answer
    // never costs.
    const read = await readFile(path);
    return new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
  },
  // THE HOST'S SERIALISE MOVED INTO PLACE, standing in: the canonical image written straight to the destination, so
  // nothing of it passes through this process's buffers — what `serialiseInto` does with a host's output.
  currentInto: (destination) =>
    documents.writeCanonicalImage(SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS, outcome.docId, destination),
  adopt: async (write) => {
    await write(join(scratch, 'adopted'));
  },
  outline: () => Promise.reject(new Error('the watermark reads no outline')),
  ocr: () => Promise.reject(new Error('the watermark recognises nothing')),
  sources: new Map(),
};

// WHERE THE PEAK IS SPENT: `main`'s ArrayBuffer memory at each step the bus takes, after a collection when the
// process was started with `--expose-gc`, so a step is charged what it RETAINS rather than garbage not yet swept.
/** @type {Record<string, number>} */
const steps = {};
/** @param {string} name */
const mark = async (name) => {
  // TWICE, WITH A TURN BETWEEN: a large backing store is released after the collection that frees it, and reading
  // straight after one collection counted an image nothing held (measured 2026-09-29 — 3.00 where the service held 2).
  const gc = /** @type {{ gc?: () => void }} */ (globalThis).gc;
  gc?.();
  await new Promise((settle) => setTimeout(settle, 50));
  gc?.();
  steps[name] = Number((process.memoryUsage().arrayBuffers / size).toFixed(2));
};
await mark('open');

/**
 * The most ArrayBuffer memory seen while `work` runs, sampled every 2 ms — for a step whose peak is the question, where
 * `mark` reads only what is left afterwards. A sampler cannot fire during synchronous work, so its CONTROL is the
 * second command, whose known moment of three images (the canonical, the serialised session, the applied result) it
 * must see: a blind sampler would read about one.
 *
 * @param {() => Promise<unknown>} work
 */
const sampledPeak = async (work) => {
  let peak = process.memoryUsage().arrayBuffers;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
  }, 2);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  return Math.max(peak, process.memoryUsage().arrayBuffers);
};

const writer = {
  ...localPdfLibWriter,
  /** @param {Parameters<typeof localPdfLibWriter.capture>} args */
  capture: async (...args) => {
    await mark('session (the serialise)');
    return localPdfLibWriter.capture(...args);
  },
  /**
   * @template {import('../../packages/kernel/dist/commandRouting.js').KindsRoutedTo<'pdf-lib'>} K
   * @param {import('../../packages/kernel/dist/commandRouting.js').ApplyRequest<'pdf-lib', K>} request
   */
  apply: async (request) => {
    await mark('before apply (with any checkpoint)');
    const applied = await localPdfLibWriter.apply(request);
    await mark('after apply (the new image in hand)');
    return applied;
  },
};
const bus = new CommandBus({ 'pdf-lib': writer });
const executed = await documents.run(outcome.docId, (context) =>
  bus.execute(
    {},
    context,
    { kind: 'watermarkPages', pages: 'all', text: 'DRAFT', opacity: 0.3, rotationDegrees: 45, fontSize: 48 },
    inputs,
  ),
);
const resident = documents.residentDocumentBytes();
await mark('after the command (image and log)');
// A SECOND COMMAND, so what is retained can be told apart: a copy held per command grows by one each time, and one
// held once does not.
if (process.argv.includes('--twice')) {
  const secondPeak = await sampledPeak(() =>
    documents.run(outcome.docId, (context) =>
      bus.execute(
        {},
        context,
        { kind: 'watermarkPages', pages: 'all', text: 'AGAIN', opacity: 0.3, rotationDegrees: 45, fontSize: 48 },
        inputs,
      ),
    ),
  );
  steps['sampled peak during the second command (the control)'] = Number((secondPeak / size).toFixed(2));
  steps['service counts after two'] = Number((documents.residentDocumentBytes() / size).toFixed(2));
  await mark('after the second command');
}
// AN UNDO, so the refresh path is measured too: a terminal entry's checkpoint is restored and the canonical image is
// replaced from the session's bytes (ADR-0121 Decision 2) — the replacement that took the old and new image together.
if (process.argv.includes('--undo')) {
  const undoPeak = await sampledPeak(() =>
    documents.run(outcome.docId, (context) =>
      bus.undo({}, context, async (write) => {
        await write(join(scratch, 'restored'));
      }, inputs),
    ),
  );
  steps['service counts after undo'] = Number((documents.residentDocumentBytes() / size).toFixed(2));
  steps['sampled peak during the undo'] = Number((undoPeak / size).toFixed(2));
  await mark('after an undo');
}
await documents.close(outcome.docId);
rmSync(scratch, { recursive: true, force: true });

reportPeak({
  role: 'main-byte-image',
  document: documentPath,
  documentBytes: size,
  baselineBytes: baseline,
  afterOpenPeakBytes: afterOpen,
  serialises: serialised,
  // THE SHAPE, never the value: an execution's answer can carry the image itself.
  executed: Object.keys(/** @type {object} */ (executed.value ?? {})).join(','),
  version: executed.version,
  residentAfterBytes: resident,
  residentAfterOverFile: Number((resident / size).toFixed(2)),
  peakOverFile: Number(((peakRssBytes() - baseline) / size).toFixed(2)),
  arrayBuffersOverFile: steps,
});
