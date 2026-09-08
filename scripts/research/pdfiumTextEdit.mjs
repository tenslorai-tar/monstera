// @ts-check
/**
 * What PDFium can actually do to a text run, and what saving costs.
 *
 * ## Why this comes before the host
 *
 * `docs/ARCHITECTURE.md`:410 makes PDFium the **writer of record** for in-place
 * text editing and styled runs, and `docs/FEATURES.md`:144's trigger names those
 * rows as the thing that earns the second contained host. The HD render toggle
 * was measured on 2026-09-08 and is not that consumer — its *higher fidelity*
 * premise turned out to be a legibility policy rather than a property. So the
 * editing rows are what the host is built for, and their premise gets the same
 * treatment before an AppContainer SID is written for it.
 *
 * Four questions, in the order where a *no* stops the next one.
 *
 * ## 1. Does this build export the surface at all
 *
 * The non-V8 archive is a security decision (`scripts/provision/pdfium.mjs`) and
 * a build that omits an engine can omit other things. One call is what the whole
 * editing row rests on; if it is absent, the matrix row is wrong and nothing
 * below matters.
 *
 * **THE FIRST VERSION OF THIS SECTION ANSWERED IT WITH A BYTE SEARCH AND WAS
 * WRONG, and the wrong answer is kept in the output rather than deleted.** It
 * searched the DLL's bytes for `FPDFTextObj_SetText`, printed **present**, and
 * `koffi.load` then refused: *Cannot find function 'FPDFTextObj_SetText' in
 * shared library*. Both were right. The bytes are there — as the **prefix of
 * `FPDFTextObj_SetTextRenderMode`**, which this build does export — and the
 * export directory, the only list a loader consults, has no such entry.
 *
 * A name is not a substring, and `includes` has no way to know that. This is
 * `CLAUDE.md`'s *a line is not a unit of meaning* one level down: the scan could
 * see, its control passed, its root and window were the whole file, and it was
 * matching against the wrong **unit**. The remedy is the same one that section
 * gives — build the unit the file actually has and match against that — so
 * `scripts/lib/peExports.mjs` parses the export table, and §1 prints **both**
 * answers side by side so the divergence is a reading rather than a paragraph.
 *
 * The call that does exist is `FPDFText_SetText`.
 *
 * ## 2. Can it see the runs
 *
 * An editor that cannot enumerate what is on the page cannot replace one run of
 * it. Counted by object and read back as text.
 *
 * ## 3. WHAT AN UNTOUCHED SAVE COSTS — and this is the one that matters
 *
 * `BUILD-PROMPT.md`:706 owes *fidelity proofs, pixel-diff untouched runs* —
 * **the guard that in-place editing does not silently redraw text it never
 * touched, which is where a failure otherwise looks exactly like a working
 * feature.** The cheapest form of that question is asked here, before any
 * editing exists to blame: open a document, save it with **no edit at all**, and
 * compare the renders.
 *
 * A non-zero difference on an untouched save is a defect that no editing test
 * could ever attribute correctly, because every such test changes something.
 * `docs/ENGINE-SPIKE.md`:157 already carries the warning in MuPDF's voice — *a
 * full rewrite corrupts non-embedded font refs* — and `FPDF_SaveAsCopy` is a
 * full rewrite.
 *
 * ## 4. Does an edit survive the round trip, and what else moved
 *
 * The edit is asserted by reading it back from a **reopened** document rather
 * than from the session that made it: a setter agreeing with itself proves
 * nothing about what was stored. And the untouched half of the page is diffed
 * in the same run, because *the edit worked* and *the edit worked and rewrote
 * the rest of the page* are the same observation on the edited run alone.
 *
 * ## Its own controls
 *
 * The symbol scan throws unless it first finds names this DLL certainly exports
 * — a scan's reassuring answer is silence, and every way of breaking it produces
 * silence. The pixel comparison is resolution-tested before it compares
 * anything. And the untouched-save case is calibrated by an edited one in the
 * same run: a comparator that reports zero for everything passes §3 perfectly.
 *
 * Run (after `node scripts/provision/pdfium.mjs`):
 *
 *   node scripts/research/pdfiumTextEdit.mjs
 *
 * It prints readings, never a verdict.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { exportedSymbols } from '../lib/peExports.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const libraryPath = pdfiumLibrary(root);

/** The page, in points, and the scale every render below uses. */
const PAGE = { width: 400, height: 300 };
const SCALE = 2;

/** Symbols this DLL certainly exports. Both scans' positive control. */
const KNOWN_PRESENT = ['FPDF_LoadMemDocument', 'FPDF_RenderPageBitmap'];

/**
 * The editing surface, asked of the export table rather than probed by binding.
 *
 * koffi resolves a `func` eagerly, so a missing export surfaces as a throw from
 * `bind()` — which is loud but arrives before any reading, and names one symbol
 * rather than the set. Asking the table first gives the whole answer at once.
 */
const EDITING_SYMBOLS = [
  'FPDFPage_CountObjects',
  'FPDFPage_GetObject',
  'FPDFPageObj_GetType',
  'FPDFText_SetText',
  'FPDFTextObj_GetText',
  'FPDFPage_GenerateContent',
  'FPDF_SaveAsCopy',
  'FPDFText_LoadPage',
  'FPDFText_GetText',
];

/**
 * The name that made the byte scan wrong, kept as a case rather than a memory.
 *
 * It is not exported, and every byte search for it succeeds because
 * `FPDFTextObj_SetTextRenderMode` — which is exported — begins with it. Printed
 * beside the real symbols so the divergence between the two readers is visible
 * in the output of every run.
 */
const SUBSTRING_TRAP = 'FPDFTextObj_SetText';

/** A page with three distinct runs, so an edit to one is separable from the rest. */
async function threeRunPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('FIRST RUN stays exactly where it is', { x: 30, y: 230, size: 11, font });
  page.drawText('SECOND RUN is the one that changes', { x: 30, y: 190, size: 11, font });
  page.drawText('THIRD RUN stays exactly where it is', { x: 30, y: 150, size: 11, font });
  return document.save();
}

/** Everything this script binds, in one place. */
function bind() {
  const library = koffi.load(libraryPath);

  // FPDF_FILEWRITE is a struct whose second field is a callback PDFium calls
  // once per block. It is the only way FPDF_SaveAsCopy emits bytes — there is no
  // "save to path" in the public API.
  const writeBlock = koffi.proto(
    'int WriteBlockCallback(void *self, const void *data, unsigned long size)',
  );
  const fileWrite = koffi.struct('FPDF_FILEWRITE', {
    version: 'int',
    WriteBlock: koffi.pointer(writeBlock),
  });

  return {
    writeBlock,
    fileWrite,
    initialise: library.func('void FPDF_InitLibrary()'),
    destroy: library.func('void FPDF_DestroyLibrary()'),
    loadDocument: library.func(
      'void *FPDF_LoadMemDocument(const void *data, int size, const char *password)',
    ),
    closeDocument: library.func('void FPDF_CloseDocument(void *document)'),
    loadPage: library.func('void *FPDF_LoadPage(void *document, int index)'),
    closePage: library.func('void FPDF_ClosePage(void *page)'),
    countObjects: library.func('int FPDFPage_CountObjects(void *page)'),
    getObject: library.func('void *FPDFPage_GetObject(void *page, int index)'),
    pageCount: library.func('int FPDF_GetPageCount(void *document)'),
    pageWidth: library.func('float FPDF_GetPageWidthF(void *page)'),
    pageHeight: library.func('float FPDF_GetPageHeightF(void *page)'),
    objectType: library.func('int FPDFPageObj_GetType(void *object)'),
    setText: library.func('int FPDFText_SetText(void *object, const void *text)'),
    generateContent: library.func('int FPDFPage_GenerateContent(void *page)'),
    saveAsCopy: library.func('int FPDF_SaveAsCopy(void *document, FPDF_FILEWRITE *writer, int flags)'),
    loadTextPage: library.func('void *FPDFText_LoadPage(void *page)'),
    closeTextPage: library.func('void FPDFText_ClosePage(void *textPage)'),
    countChars: library.func('int FPDFText_CountChars(void *textPage)'),
    getText: library.func(
      'int FPDFText_GetText(void *textPage, int start, int count, _Out_ uint16_t *buffer)',
    ),
    createBitmap: library.func('void *FPDFBitmap_Create(int width, int height, int alpha)'),
    fillRect: library.func(
      'void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)',
    ),
    renderPage: library.func(
      'void FPDF_RenderPageBitmap(void *bitmap, void *page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)',
    ),
    bitmapBuffer: library.func('void *FPDFBitmap_GetBuffer(void *bitmap)'),
    bitmapStride: library.func('int FPDFBitmap_GetStride(void *bitmap)'),
    destroyBitmap: library.func('void FPDFBitmap_Destroy(void *bitmap)'),
  };
}

/**
 * A null-terminated UTF-16LE buffer, which is what FPDF_WIDESTRING is.
 *
 * @param {string} text
 * @returns {Buffer}
 */
function wideString(text) {
  const buffer = Buffer.alloc((text.length + 1) * 2);
  buffer.write(text, 'utf16le');
  return buffer;
}

/**
 * Greyscale samples of a rendered page.
 *
 * @typedef {{ width: number, height: number, grey: Float64Array }} Render
 * @param {ReturnType<typeof bind>} api
 * @param {unknown} page
 * @returns {Render}
 */
function render(api, page) {
  const width = Math.round(PAGE.width * SCALE);
  const height = Math.round(PAGE.height * SCALE);
  const bitmap = api.createBitmap(width, height, 1);
  api.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
  api.renderPage(bitmap, page, 0, 0, width, height, 0, 0);
  const stride = api.bitmapStride(bitmap);
  const pixels = koffi.decode(api.bitmapBuffer(bitmap), 'uint8_t', stride * height);
  const grey = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) grey[y * width + x] = pixels[y * stride + x * 4] ?? 0;
  }
  api.destroyBitmap(bitmap);
  return { width, height, grey };
}

/**
 * How many pixels of two renders differ, and by how much.
 *
 * A COUNT rather than a mean, because §3's question is *did anything move* and a
 * mean over a mostly-white page turns one badly wrong glyph into a small number.
 *
 * `rows` restricts the comparison to a band of device rows, which is what turns
 * §4 from *something changed* into *only the edited run changed*. Those are the
 * same observation over the whole page, and the second is the claim a fidelity
 * proof actually makes.
 *
 * @param {Render} one
 * @param {Render} two
 * @param {{ from: number, to: number }} [rows] device rows, half-open
 * @returns {{ differing: number, worst: number }}
 */
function compare(one, two, rows) {
  const height = Math.min(one.height, two.height);
  const from = Math.max(0, rows?.from ?? 0);
  const to = Math.min(height, rows?.to ?? height);
  let differing = 0;
  let worst = 0;
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < one.width; x += 1) {
      const delta = Math.abs((one.grey[y * one.width + x] ?? 0) - (two.grey[y * two.width + x] ?? 0));
      if (delta > 0) differing += 1;
      if (delta > worst) worst = delta;
    }
  }
  return { differing, worst };
}

/**
 * The device rows the second run occupies.
 *
 * Its baseline is at user y = 190 on a 300pt page and its size is 11pt, so it
 * spans roughly y = 187 (descender) to y = 201 (ascender) in user space. A
 * render is top-down, so device y is `(pageHeight − userY) × scale`, and the
 * band is padded by four device rows on each side because the question is
 * whether the OTHER runs moved, not where this one's anti-aliasing stops.
 */
const EDITED_BAND = {
  from: Math.floor((PAGE.height - 201) * SCALE) - 4,
  to: Math.ceil((PAGE.height - 187) * SCALE) + 4,
};

/**
 * The comparator's resolution test, run before it compares anything real.
 *
 * §3's reassuring answer is **zero differing pixels**, and a comparator that
 * returns zero for everything gives it perfectly. One pixel differing by one
 * level must be reported as exactly one pixel, worst one.
 */
function resolutionTest() {
  const flat = { width: 40, height: 40, grey: new Float64Array(1600).fill(128) };
  const nudged = { width: 40, height: 40, grey: Float64Array.from(flat.grey) };
  nudged.grey[900] = 127;
  const { differing, worst } = compare(flat, nudged);
  console.log(`  one pixel changed by one level: ${String(differing)} differing, worst ${String(worst)}`);
  if (differing !== 1 || worst !== 1) {
    throw new Error(
      `the comparator reports ${String(differing)} differing pixels for a one-pixel change, ` +
        'so a zero below would be a fact about a blind comparator rather than about the save',
    );
  }
  const same = compare(flat, { width: 40, height: 40, grey: Float64Array.from(flat.grey) });
  console.log(`  two identical renders: ${String(same.differing)} differing`);
  if (same.differing !== 0) throw new Error('the comparator reports a difference between equals');
}

/**
 * The longest edge any corpus render is allowed, in device pixels.
 *
 * A corpus document chooses its own page size and this script renders every one
 * of them twice. The bound is on the render rather than on the document, so a
 * large page is measured at a lower scale instead of being skipped — a skipped
 * document reports nothing, and nothing is the answer §5 is hoping for.
 */
const MAX_CORPUS_EDGE = 1600;

/**
 * A render of an arbitrary page, at the largest scale within {@link MAX_CORPUS_EDGE}.
 *
 * @param {ReturnType<typeof bind>} api
 * @param {unknown} page
 * @returns {Render}
 */
function renderAnyPage(api, page) {
  const points = { width: api.pageWidth(page), height: api.pageHeight(page) };
  const scale = Math.min(
    2,
    MAX_CORPUS_EDGE / Math.max(points.width, points.height, 1),
  );
  const width = Math.max(1, Math.round(points.width * scale));
  const height = Math.max(1, Math.round(points.height * scale));
  const bitmap = api.createBitmap(width, height, 1);
  api.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
  api.renderPage(bitmap, page, 0, 0, width, height, 0, 0);
  const stride = api.bitmapStride(bitmap);
  const pixels = koffi.decode(api.bitmapBuffer(bitmap), 'uint8_t', stride * height);
  const grey = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) grey[y * width + x] = pixels[y * stride + x * 4] ?? 0;
  }
  api.destroyBitmap(bitmap);
  return { width, height, grey };
}

/**
 * The page's text, read through PDFium rather than through the writer that made it.
 *
 * @param {ReturnType<typeof bind>} api
 * @param {unknown} page
 * @returns {string}
 */
function pageText(api, page) {
  const textPage = api.loadTextPage(page);
  const count = api.countChars(textPage);
  const buffer = Buffer.alloc((count + 1) * 2);
  api.getText(textPage, 0, count, buffer);
  api.closeTextPage(textPage);
  return buffer.toString('utf16le').replace(/\0+$/u, '');
}

/**
 * `FPDF_SaveAsCopy`'s bytes, collected through the callback it insists on.
 *
 * @param {ReturnType<typeof bind>} api
 * @param {unknown} document
 * @returns {Buffer}
 */
function saveAsCopy(api, document) {
  /** @type {Buffer[]} */
  const blocks = [];
  const callback = koffi.register(
    /**
     * @param {unknown} _self
     * @param {unknown} data
     * @param {number} size
     * @returns {number}
     */
    (_self, data, size) => {
      blocks.push(Buffer.from(koffi.decode(data, 'uint8_t', Number(size))));
      return 1;
    },
    koffi.pointer(api.writeBlock),
  );
  try {
    // Version 1 is the only version the public header defines, and PDFium
    // refuses a struct whose version it does not know rather than guessing.
    const ok = api.saveAsCopy(document, { version: 1, WriteBlock: callback }, 0);
    if (ok !== 1) throw new Error(`FPDF_SaveAsCopy answered ${String(ok)}`);
    return Buffer.concat(blocks);
  } finally {
    koffi.unregister(callback);
  }
}

async function main() {
  console.log('# What PDFium can do to a text run, and what saving costs');
  console.log('');
  console.log(`  PDFium ${PDFIUM_VERSION}`);
  console.log(`  page ${String(PAGE.width)}×${String(PAGE.height)}pt rendered at ${String(SCALE)}×`);
  console.log('');

  console.log('## 0. The comparator can see a difference that would change a decision');
  resolutionTest();
  console.log('');

  console.log('## 1. Whether this build exports the editing surface');
  console.log('   two readers, because they disagree and only one of them is right: a byte');
  console.log('   search over the whole file, and the PE export directory a loader consults');
  const binary = readFileSync(libraryPath);
  const text = binary.toString('latin1');
  const exported = exportedSymbols(binary, KNOWN_PRESENT);
  console.log(`  export table: ${String(exported.size)} names, and it carries ${KNOWN_PRESENT.join(', ')}`);
  console.log('  symbol                     bytes      exports');
  for (const symbol of [...EDITING_SYMBOLS, SUBSTRING_TRAP]) {
    console.log(
      `  ${symbol.padEnd(26)} ${(text.includes(symbol) ? 'found' : 'absent').padEnd(10)} ` +
        `${exported.has(symbol) ? 'exported' : 'NOT EXPORTED'}`,
    );
  }
  console.log(`  ${SUBSTRING_TRAP} is found by the byte search as a PREFIX of`);
  console.log('  FPDFTextObj_SetTextRenderMode, which is exported. A name is not a substring.');
  console.log('');

  const bytes = await threeRunPage();
  const api = bind();
  api.initialise();

  try {
    const original = Buffer.from(bytes);
    const document = api.loadDocument(original, original.length, null);
    if (document === null) throw new Error('PDFium refused the fixture');
    const page = api.loadPage(document, 0);

    console.log('## 2. Whether it can see the runs');
    const objects = api.countObjects(page);
    const types = [];
    for (let at = 0; at < objects; at += 1) {
      types.push(api.objectType(api.getObject(page, at)));
    }
    console.log(`  objects on the page: ${String(objects)}  types: ${types.join(', ')} (1 = text)`);
    console.log(`  text read back: ${JSON.stringify(pageText(api, page))}`);
    const before = render(api, page);
    console.log('');

    console.log('## 3. What an UNTOUCHED save costs');
    console.log('   no edit at all — open, save, reopen, render. A non-zero answer here is a');
    console.log('   defect no editing test could ever attribute, because every one changes');
    console.log('   something. FPDF_SaveAsCopy is a full rewrite, and ENGINE-SPIKE:157 says');
    console.log('   a full rewrite is where non-embedded font references go.');
    const untouched = saveAsCopy(api, document);
    console.log(`  original ${String(original.length)} bytes → saved ${String(untouched.length)} bytes`);
    const reopened = api.loadDocument(untouched, untouched.length, null);
    if (reopened === null) throw new Error('PDFium could not reopen what it just saved');
    const reopenedPage = api.loadPage(reopened, 0);
    const after = render(api, reopenedPage);
    const untouchedDiff = compare(before, after);
    console.log(
      `  pixels differing: ${String(untouchedDiff.differing)} of ${String(before.grey.length)}` +
        `, worst ${String(untouchedDiff.worst)} levels`,
    );
    console.log(`  text after the untouched save: ${JSON.stringify(pageText(api, reopenedPage))}`);
    api.closePage(reopenedPage);
    api.closeDocument(reopened);
    console.log('');

    console.log('## 4. Whether an edit survives, and what else moved');
    console.log('   read back from a REOPENED document: a setter agreeing with itself says');
    console.log('   nothing about what was stored');
    let edited = -1;
    for (let at = 0; at < objects && edited === -1; at += 1) {
      const object = api.getObject(page, at);
      if (api.objectType(object) !== 1) continue;
      const text = pageText(api, page);
      if (!text.includes('SECOND')) break;
      // The second text object, found by position rather than by reading each
      // object's own string — FPDFTextObj_GetText needs a text page and this is
      // asking whether SetText works, not whether the finder does.
      if (at !== 1) continue;
      const ok = api.setText(object, wideString('SECOND RUN has been replaced'));
      console.log(
        `  FPDFText_SetText on object ${String(at)}: ${ok === 1 ? 'accepted' : `REFUSED (${String(ok)})`}`,
      );
      edited = at;
    }
    if (edited === -1) console.log('  no text object was edited');

    const generated = api.generateContent(page);
    console.log(`  FPDFPage_GenerateContent: ${generated === 1 ? 'ok' : `FAILED (${String(generated)})`}`);

    const editedBytes = saveAsCopy(api, document);
    const editedDocument = api.loadDocument(editedBytes, editedBytes.length, null);
    if (editedDocument === null) throw new Error('PDFium could not reopen the edited copy');
    const editedPage = api.loadPage(editedDocument, 0);
    console.log(`  text after the edit: ${JSON.stringify(pageText(api, editedPage))}`);

    // THE CALIBRATION §3 NEEDS. A comparator reporting zero for everything gives
    // §3 the answer it was hoping for; this run must report a large number, or
    // §3's zero is a fact about the comparator.
    const editedRender = render(api, editedPage);
    const editedDiff = compare(before, editedRender);
    console.log(
      `  pixels differing over the whole page: ${String(editedDiff.differing)}` +
        `, worst ${String(editedDiff.worst)} levels`,
    );
    if (editedDiff.differing === 0) {
      throw new Error(
        'an edited page renders identically to the original, so either the edit did nothing ' +
          "or the comparator cannot see it — and §3's zero would mean neither thing",
      );
    }

    // AND WHAT ELSE MOVED, which is the claim a fidelity proof makes and the
    // one the whole-page count cannot separate: the two untouched runs are
    // outside the edited band, so any difference there is a redraw of text
    // nothing asked to change.
    const inside = compare(before, editedRender, EDITED_BAND);
    const above = compare(before, editedRender, { from: 0, to: EDITED_BAND.from });
    const below = compare(before, editedRender, { from: EDITED_BAND.to, to: editedRender.height });
    console.log(
      `  device rows ${String(EDITED_BAND.from)}–${String(EDITED_BAND.to)} (the edited run): ` +
        `${String(inside.differing)} differing`,
    );
    console.log(
      `  above it (FIRST RUN): ${String(above.differing)} differing, worst ` +
        `${String(above.worst)} — below it (THIRD RUN): ${String(below.differing)} differing, ` +
        `worst ${String(below.worst)}`,
    );
    api.closePage(editedPage);
    api.closeDocument(editedDocument);
    api.closePage(page);
    api.closeDocument(document);
    console.log('');

    corpusUntouchedSave(api);
  } finally {
    api.destroy();
  }
}

/**
 * §3 again, over documents this build did not write.
 *
 * ## Why the synthetic fixture cannot answer this on its own
 *
 * §3's page is 1.2 KB from one producer with three standard-font text objects
 * and nothing else. Its zero is real and it is a fact about the easy shape. The
 * question `BUILD-PROMPT.md`:706 actually asks is whether a save silently
 * redraws content, and the content that could be silently redrawn — embedded
 * subsets, images, transparency groups, annotation appearance streams, shadings
 * — is exactly what a hand-built fixture does not have.
 *
 * Three producers across three PDF versions is enough to catch a gross failure
 * and not enough to tune anything, which is what {@link corpusCaveat} prints
 * beside every figure.
 *
 * Nothing from a corpus document is quoted here, and that is structural rather
 * than careful: `openCorpus` hands out an opaque id and bytes, so there is no
 * filename in scope to print by accident.
 *
 * @param {ReturnType<typeof bind>} api
 */
function corpusUntouchedSave(api) {
  console.log('## 5. The same question over the supplied corpus');
  console.log('   §3 is one synthetic page from one producer. Embedded subsets, images,');
  console.log('   transparency and appearance streams are what a full rewrite loses, and a');
  console.log('   hand-built fixture has none of them.');

  const corpus = openCorpus();
  if (!corpus.available) {
    // NOT A PASS, and the text says so in the words every other could-not-look
    // in this repository uses. A silence here is indistinguishable from a clean
    // corpus, which is the answer this section was hoping for.
    process.stdout.write(corpus.outcome.text);
    return;
  }

  console.log(`   documents: ${String(corpus.documents.length)}`);
  console.log('   THE INK COLUMN IS WHY THE ZEROS MEAN ANYTHING: a page PDFium failed to draw');
  console.log('   renders white, and white differs from white by nothing. A blank render and a');
  console.log('   perfectly preserved one produce the same 0 in the column beside it.');
  console.log('  id          pages  bytes → saved        differing / total   worst   ink');
  let anyInk = false;
  for (const item of corpus.documents) {
    const document = api.loadDocument(item.bytes, item.size, null);
    if (document === null) {
      console.log(`  ${item.id.padEnd(11)} PDFium refused it`);
      continue;
    }
    try {
      const pages = api.pageCount(document);
      const page = api.loadPage(document, 0);
      const before = renderAnyPage(api, page);

      const saved = saveAsCopy(api, document);
      const reopened = api.loadDocument(saved, saved.length, null);
      if (reopened === null) {
        console.log(`  ${item.id.padEnd(11)} PDFium could not reopen what it saved`);
        api.closePage(page);
        continue;
      }
      const reopenedPage = api.loadPage(reopened, 0);
      const after = renderAnyPage(api, reopenedPage);
      const { differing, worst } = compare(before, after);
      let inked = 0;
      for (const sample of before.grey) if (sample < 250) inked += 1;
      const ink = inked / before.grey.length;
      if (ink >= 0.001) anyInk = true;
      console.log(
        `  ${item.id.padEnd(11)} ${String(pages).padStart(5)}  ` +
          `${String(item.size).padStart(8)} → ${String(saved.length).padEnd(9)} ` +
          `${String(differing).padStart(9)} / ${String(before.grey.length).padEnd(9)} ` +
          `${String(worst).padStart(5)}  ${(ink * 100).toFixed(2)}%`,
      );
      api.closePage(reopenedPage);
      api.closeDocument(reopened);
      api.closePage(page);
    } finally {
      api.closeDocument(document);
    }
  }
  // A SINGLE BLANK PAGE IS A DOCUMENT'S BUSINESS; ALL OF THEM BLANK IS THIS
  // SCRIPT'S. If nothing rendered, every zero above is a comparison between two
  // white rectangles and the section measured nothing at all.
  if (!anyInk) {
    throw new Error(
      'every corpus document rendered a blank first page, so the zero differences above are ' +
        'two white rectangles agreeing rather than a save preserving anything',
    );
  }
  console.log(corpusCaveat(corpus.documents.length));
}

await main();
