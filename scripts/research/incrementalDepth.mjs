// @ts-check
/**
 * ADR-0008's conditions 2, 3 and 5, executed on the NATIVE engine (ADR-0124) for the route row 287 owes them to: a
 * pdf-lib command saved by `commit()` — an appended revision — rather than a whole rewrite (ADR-0127).
 *
 * First run 2026-09-29 against the WASM engine, parked when the engine went native; this is that script on the engine
 * that ships, so its readings are the ones ADR-0127 rests on.
 *
 * ## What each condition asks, as this script runs it
 *
 * **2. Depth.** A document that ALREADY carries several incremental revisions, appended to again, many times. Read
 * back after each append by a different library (MuPDF): it must open without repair, keep its page count, report
 * one more version than before, and show the drawing the append made.
 *
 * **3. Growth.** A session of 100 appends, the bytes recorded after each, beside the same 100 edits made the way the
 * pipeline actually runs them for an UNSIGNED document: MuPDF re-serialises the session whole between commands, so an
 * appendix is written once and folded into the next full save. Measure, do not assume a compaction step exists.
 *
 * **5. Redaction over appendices.** The product's own burn-in (`markMatchesForRedaction` + `applyRedactions` through
 * `localMupdfExecution`, then `mupdfWriter.serialise`, which takes the removal save terms) on a document whose image
 * carries a pdf-lib appendix. The output must hold ONE revision and the redacted text must be unrecoverable — searched
 * in the extracted text AND in the raw bytes of a decompressed copy, never on the rendered page. Its CONTROLS: the same
 * check passes a burn-in on the same document without an appendix (the check can pass), and FINDS the text in the
 * un-redacted input (the check can see).
 *
 * Run: node scripts/research/incrementalDepth.mjs   (needs `npm run build` and the native shim)
 * It prints readings and the checks' outcomes, never a routing verdict.
 */
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { bindNativeEngine } from '../lib/nativeEngine.mjs';

if (bindNativeEngine() === null) throw new Error('the native MuPDF shim is not built here: npm run provision:mupdf');
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
const kernel = await import('../../packages/kernel/dist/engine.js');
const { mupdfWriter, localMupdfExecution } = kernel;

const SECRET = 'SECRET-7Q3-LEDGER';

/** An ordinary document: `pages` Letter pages of text, the secret on page 1. @param {number} pages */
async function baseDocument(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < pages; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(at === 0 ? `Account ${SECRET} closed` : `Page ${String(at + 1)}`, { x: 72, y: 700, size: 14, font });
    for (let line = 0; line < 20; line += 1) {
      page.drawText('Revenue grew across all three regions, led by renewals.', { x: 72, y: 660 - line * 24, size: 11, font });
    }
  }
  return document.save({ updateFieldAppearances: false });
}

/** @param {Uint8Array} image */
function opened(image) {
  const document = mupdf.PDFDocument.openDocument(image, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  return document;
}

/** `count` incremental revisions appended by MuPDF: each sets the Info title, as a signing tool's edits would. */
function withRevisions(/** @type {Uint8Array} */ image, /** @type {number} */ count) {
  let bytes = image;
  for (let at = 0; at < count; at += 1) {
    const document = opened(bytes);
    document.setMetaData('info:Title', `Revision ${String(at + 1)}`);
    bytes = document.saveToBuffer('incremental').asUint8Array();
    document.destroy();
  }
  return bytes;
}

/** One pdf-lib command's shape — a drawn mark on page 1 — saved by `commit()`. */
async function drawMark(/** @type {Uint8Array} */ image, /** @type {string} */ label) {
  const document = await PDFDocument.load(image, { updateMetadata: false, forIncrementalUpdate: true });
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  document.getPage(0).drawText(label, { x: 400, y: 40, size: 9, font, color: rgb(0.6, 0, 0) });
  return document.commit();
}

/** What MuPDF reads back: repaired, versions, pages, and page 1's text. @param {Uint8Array} image */
function readBack(image) {
  const document = opened(image);
  const reading = {
    repaired: document.wasRepaired(),
    versions: document.countVersions(),
    pages: document.countPages(),
    text: document.loadPage(0).toStructuredText().asText(),
  };
  document.destroy();
  return reading;
}

/** MuPDF's full save of `image` — what the host's serialise is for an unsigned document between commands. */
function fullSave(/** @type {Uint8Array} */ image) {
  const document = opened(image);
  const bytes = document.saveToBuffer('').asUint8Array();
  document.destroy();
  return bytes;
}

/** A decompressed copy's raw bytes as latin1 text, for a search that does not trust the rendering. */
function rawText(/** @type {Uint8Array} */ image) {
  const document = opened(image);
  const bytes = document.saveToBuffer('decompress').asUint8Array();
  document.destroy();
  return Buffer.from(bytes).toString('latin1');
}

/** The product's burn-in: mark every match of the secret, apply, and serialise with the terms the writer chooses. */
async function productRedaction(/** @type {Uint8Array} */ image) {
  const session = await mupdfWriter.open(image);
  await localMupdfExecution.apply({
    session,
    command: { kind: 'markMatchesForRedaction', query: SECRET, pages: 'all' },
    source: undefined,
    reads: undefined,
  });
  await localMupdfExecution.apply({
    session,
    command: { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels', keepTitle: false },
    source: undefined,
    reads: undefined,
  });
  const out = await mupdfWriter.serialise(session);
  await mupdfWriter.close(session);
  return out;
}

/**
 * The secret as a content stream may spell it: literally, or as a hex string — which is how pdf-lib writes text, so
 * a search for the literal alone was BLIND to the input it must find (the control below caught it on its first run).
 */
const SECRET_HEX = Buffer.from(SECRET, 'latin1').toString('hex').toUpperCase();

/** Whether the secret can be found in `image` — in its extracted text or its decompressed raw bytes. */
function secretFound(/** @type {Uint8Array} */ image) {
  const back = readBack(image);
  const raw = rawText(image);
  return {
    inText: back.text.includes(SECRET),
    inRaw: raw.includes(SECRET) || raw.toUpperCase().includes(SECRET_HEX),
    versions: back.versions,
  };
}

// ---- conditions 2 and 3 ------------------------------------------------------------------------------------------
const base = await baseDocument(40);
const deep = withRevisions(base, 3);
const start = readBack(deep);
console.log(JSON.stringify({ base: base.byteLength, deep: deep.byteLength, startVersions: start.versions, startRepaired: start.repaired }));

let appended = deep; // the SIGNED shape: every command appends onto what is there
let pipelined = base; // the UNSIGNED shape: MuPDF's full save between commands folds each appendix in
const checkpoints = [];
for (let step = 1; step <= 100; step += 1) {
  const label = `mark-${String(step)}`;
  const began = process.hrtime.bigint();
  appended = await drawMark(appended, label);
  const took = Number(process.hrtime.bigint() - began) / 1e9;
  pipelined = fullSave(await drawMark(pipelined, label));
  if (step === 1 || step % 10 === 0) {
    const back = readBack(appended);
    checkpoints.push({
      step,
      appendedBytes: appended.byteLength,
      pipelinedBytes: pipelined.byteLength,
      versions: back.versions,
      expectedVersions: start.versions + step,
      repaired: back.repaired,
      pages: back.pages,
      markShown: back.text.includes(label),
      seconds: Number(took.toFixed(3)),
    });
  }
}
console.table(checkpoints);
const depthHeld = checkpoints.every((row) => !row.repaired && row.pages === 40 && row.markShown && row.versions === row.expectedVersions);
console.log(`condition 2 (depth): ${depthHeld ? 'held at every checkpoint' : 'NOT held — read the table'}`);

// ---- condition 5 -------------------------------------------------------------------------------------------------
const appendixInput = await drawMark(base, 'mark-before-redaction');
const deepAppendixInput = await drawMark(deep, 'mark-before-redaction');
const control = secretFound(appendixInput);
const results = {
  'CONTROL: the check FINDS the secret in the un-redacted input': control,
  'CONTROL: burn-in without an appendix': secretFound(await productRedaction(base)),
  'burn-in over one pdf-lib appendix': secretFound(await productRedaction(appendixInput)),
  'burn-in over three MuPDF revisions and a pdf-lib appendix': secretFound(await productRedaction(deepAppendixInput)),
};
console.log(JSON.stringify(results, null, 2));
if (!control.inText || !control.inRaw) throw new Error('CONTROL FAILED: the check cannot see the secret where it is');
