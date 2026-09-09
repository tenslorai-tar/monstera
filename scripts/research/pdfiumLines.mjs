// @ts-check
/**
 * Does PDFium group a page's text into LINES, and can a line be mapped back to
 * the page objects an edit replaces?
 *
 * ## The question, and why it decides a row rather than a detail
 *
 * `docs/FEATURES.md`'s *in-place text editing: line-level* row is *visual line
 * clustering, run diffing*. The tempting build is a clusterer of our own over
 * `FPDFPageObj_GetBounds`, and
 * [ADR-0034](../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
 * decided in advance what that would cost: *"a post-pass that reads GEOMETRY to
 * decide grouping is a second extraction path"*, and the test it left is one
 * question — **does it read a coordinate?**
 *
 * That ADR's own answer, for the reading engine, is that the substrate owns the
 * engine's options and implements no clustering. This asks whether the same
 * answer is available for the editing engine: **does PDFium group text itself,
 * and does it say which page object a grouped character came from?**
 *
 * If it does, line-level editing consumes an engine's answer exactly as
 * extraction does, and nothing here owns a constant. If it does not, the row
 * takes ADR-0034's route 2 or 3 and owes an ADR.
 *
 * ## What is measured
 *
 * `scripts/research/pdfiumTextExports.mjs` names the three families the pinned
 * DLL exports, and two entries in them are the whole question:
 *
 * - `FPDFText_CountRects` / `FPDFText_GetRect` — PDFium's own grouping of a
 *   character range into rectangles;
 * - `FPDFText_GetTextObject` — the page object a character belongs to.
 *
 * Neither is bound in `pdfiumFfi.ts`, so they are bound here first and moved
 * there only if this says they answer. A binding written into the adapter before
 * anything drove it would be the shape this project calls a declaration nothing
 * can contradict.
 *
 * ## The fixture makes the answer checkable rather than plausible
 *
 * Three runs on three baselines, plus **two runs sharing one baseline** — which
 * is the case the whole row turns on. A grouping that answers *one rect per
 * text object* has told us nothing (we already have objects); a grouping that
 * puts the two same-baseline runs in one rect and the others in their own is a
 * line grouping. The rectangle is there so a non-text object is in the page.
 *
 * Usage: node scripts/research/pdfiumLines.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { formatError } from '../lib/reportError.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const library = pdfiumLibrary(REPO_ROOT);
if (!existsSync(library)) {
  process.stderr.write(
    `\nNo PDFium at ${library}. Run \`npm run provision:pdfium\` — it fetches the pinned ` +
      `${PDFIUM_VERSION} build and verifies it against a recorded SHA-256.\n`,
  );
  process.exit(1);
}

const lib = koffi.load(library);

const InitLibrary = lib.func('void FPDF_InitLibrary()');
const LoadMemDocument = lib.func('void *FPDF_LoadMemDocument(const void *buf, int size, const char *pw)');
const LoadPage = lib.func('void *FPDF_LoadPage(void *doc, int index)');
const ClosePage = lib.func('void FPDF_ClosePage(void *page)');
const CloseDocument = lib.func('void FPDF_CloseDocument(void *doc)');
const CountObjects = lib.func('int FPDFPage_CountObjects(void *page)');
const GetObject = lib.func('void *FPDFPage_GetObject(void *page, int index)');
const TextLoadPage = lib.func('void *FPDFText_LoadPage(void *page)');
const TextClosePage = lib.func('void FPDFText_ClosePage(void *tp)');
const CountChars = lib.func('int FPDFText_CountChars(void *tp)');
const CountRects = lib.func('int FPDFText_CountRects(void *tp, int start, int count)');
const GetRect = lib.func(
  'int FPDFText_GetRect(void *tp, int index, _Out_ double *left, _Out_ double *top, _Out_ double *right, _Out_ double *bottom)',
);
const GetBoundedText = lib.func(
  'int FPDFText_GetBoundedText(void *tp, double left, double top, double right, double bottom, _Out_ uint16_t *buffer, int length)',
);
// THE LINK THIS SCRIPT EXISTS TO TEST. It answers the page object a character
// belongs to, which is the mapping a line-level edit needs and the one nothing
// in this repository had looked for.
const GetTextObject = lib.func('void *FPDFText_GetTextObject(void *tp, int index)');

InitLibrary();

/**
 * @param {number} secondX where the second run on the shared baseline starts
 * @returns {Promise<Uint8Array>}
 */
async function fixture(secondX) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 120, height: 40, color: rgb(0.2, 0.4, 0.9) });
  page.drawText('LEFT HALF', { x: 30, y: 230, size: 11, font });
  // SAME y, so this and the run above are one visual line and two objects.
  page.drawText('RIGHT HALF', { x: secondX, y: 230, size: 11, font });
  page.drawText('SECOND LINE', { x: 30, y: 190, size: 11, font });
  page.drawText('THIRD LINE', { x: 30, y: 150, size: 11, font });
  return document.save();
}

/** @param {Uint8Array} buffer @param {number} units */
function decode(buffer, units) {
  const view = new Uint16Array(buffer.buffer, buffer.byteOffset, units);
  let text = '';
  for (const unit of view) {
    if (unit === 0) break;
    text += String.fromCharCode(unit);
  }
  return text;
}

/**
 * Runs one fixture and prints what PDFium said about it.
 *
 * TWO SEPARATIONS, and the pair is the measurement rather than either alone: a
 * grouper that merges an ADJACENT run and splits a FAR one is answering *what
 * belongs together*, which is a line grouping; one that gives the same count for
 * both is answering *one rect per run*, which is a restatement of the object
 * list and tells an editor nothing it did not have.
 *
 * @param {number} secondX
 * @param {string} label
 */
async function report(secondX, label) {
  const bytes = await fixture(secondX);
  const document = LoadMemDocument(bytes, bytes.length, null);
  const page = LoadPage(document, 0);
  const textPage = TextLoadPage(page);

  const objects = CountObjects(page);
  const chars = CountChars(textPage);
  const rects = CountRects(textPage, 0, -1);

  process.stdout.write(
    `## ${label}\n\n` +
      `  page objects (FPDFPage_CountObjects): ${String(objects)}\n` +
      `  characters   (FPDFText_CountChars):   ${String(chars)}\n` +
      `  RECTS        (FPDFText_CountRects):   ${String(rects)}\n\n` +
      `  Four text runs, two sharing a baseline, plus a rectangle: 5 objects.\n` +
      `  4 rects means one per RUN — no grouping. 3 means the two sharing a\n` +
      `  baseline were merged, which is a LINE grouping.\n\n`,
  );

  // The page objects, by index, so a mapping can be read as an index rather
  // than as a pointer.
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  for (let at = 0; at < objects; at += 1) {
    indexOf.set(String(koffi.address(GetObject(page, at))), at);
  }

  for (let rect = 0; rect < rects; rect += 1) {
    const left = [0];
    const top = [0];
    const right = [0];
    const bottom = [0];
    GetRect(textPage, rect, left, top, right, bottom);

    // NAMED, and not because the compiler asks. A koffi `_Out_ double *` is a
    // one-element array, so every read is `[0]` and every one of them is
    // `number | undefined` to the checker — four suppressions on one line, or
    // four names that also say what the number is.
    const [l = 0] = left;
    const [t = 0] = top;
    const [r = 0] = right;
    const [b = 0] = bottom;

    const buffer = Buffer.alloc(4096);
    const units = GetBoundedText(textPage, l, t, r, b, buffer, 2047);
    process.stdout.write(
      `  rect ${String(rect)}  ` +
        `[${l.toFixed(1)}, ${b.toFixed(1)} .. ${r.toFixed(1)}, ${t.toFixed(1)}]  ` +
        `${JSON.stringify(decode(buffer, units))}\n`,
    );
  }

  // THE MAPPING, character by character: which page object each character came
  // from. Printed as the SET of object indices per rect, which is what a
  // line-level edit would replace.
  process.stdout.write('\n  FPDFText_GetTextObject — character -> page object index\n');
  /** @type {Map<number, Set<number>>} */
  const perRect = new Map();
  for (let at = 0; at < chars; at += 1) {
    const object = GetTextObject(textPage, at);
    const address = String(koffi.address(object));
    const index = indexOf.get(address);
    // Which rect this character falls in is not asked of us either: a character
    // belongs to the rect whose bounds contain its own box, and PDFium answers
    // both. This walk keeps it simple and groups by object, then reports.
    const key = index ?? -1;
    const seen = perRect.get(key) ?? new Set();
    seen.add(at);
    perRect.set(key, seen);
  }
  for (const [index, positions] of [...perRect.entries()].sort((a, b) => a[0] - b[0])) {
    process.stdout.write(
      `  object index ${String(index).padStart(2)}  ` +
        `characters ${String(positions.size).padStart(3)}\n`,
    );
  }
  process.stdout.write(
    `\n  -1 means FPDFText_GetTextObject answered a pointer that is not one of this\n` +
      `  page's objects. PDFium inserts GENERATED characters — spaces it believes are\n` +
      `  implied by spacing rather than drawn — and those belong to no object;\n` +
      `  FPDFText_IsGenerated is how it says which. A mapping that reported them as\n` +
      `  object 0 would attribute text to whatever the page's first object happens\n` +
      `  to be.\n\n`,
  );

  TextClosePage(textPage);
  ClosePage(page);
  CloseDocument(document);
}

try {
  process.stdout.write(`# PDFium ${PDFIUM_VERSION} — does it group text into lines?\n\n`);
  await report(200, 'FAR APART — the two shared-baseline runs are 170pt apart');
  await report(90, 'ADJACENT — the same two runs, a few points apart');
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
