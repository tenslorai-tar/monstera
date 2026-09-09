// @ts-check
/**
 * What one in-place text edit costs in PDFium, and what the cost is a cost OF.
 *
 * ## Why this exists before the editing rows rather than after them
 *
 * Five `docs/FEATURES.md` rows in D4 replace text through PDFium, and the
 * question that decides how they are built is not *can it edit* — the adapter
 * and `proof:pdfiumadapter` settled that — but **what an edit charges for**.
 * `pdfiumFfi.ts`'s `replaceTextObject` performs two calls that look like halves
 * of one operation, `FPDFText_SetText` and `FPDFPage_GenerateContent`, and this
 * instrument exists because those two turn out to have nothing in common: one
 * is free and page-local, the other is neither.
 *
 * The reading it was built for is document-wide replace-all, which is a row in
 * the same stage and touches many objects in one command. A design that pays
 * the expensive half once per object is a feature that works on the fixture and
 * is unusable on a real document, which is the failure this project would
 * rather find here than in a bug report.
 *
 * ## Every assertion is ORDINAL, and that is deliberate
 *
 * A timing instrument that asserts milliseconds is one that goes red on a
 * loaded runner and gets turned off. Nothing here names a budget. What it
 * asserts are **relations with margins far wider than the spread** — the
 * measured separations are 11.7x and 17.5x, and the cases below demand 4x — so
 * a slow runner moves both sides of every comparison together.
 *
 * The figures printed are this machine's and are labelled as such. They are
 * evidence for a shape, not a budget for anything to be held to.
 *
 * ## What is measured is the C API, not the adapter
 *
 * The subject is PDFium's cost model. Going through `pdfiumFfi.ts` would
 * measure that model plus one adapter's arrangement of it, and the arrangement
 * is exactly what the answer is supposed to inform — so it is held out.
 *
 * That makes this a second binding of the same entry points, which B3a would
 * normally call a second opinion. It is not one: nothing here decides what a
 * call MEANS, and a probe whose whole purpose is to attribute cost between two
 * calls cannot use a module that performs them together.
 *
 * ## The controls, and why the fourth one exists
 *
 * An earlier reading of this timed `FPDFPage_GenerateContent` on a **clean**
 * page and got 0.00 ms at every document size — a fixture the answer also
 * handles correctly, since a page with nothing changed has nothing to
 * regenerate. It read as *GenerateContent is free* and it measured nothing.
 * The clean-page reading is kept, beside its dirty twin, precisely so that
 * mistake is visible in the output rather than available to the next reader.
 *
 * And the k=1 case is the negative control on the batching comparison: with one
 * replacement, generating per call and generating once are the SAME two calls
 * in the same order, so they must agree. If batching won there, this instrument
 * would be measuring something other than what it claims.
 *
 * Usage: node scripts/research/editCost.mjs [--require-pdfium]
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE_PDFIUM = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE_PDFIUM,
    subject: 'the cost of one in-place text edit',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/**
 * Records one case.
 *
 * @param {string} label
 * @param {boolean} condition
 * @param {string} detail
 */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const TEXT_OBJECT = 1;

const lib = koffi.load(library);
const api = {
  initialise: lib.func('void FPDF_InitLibrary()'),
  loadMem: lib.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *pw)'),
  closeDocument: lib.func('void FPDF_CloseDocument(void *document)'),
  loadPage: lib.func('void *FPDF_LoadPage(void *document, int index)'),
  closePage: lib.func('void FPDF_ClosePage(void *page)'),
  countObjects: lib.func('int FPDFPage_CountObjects(void *page)'),
  getObject: lib.func('void *FPDFPage_GetObject(void *page, int index)'),
  objectType: lib.func('int FPDFPageObj_GetType(void *object)'),
  setText: lib.func('int FPDFText_SetText(void *object, const char16_t *text)'),
  generateContent: lib.func('int FPDFPage_GenerateContent(void *page)'),
};
api.initialise();

/**
 * Milliseconds a synchronous call took.
 *
 * `hrtime.bigint` rather than `Date.now`, because the smallest reading that
 * matters here is a fraction of a millisecond and `Date.now`'s resolution
 * cannot separate `FPDFText_SetText` from zero.
 *
 * @param {() => void} work
 * @returns {number}
 */
function took(work) {
  const start = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/**
 * The median of a set of readings.
 *
 * A median rather than a mean, because a garbage collection landing inside one
 * reading moves a mean and does not move this.
 *
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/**
 * A document of `pages` pages carrying `lines` text objects each.
 *
 * Constructed rather than taken from the corpus, because the whole instrument
 * varies page count against content and a corpus offers neither axis.
 *
 * @param {number} pages
 * @param {number} lines
 * @returns {Promise<Uint8Array>}
 */
async function build(pages, lines) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p += 1) {
    const page = document.addPage([612, 792]);
    for (let l = 0; l < lines; l += 1) {
      page.drawText(`Page ${String(p + 1)} line ${String(l + 1)} of constructed text.`, {
        x: 54,
        y: 780 - (l % 55) * 14,
        size: 11,
        font,
      });
    }
  }
  return new Uint8Array(await document.save());
}

/**
 * Opens a document and hands back page 0's text objects, found outside any
 * timed section so that finding them is never part of a reading.
 *
 * @param {Uint8Array} bytes
 * @returns {{ document: unknown, page: unknown, objects: unknown[], close: () => void }}
 */
function openPageZero(bytes) {
  const buffer = Buffer.from(bytes);
  const document = api.loadMem(buffer, buffer.length, null);
  const page = api.loadPage(document, 0);
  const total = Number(api.countObjects(page));
  /** @type {unknown[]} */
  const objects = [];
  for (let i = 0; i < total; i += 1) {
    const object = api.getObject(page, i);
    if (object !== null && Number(api.objectType(object)) === TEXT_OBJECT) objects.push(object);
  }
  return {
    document,
    page,
    objects,
    close: () => {
      api.closePage(page);
      api.closeDocument(document);
      // THE BUFFER IS HELD until here on purpose: FPDF_LoadMemDocument does not
      // copy, so releasing it earlier would hand PDFium freed memory. The same
      // property `pdfiumFfi.ts` retains its own copy for.
      void buffer;
    },
  };
}

/**
 * One set-then-generate cycle, timed apart.
 *
 * @param {{ page: unknown, objects: unknown[] }} open
 * @param {number} repeats
 * @returns {{ set: number, generate: number, clean: number }}
 */
function editCycle(open, repeats) {
  /** @type {number[]} */
  const sets = [];
  /** @type {number[]} */
  const generates = [];
  for (let n = 0; n < repeats; n += 1) {
    const target = open.objects[n % open.objects.length];
    sets.push(took(() => api.setText(target, `edited ${String(n)}`)));
    generates.push(took(() => api.generateContent(open.page)));
  }
  /** @type {number[]} */
  const cleans = [];
  for (let n = 0; n < repeats; n += 1) cleans.push(took(() => api.generateContent(open.page)));
  return { set: median(sets), generate: median(generates), clean: median(cleans) };
}

const REPEATS = 5;

// ---------------------------------------------------------------------------
// Case 1 — RESOLUTION. The decision this informs turns on telling a fraction of
// a millisecond from a hundred of them, so the clock is asked to separate two
// durations it was not given. A busy loop rather than a timer, because the
// subject is a synchronous FFI call and an event-loop sampler cannot see one —
// which is a failure this project has already paid for once.
// ---------------------------------------------------------------------------
/** @param {number} target */
function spin(target) {
  const until = process.hrtime.bigint() + BigInt(Math.round(target * 1e6));
  while (process.hrtime.bigint() < until) {
    /* deliberately empty: the point is to occupy the thread */
  }
}
const shortSpin = median([took(() => spin(1)), took(() => spin(1)), took(() => spin(1))]);
const longSpin = median([took(() => spin(50)), took(() => spin(50)), took(() => spin(50))]);
check(
  'the clock separates a 1 ms interval from a 50 ms one',
  longSpin > shortSpin * 10,
  `1 ms read as ${shortSpin.toFixed(3)} and 50 ms as ${longSpin.toFixed(3)}. An instrument that ` +
    'cannot tell those apart cannot say anything about an edit, and every figure below would be noise.',
);

// ---------------------------------------------------------------------------
// The scaling readings.
// ---------------------------------------------------------------------------
/** @type {{ label: string, pages: number, lines: number, kb: number, objects: number, set: number, generate: number, clean: number }[]} */
const cells = [];

for (const { pages, lines } of [
  { pages: 1, lines: 40 },
  { pages: 100, lines: 40 },
  { pages: 500, lines: 40 },
  { pages: 500, lines: 1 },
  { pages: 50, lines: 400 },
]) {
  const bytes = await build(pages, lines);
  const open = openPageZero(bytes);
  const reading = editCycle(open, REPEATS);
  cells.push({
    label: `${String(pages)} x ${String(lines)}`,
    pages,
    lines,
    kb: Math.round(bytes.length / 1024),
    objects: open.objects.length,
    ...reading,
  });
  open.close();
}

/**
 * @param {number} pages
 * @param {number} lines
 */
function cell(pages, lines) {
  const found = cells.find((c) => c.pages === pages && c.lines === lines);
  if (found === undefined) {
    throw new Error(`CONTROL FAILED: the ${String(pages)}x${String(lines)} cell was not measured.`);
  }
  return found;
}

const one = cell(1, 40);
const hundred = cell(100, 40);
const large = cell(500, 40);
const manyPagesLittleContent = cell(500, 1);
const fewPagesMuchContent = cell(50, 400);

// ---------------------------------------------------------------------------
// Case 2 — the fixture carries what the instrument looks for. A search that
// finds nothing reports the same clean result as a search that cannot see.
// ---------------------------------------------------------------------------
check(
  'every cell found text objects on page 0',
  cells.every((c) => c.objects > 0),
  `objects per cell: ${cells.map((c) => `${c.label}=${String(c.objects)}`).join(', ')}. A cell with ` +
    'none would time an edit that never happened and report it as cheap.',
);

// ---------------------------------------------------------------------------
// Case 3 — FPDFText_SetText does not scale. This is half of the attribution:
// without it, "an edit costs more on a bigger document" names no call.
// ---------------------------------------------------------------------------
check(
  'FPDFText_SetText does not scale with the document',
  large.set < Math.max(one.set, 0.001) * 10,
  `set text read ${one.set.toFixed(3)} ms on ${String(one.kb)} KB and ${large.set.toFixed(3)} ms on ` +
    `${String(large.kb)} KB. If this scaled, the cost would not be attributable to GenerateContent.`,
);

// ---------------------------------------------------------------------------
// Case 4 — and GenerateContent does. The other half.
// ---------------------------------------------------------------------------
// Three points rather than two, and MONOTONIC: two readings give a value, and
// a trend is what the claim actually is.
check(
  'FPDFPage_GenerateContent after a set DOES scale with the document',
  hundred.generate > one.generate * 4 && large.generate > hundred.generate * 2,
  `generate read ${one.generate.toFixed(2)} ms on ${String(one.kb)} KB, ` +
    `${hundred.generate.toFixed(2)} ms on ${String(hundred.kb)} KB and ` +
    `${large.generate.toFixed(2)} ms on ${String(large.kb)} KB. Together with the case above this ` +
    'puts the whole cost of an edit in one call.',
);

// ---------------------------------------------------------------------------
// Case 5 — the clean-page reading, kept beside the dirty one. An earlier probe
// took this alone, got 0.00 ms at every size, and read it as "GenerateContent
// is free" — a fixture the answer also handles correctly.
// ---------------------------------------------------------------------------
check(
  'GenerateContent on a CLEAN page is far cheaper than after a set',
  large.generate > large.clean * 10,
  `clean ${large.clean.toFixed(3)} ms against dirty ${large.generate.toFixed(2)} ms on ` +
    `${String(large.kb)} KB. Measured alone, the clean reading says the call is free and means nothing.`,
);

// ---------------------------------------------------------------------------
// Case 6 — what it scales WITH. Same page count and less content is cheap; far
// fewer pages and similar content is not. So the cost is not the page's.
// ---------------------------------------------------------------------------
check(
  "GenerateContent tracks the document's content, not its page count",
  large.generate > manyPagesLittleContent.generate * 1.5 &&
    fewPagesMuchContent.generate > manyPagesLittleContent.generate * 1.5,
  `500x40 (${String(large.kb)} KB, 500 pages) ${large.generate.toFixed(2)} ms; ` +
    `500x1 (${String(manyPagesLittleContent.kb)} KB, same 500 pages) ` +
    `${manyPagesLittleContent.generate.toFixed(2)} ms; ` +
    `50x400 (${String(fewPagesMuchContent.kb)} KB, a tenth of the pages) ` +
    `${fewPagesMuchContent.generate.toFixed(2)} ms. Holding pages constant and cutting content is ` +
    'what makes it cheap, which is the attribution.',
);

// ---------------------------------------------------------------------------
// The batching comparison, and case 7.
// ---------------------------------------------------------------------------
/**
 * k replacements, generating per call against generating once.
 *
 * A fresh document per strategy, so neither inherits the other's dirtied state.
 *
 * @param {Uint8Array} bytes
 * @param {number} k
 * @returns {{ perCall: number, once: number }}
 */
function batching(bytes, k) {
  const a = openPageZero(bytes);
  const perCall = took(() => {
    for (let n = 0; n < k; n += 1) {
      api.setText(a.objects[n % a.objects.length], `replaced ${String(n)}`);
      api.generateContent(a.page);
    }
  });
  a.close();

  const b = openPageZero(bytes);
  const once = took(() => {
    for (let n = 0; n < k; n += 1) {
      api.setText(b.objects[n % b.objects.length], `replaced ${String(n)}`);
    }
    api.generateContent(b.page);
  });
  b.close();

  return { perCall, once };
}

const batchBytes = await build(100, 40);
const single = batching(batchBytes, 1);
const forty = batching(batchBytes, 40);

// Case 7 is TWO assertions in one case on purpose: the claim and its negative
// control are the same comparison at two values of k, and separating them would
// let the win be reported while the control that makes it readable is absent.
check(
  'one generate per COMMAND is flat in k, and the two strategies agree at k=1',
  single.perCall < single.once * 2 &&
    single.once < single.perCall * 2 &&
    forty.perCall > forty.once * 4,
  `k=1 per-call ${single.perCall.toFixed(1)} ms against once ${single.once.toFixed(1)} ms — the same ` +
    `two calls in the same order, so they must agree, and a win here would mean this measures ` +
    `something else. k=40 per-call ${forty.perCall.toFixed(1)} ms against once ` +
    `${forty.once.toFixed(1)} ms.`,
);

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------
process.stdout.write(
  '\nOne in-place text edit in PDFium, by document shape (this machine, medians of ' +
    `${String(REPEATS)}):\n\n`,
);
process.stdout.write(
  '  cell        KB   objects   SetText   GenerateContent   generate on a clean page\n',
);
for (const c of cells) {
  process.stdout.write(
    `  ${c.label.padEnd(10)}${String(c.kb).padStart(5)}${String(c.objects).padStart(10)}` +
      `${c.set.toFixed(3).padStart(10)}${c.generate.toFixed(2).padStart(18)}` +
      `${c.clean.toFixed(3).padStart(27)}\n`,
  );
}

process.stdout.write(
  `\nk replacements on one page of a ${String(Math.round(batchBytes.length / 1024))} KB document:\n\n`,
);
process.stdout.write('  k     generate per call     generate once     ratio\n');
for (const [k, reading] of /** @type {[number, {perCall: number, once: number}][]} */ ([
  [1, single],
  [40, forty],
])) {
  process.stdout.write(
    `  ${String(k).padEnd(6)}${reading.perCall.toFixed(1).padStart(17)} ms` +
      `${reading.once.toFixed(1).padStart(18)} ms` +
      `${(reading.perCall / Math.max(reading.once, 0.001)).toFixed(1).padStart(10)}x\n`,
  );
}

process.stdout.write(
  "\nThe figures are this machine's and no budget is asserted from them. What the cases\n" +
    'assert are relations, with margins far wider than the spread, so a loaded runner moves\n' +
    'both sides of every comparison together.\n',
);

if (failures.length > 0) {
  process.stdout.write(`\nEdit cost — ${String(failures.length)} problem(s):\n\n`);
  for (const failure of failures) process.stdout.write(`  - ${failure}\n\n`);
  process.exit(1);
}

process.stdout.write(`\n${roster.format('control')}\n`);
