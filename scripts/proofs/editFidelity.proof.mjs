// @ts-check
/**
 * In-place editing does not silently redraw what it did not touch.
 *
 * `BUILD-PROMPT.md`:706 owes *fidelity proofs — pixel-diff untouched runs*, and
 * the reason it is owed rather than optional is that **a fidelity failure looks
 * exactly like a working feature**. An editor that replaces one run and
 * re-encodes the rest of the page passes every text assertion ever written for
 * it: the text is right, the round trip is right, and the document quietly stops
 * looking like itself.
 *
 * That failure has a name in this project's own record. `docs/ENGINE-SPIKE.md`:157
 * carries it in MuPDF's voice — *a full rewrite corrupts non-embedded font
 * refs* — and `FPDF_SaveAsCopy` is a full rewrite. So the question is asked of
 * pixels, which is the only observable that can see it.
 *
 * ## The two claims, and why the first has to come first
 *
 * 1. **An untouched save changes no pixel.** Open, serialise with no edit at
 *    all, reopen, render both, compare. A non-zero answer here is a defect no
 *    editing test could ever attribute correctly, because every editing test
 *    changes something.
 * 2. **An edit changes only where it was made.** Render before and after, and
 *    compare the bands above and below the edited run. *The edit worked* and
 *    *the edit worked and rewrote the rest of the page* are one observation on
 *    the whole page, and only the second is a defect.
 *
 * ## Four controls, because every claim here has a reassuring answer
 *
 * The answer wanted from all of it is **zero**, which is what a broken
 * instrument produces too. So:
 *
 * - **RESOLUTION** (item 4a): the comparator is fed two renders differing by one
 *   pixel at one level and must report exactly that, before it compares anything
 *   real. A comparator returning 0 for everything satisfies claim 1 perfectly.
 * - **CHANNELS**: two pages differing only in a run's RED component must be
 *   reported as different, and this one runs through the real rasteriser rather
 *   than over arrays this file built. The resolution control above passes on a
 *   sampler that reads one byte of a BGRA pixel; this one does not, which is
 *   finding CCCCCC-3 and the guard against it coming back.
 * - **INK**: every render's inked fraction is measured and asserted non-zero. A
 *   page PDFium failed to draw renders white, and white differs from white by
 *   nothing — a blank render and a perfectly preserved one are the same 0.
 * - **A POSITIVE CASE IN THE SAME RUN**: the edited band must differ. Without it
 *   the whole file passes on a build where editing does nothing at all.
 *
 * The corpus half is UNVERIFIABLE where no corpus is supplied and red under
 * `--require-corpus`. Nothing from a corpus document is printed but its id, its
 * size and these scores.
 *
 * ## What it does not cover, stated rather than left to be assumed
 *
 * - **Page 1 only, over the corpus.** Rendering every page of every document is
 *   minutes rather than seconds, and the failure this asks about is a property
 *   of the save rather than of a page. A later page carrying something page 1
 *   does not is a real gap and it is this one.
 * - **The edited-band case runs on the constructed page alone**, because it
 *   needs to know which run was edited and where it sits. Editing a corpus
 *   document would also mean printing what it says to decide the band, which
 *   the corpus rule forbids outright.
 * - **Text replacement only.** Object-level edit, region replacement and
 *   replace-all each owe their own case here when they land; the untouched-save
 *   half already covers all of them, because they share one `serialise`.
 *
 * Usage: node scripts/proofs/editFidelity.proof.mjs [--require-pdfium] [--require-corpus]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { PDFIUM_ADAPTER, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE_PDFIUM = process.argv.includes('--require-pdfium');
const REQUIRE_CORPUS = process.argv.includes('--require-corpus');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE_PDFIUM,
    subject: 'edit fidelity',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

refuseStaleBuild(root, PDFIUM_ADAPTER, 1);

const { openPdfium, pdfiumWriter, textObjectIndices, replaceTextObjects } = await import(
  '../../packages/kernel/dist/pdfiumFfi.js'
);

const PAGE = { width: 400, height: 300 };
const SCALE = 2;
const FIRST = 'FIRST RUN stays exactly where it is';
const SECOND = 'SECOND RUN is the one that changes';
const THIRD = 'THIRD RUN stays exactly where it is';
const REPLACEMENT = 'SECOND RUN has been replaced';

/**
 * The rendering surface. Bound here rather than exported from the adapter.
 *
 * The adapter carries what a COMMAND needs; rasterising is this instrument's own
 * business, and an unused render API added to a shipped module for a proof's
 * convenience is an abstraction with one caller. When the HD render row lands it
 * will bring its own, with a consumer.
 */
function renderer() {
  const lib = koffi.load(library);
  return {
    loadPage: lib.func('void *FPDF_LoadPage(void *document, int index)'),
    closePage: lib.func('void FPDF_ClosePage(void *page)'),
    pageWidth: lib.func('float FPDF_GetPageWidthF(void *page)'),
    pageHeight: lib.func('float FPDF_GetPageHeightF(void *page)'),
    loadMem: lib.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *pw)'),
    closeDocument: lib.func('void FPDF_CloseDocument(void *document)'),
    createBitmap: lib.func('void *FPDFBitmap_Create(int width, int height, int alpha)'),
    fillRect: lib.func(
      'void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)',
    ),
    renderPage: lib.func(
      'void FPDF_RenderPageBitmap(void *bitmap, void *page, int x, int y, int w, int h, int rotate, int flags)',
    ),
    bitmapBuffer: lib.func('void *FPDFBitmap_GetBuffer(void *bitmap)'),
    bitmapStride: lib.func('int FPDFBitmap_GetStride(void *bitmap)'),
    destroyBitmap: lib.func('void FPDFBitmap_Destroy(void *bitmap)'),
  };
}

/**
 * @typedef {{ width: number, height: number, grey: Float64Array }} Render
 */

/**
 * Greyscale samples of one page of a document, from its bytes.
 *
 * ## THIS READ ONE CHANNEL AND CALLED IT GREY (finding CCCCCC-3, 2026-09-09)
 *
 * `FPDFBitmap_Create(w, h, 1)` produces BGRA — `fpdfview.h`:1121, *"4 bytes per
 * pixel, byte order: blue, green, red, alpha"* — so `pixels[at]` alone is the
 * **blue** sample. A page whose red and green moved and whose blue did not
 * scored zero differing, which is this file's own reassuring answer.
 *
 * The claim it was supporting survived the widening, and that was **measured
 * rather than assumed**: with the combination below, all five corpus documents
 * still report 0 of ~2,000,000 differing, and the inked fractions moved
 * (`corpus-2` 29.48% → 29.52%, `corpus-5` 35.21% → 37.41%) — which is the
 * resolution check on the change itself, since a combination that never reached
 * the corpus renders would have moved nothing.
 *
 * It is fixed anyway because of what is coming: the object-level edit row is
 * *move, scale, recolor, delete*, and a text object recoloured black to red
 * changes **no blue sample at all** — 0 before and 0 after. A fidelity case
 * written for that row against a blue-only sampler could not fail.
 *
 * @param {ReturnType<typeof renderer>} api
 * @param {Uint8Array} bytes
 * @param {number} index
 * @returns {Render}
 */
function renderPageOf(api, bytes, index) {
  const buffer = Buffer.from(bytes);
  const document = api.loadMem(buffer, buffer.length, null);
  if (document === null) throw new Error('PDFium refused a document this proof produced.');
  try {
    const page = api.loadPage(document, index);
    if (page === null) throw new Error(`PDFium could not load page ${String(index)}.`);
    try {
      const width = Math.max(1, Math.round(Number(api.pageWidth(page)) * SCALE));
      const height = Math.max(1, Math.round(Number(api.pageHeight(page)) * SCALE));
      const bitmap = api.createBitmap(width, height, 1);
      api.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
      api.renderPage(bitmap, page, 0, 0, width, height, 0, 0);
      const stride = Number(api.bitmapStride(bitmap));
      const pixels = /** @type {Uint8Array} */ (
        koffi.decode(api.bitmapBuffer(bitmap), 'uint8_t', stride * height)
      );
      const grey = new Float64Array(width * height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          // Rec. 601 luma over all three channels, in BGRA order. A colour
          // change confined to red or green is invisible to any one of them.
          const at = y * stride + x * 4;
          grey[y * width + x] =
            0.114 * (pixels[at] ?? 0) +
            0.587 * (pixels[at + 1] ?? 0) +
            0.299 * (pixels[at + 2] ?? 0);
        }
      }
      api.destroyBitmap(bitmap);
      return { width, height, grey };
    } finally {
      api.closePage(page);
    }
  } finally {
    api.closeDocument(document);
  }
}

/**
 * How many samples of two renders differ, and by how much.
 *
 * A COUNT rather than a mean: the question is *did anything move*, and a mean
 * over a mostly-white page turns one badly wrong glyph into a small number.
 *
 * @param {Render} one
 * @param {Render} two
 * @param {{ from: number, to: number }} [rows] device rows, half-open
 * @returns {{ differing: number, worst: number, total: number }}
 */
function compare(one, two, rows) {
  if (one.width !== two.width || one.height !== two.height) {
    return { differing: one.grey.length + two.grey.length, worst: 255, total: 0 };
  }
  const from = rows === undefined ? 0 : Math.max(0, rows.from);
  const to = rows === undefined ? one.height : Math.min(one.height, rows.to);
  let differing = 0;
  let worst = 0;
  let total = 0;
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < one.width; x += 1) {
      const at = y * one.width + x;
      total += 1;
      const delta = Math.abs((one.grey[at] ?? 0) - (two.grey[at] ?? 0));
      if (delta > 0) {
        differing += 1;
        if (delta > worst) worst = delta;
      }
    }
  }
  return { differing, worst, total };
}

/**
 * The fraction of a render that carries ink.
 *
 * The column that makes a zero mean something: a page PDFium failed to draw
 * renders white, and white differs from white by nothing.
 *
 * @param {Render} render
 * @returns {number}
 */
function inked(render) {
  let count = 0;
  for (const sample of render.grey) if (sample < 250) count += 1;
  return count / render.grey.length;
}

/**
 * One text run in a given colour. The input for the channel control.
 *
 * Black and red differ in **red alone** — blue is 0 in both and green is 0 in
 * both — so a sampler reading any single channel reports two of these as
 * identical, and this is the fixture a blue-only sampler survives.
 *
 * @param {import('@cantoo/pdf-lib').RGB} colour
 * @returns {Promise<Uint8Array>}
 */
async function oneRunPage(colour) {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(FIRST, { x: 30, y: 230, size: 11, font, color: colour });
  return document.save();
}

/** A page with three text runs and a filled rectangle. */
async function threeRunPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 120, height: 40, color: rgb(0.2, 0.4, 0.9) });
  page.drawText(FIRST, { x: 30, y: 230, size: 11, font });
  page.drawText(SECOND, { x: 30, y: 190, size: 11, font });
  page.drawText(THIRD, { x: 30, y: 150, size: 11, font });
  return document.save();
}

/**
 * The roster, over the cases that exist on EVERY runner.
 *
 * Eight, and it is an independent claim rather than a count of what ran — a
 * total printed from the cases that executed agrees with any collection,
 * including one that has quietly shrunk (audit item 4c, `check:proofanchors`).
 *
 * **The corpus cases are deliberately outside it**, because their number is the
 * corpus's and not this file's, and a literal here would be a fixture pinned to
 * something designed to change. They get their own anchor instead: every
 * document must be either scored or attributed as a scan, and the two counts
 * must sum to the number of documents read. That is the relation a silently
 * dropped document would break, which a count of rows printed would not.
 *
 * @type {string[]}
 */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/**
 * A corpus assertion, outside the roster and inside the same failure list.
 *
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function corpusCase(name, ok, detail) {
  if (!ok) failures.push(`${name}\n      ${detail}`);
}

async function main() {
  const out = process.stdout;
  out.write('# In-place editing does not redraw what it did not touch\n\n');
  out.write(`  PDFium ${PDFIUM_VERSION}, rendered at ${String(SCALE)}x\n\n`);

  openPdfium(library);
  const api = renderer();

  // CONTROL 1 — RESOLUTION. Before anything real is compared.
  const flat = /** @type {Render} */ ({
    width: 4,
    height: 4,
    grey: new Float64Array(16).fill(255),
  });
  const nudged = /** @type {Render} */ ({ width: 4, height: 4, grey: flat.grey.slice() });
  nudged.grey[5] = 254;
  const smallest = compare(flat, nudged);
  record(
    'CONTROL: the comparator sees one pixel changed by one level',
    smallest.differing === 1 && smallest.worst === 1,
    `${String(smallest.differing)} differing, worst ${String(smallest.worst)}`,
  );
  // A SEPARATE ARRAY holding the same samples, not the same object twice —
  // comparing a render to itself is a loop over one buffer and would pass on a
  // comparator that returned its first argument's length.
  const copy = /** @type {Render} */ ({ width: 4, height: 4, grey: flat.grey.slice() });
  const identical = compare(flat, copy);
  record(
    'CONTROL: and reports nothing for two equal renders held separately',
    identical.differing === 0,
    'so a zero below is a reading and not the comparator',
  );

  // CONTROL 3 — THE CHANNELS, and it runs through `renderPageOf` rather than
  // over arrays this file built. The two controls above are satisfied by a
  // sampler that reads one byte of a BGRA pixel, which is what this file did
  // until 2026-09-09 (finding CCCCCC-3): black and red share a blue sample and
  // a green one, so a single-channel reading of these two pages is identical.
  const blackRun = renderPageOf(api, await oneRunPage(rgb(0, 0, 0)), 0);
  const redRun = renderPageOf(api, await oneRunPage(rgb(1, 0, 0)), 0);
  const recoloured = compare(blackRun, redRun);
  record(
    'CONTROL: a run recoloured black to RED is reported as changed',
    recoloured.differing > 0,
    `${String(recoloured.differing)} of ${String(recoloured.total)} differ — the object-level edit row is what needs this`,
  );

  const original = await threeRunPage();

  // CLAIM 1 — an untouched save changes no pixel.
  const untouchedSession = await pdfiumWriter.open(original);
  const untouchedBytes = await pdfiumWriter.serialise(untouchedSession);
  await pdfiumWriter.close(untouchedSession);
  const beforeRender = renderPageOf(api, original, 0);
  const untouchedRender = renderPageOf(api, untouchedBytes, 0);
  record(
    'the constructed page carries ink',
    inked(beforeRender) > 0.01,
    `${(inked(beforeRender) * 100).toFixed(2)}% inked, so the zeros below are about preservation`,
  );
  const untouched = compare(beforeRender, untouchedRender);
  record(
    'an untouched save changes no pixel',
    untouched.differing === 0,
    `${String(untouched.differing)} of ${String(untouched.total)} differ, worst ${String(untouched.worst)}`,
  );

  // CLAIM 2 — an edit changes only where it was made.
  const session = await pdfiumWriter.open(original);
  const texts = await textObjectIndices(session, 0);
  await replaceTextObjects(session, 0, [{ index: texts[1] ?? -1, text: REPLACEMENT }]);
  const editedBytes = await pdfiumWriter.serialise(session);
  await pdfiumWriter.close(session);
  const editedRender = renderPageOf(api, editedBytes, 0);

  // The edited run sits at y=190pt on a 300pt page, so in DEVICE rows — which
  // run downward from the top — it is around (300 - 190 - 11) * SCALE. The band
  // is generous on both sides; what matters is that the bands OUTSIDE it are
  // the untouched runs and the rectangle.
  const band = { from: Math.round((PAGE.height - 205) * SCALE), to: Math.round((PAGE.height - 183) * SCALE) };
  const inside = compare(beforeRender, editedRender, band);
  const above = compare(beforeRender, editedRender, { from: 0, to: band.from });
  const below = compare(beforeRender, editedRender, { from: band.to, to: editedRender.height });

  // THE POSITIVE CASE. Without it every assertion here passes on a build where
  // editing does nothing at all.
  record(
    'the edited band DID change',
    inside.differing > 0,
    `${String(inside.differing)} of ${String(inside.total)} differ in device rows ${String(band.from)}-${String(band.to)}`,
  );
  record(
    'and nothing above it moved',
    above.differing === 0,
    `${String(above.differing)} of ${String(above.total)} differ, worst ${String(above.worst)}`,
  );
  record(
    'and nothing below it moved',
    below.differing === 0,
    `${String(below.differing)} of ${String(below.total)} differ, worst ${String(below.worst)}`,
  );

  // THE CORPUS. One synthetic page from one producer has no embedded subsets, no
  // images and no transparency, which is exactly what a full rewrite loses.
  out.write('## The untouched save, over the supplied corpus\n');
  const corpus = openCorpus({ required: REQUIRE_CORPUS });
  if (!corpus.available) {
    out.write(corpus.outcome.text);
    if (corpus.outcome.code !== 0) process.exitCode = 1;
  } else {
    out.write('  id          bytes -> saved        differing / total   worst   ink\n');
    let seen = 0;
    for (const document of corpus.documents) {
      seen += 1;
      const held = await pdfiumWriter.open(document.bytes);
      const saved = await pdfiumWriter.serialise(held);
      await pdfiumWriter.close(held);
      const one = renderPageOf(api, document.bytes, 0);
      const two = renderPageOf(api, saved, 0);
      const score = compare(one, two);
      const ink = inked(one);
      out.write(
        `  ${document.id.padEnd(10)} ${String(document.size).padStart(9)} -> ${String(saved.length).padStart(9)}` +
          `  ${String(score.differing).padStart(6)} / ${String(score.total).padStart(9)}` +
          `  ${String(score.worst).padStart(5)}  ${(ink * 100).toFixed(2)}%\n`,
      );
      corpusCase(
        `${document.id}: an untouched save changes no pixel`,
        score.differing === 0,
        `${String(score.differing)} of ${String(score.total)} differ, worst ${String(score.worst)}`,
      );
      corpusCase(
        `${document.id}: and its first page carries ink`,
        ink > 0.001,
        `${(ink * 100).toFixed(2)}% inked, so the zero above is preservation and not a blank render`,
      );
    }
    // THE CORPUS HALF'S OWN ANCHOR. A document skipped by a `continue` somebody
    // adds later would take its two assertions with it and leave a shorter
    // table nobody counts — the exact shape the roster exists to catch, in the
    // half whose size is the corpus's rather than this file's.
    corpusCase(
      'every corpus document was read',
      seen === corpus.documents.length,
      `${String(seen)} of ${String(corpus.documents.length)} document(s) reached the comparison`,
    );
    out.write(`${corpusCaveat(corpus.documents.length)}\n`);
  }

  out.write('\n');
  out.write(
    failures.length > 0
      ? `${String(failures.length)} fidelity case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('fidelity case'),
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
