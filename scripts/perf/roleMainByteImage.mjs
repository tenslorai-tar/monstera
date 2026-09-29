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
 * REAL: `DocumentService` with the production reader, `CommandBus`, and the shipped hosted pdf-lib execution
 * (`hostedPdfLibExecution`, ADR-0121 Decision 3). STANDING IN: the engine host, AS A SEPARATE PROCESS
 * (`pdfLibHostStandIn.mjs`), because the host's parse is exactly what this role must not charge to `main`. Its
 * session's image is the canonical image written out; its serialise, moved into place, is the canonical image
 * written to the destination. `adopt` writes the new image where the host would reopen it and does no more.
 *
 * Until Decision 3 this ran pdf-lib in this process through `localPdfLibWriter`, as `main` did — which is how the
 * 4.0× it recorded was measured.
 *
 * Usage: node scripts/perf/roleMainByteImage.mjs <document-path>
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
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
const { hostedPdfLibExecution } = await import('../../packages/kernel/dist/pdfLibWriter.js');
const STAND_IN = join(REPO_ROOT, 'scripts', 'perf', 'pdfLibHostStandIn.mjs');
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

// THE SAMPLER'S CONTROL, run first: an allocation of twice the document, held across a turn. A sampler that could
// not see this would report every step below as the reassuring one.
steps['sampler control (2.00 allocated)'] = Number(
  (
    (await sampledPeak(async () => {
      const held = new Uint8Array(size * 2);
      held[0] = 1;
      await new Promise((settle) => setTimeout(settle, 20));
      held[1] = held[0];
    })) / size
  ).toFixed(2),
);

// THE HOST, STANDING IN AS A PROCESS OF ITS OWN (ADR-0121 Decision 3): the session's image written to a file, the
// pdf-lib spec run by `pdfLibHostStandIn.mjs` in a child, the result left in a file and staged — so what this process
// holds is what `main` holds.
let hostRuns = 0;
/** @type {import('../../packages/kernel/dist/pdfLibWriter.js').PdfLibHost} */
const standInHost = async (_session, command) => {
  hostRuns += 1;
  const input = join(scratch, `host-in-${String(hostRuns)}`);
  const output = join(scratch, `host-out-${String(hostRuns)}`);
  await documents.writeCanonicalImage(SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS, outcome.docId, input);
  const run = spawnSync(process.execPath, [STAND_IN, input, output, JSON.stringify(command)], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`the host stand-in exited ${String(run.status)}`);
  rmSync(input, { force: true });
  const byteLength = statSync(output).size;
  return {
    byteLength,
    place: (destination) => rename(output, destination),
    discard: () => rm(output, { force: true }),
  };
};
const hostSession = /** @type {import('../../packages/kernel/dist/engineSeam.js').MupdfSession} */ (
  /** @type {unknown} */ ({ engine: 'mupdf' })
);
const hosted = hostedPdfLibExecution(standInHost);
/** @type {import('../../packages/kernel/dist/commandRouting.js').RegisteredWriter<'pdf-lib'>} */
const writer = {
  serialise: () => Promise.reject(new Error('the bus serialises nothing into main for a hosted command')),
  // THE CHECKPOINT, as the host's serialise moved into place: the canonical image is the session's bytes here.
  serialiseInto: (_session, destination) =>
    documents.writeCanonicalImage(SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS, outcome.docId, destination),
  capture: hosted.capture,
  invert: hosted.invert,
  apply: async (request) => {
    await mark('before apply (with any checkpoint)');
    const applied = await hosted.apply(request);
    await mark('after apply (the result staged in the host)');
    return applied;
  },
};
const bus = new CommandBus({ 'pdf-lib': writer });
const executed = await documents.run(outcome.docId, (context) =>
  bus.execute(
    { mupdf: hostSession },
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
        { mupdf: hostSession },
        context,
        { kind: 'watermarkPages', pages: 'all', text: 'AGAIN', opacity: 0.3, rotationDegrees: 45, fontSize: 48 },
        inputs,
      ),
    ),
  );
  steps['sampled peak during the second command'] = Number((secondPeak / size).toFixed(2));
  steps['service counts after two'] = Number((documents.residentDocumentBytes() / size).toFixed(2));
  await mark('after the second command');
}
// AN UNDO, so the refresh path is measured too: a terminal entry's checkpoint is restored and the canonical image is
// replaced from the session's bytes (ADR-0121 Decision 2) — the replacement that took the old and new image together.
if (process.argv.includes('--undo')) {
  const undoPeak = await sampledPeak(() =>
    documents.run(outcome.docId, (context) =>
      bus.undo({ mupdf: hostSession }, context, async (write) => {
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
