// @ts-check
/**
 * What does PDFium actually do when a page OBJECT is moved, scaled, recoloured
 * or deleted?
 *
 * ## The question, and why it decides the row's payload rather than a detail
 *
 * `docs/FEATURES.md`'s *object-level edit (move / scale / recolor / delete any
 * page object)* row names four operations, and the shape of the command that
 * carries them depends on facts nobody here has read off the library:
 *
 * - **Does a transform compose or replace?** `FPDFPageObj_Transform` and
 *   `FPDFPageObj_SetMatrix` are both exported. If `Transform` composes onto the
 *   object's existing matrix then a move is `Transform(1,0,0,1,dx,dy)` and the
 *   inverse is a `SetMatrix` of what was there — a RESTORE, which ADR-0009 §3
 *   requires. If it replaces, the payload means something else entirely.
 * - **What does a scale scale ABOUT?** A matrix scales about the coordinate
 *   system's origin, which for a page is its bottom-left corner — so an object
 *   at x=400 scaled by 2 lands at x=800, which is never what a person dragging
 *   a handle means. If that is what happens, the kernel owes a compose
 *   (translate to the object, scale, translate back) and the payload is an
 *   intent rather than a matrix.
 * - **Does a text object have a matrix at all, and does `GetBounds` move with
 *   it?** The bounds are what a surface would draw a handle on.
 * - **Does `SetFillColor` reach a TEXT object, or only a path?** The row says
 *   *any page object*, and the fidelity comparator reads luminance since
 *   CCCCCC-3, so a black-to-red recolor is visible to it — but only if the call
 *   applies to the object kind a person is most likely to recolour.
 * - **Does a delete need `FPDFPageObj_Destroy` after `FPDFPage_RemoveObject`,
 *   and can it be undone?** If the object cannot be reconstructed from anything
 *   a capture may hold, the command is a CHECKPOINT one and its declaration
 *   differs from its three siblings — which is a fact about the command table,
 *   not about the UI.
 * - **Does each of these need `FPDFPage_GenerateContent` to reach the saved
 *   bytes?** ADR-0047 Decision 2 made generation per COMMAND rather than per
 *   object; a call that needs no generation at all would change what that costs.
 *
 * ## Nothing here is bound in `pdfiumFfi.ts` yet, deliberately
 *
 * `pdfiumLines.mjs`' rule: a binding written into the adapter before anything
 * drove it is a declaration nothing can contradict. These are bound here, and
 * only what answers moves.
 *
 * ## Every reading is taken from REOPENED bytes, not from the live session
 *
 * A getter that answers what the setter was given proves nothing about what was
 * stored — this project has that written down as its own finding. So each
 * operation is applied, serialised, and read back through a second open.
 *
 * Usage: node scripts/research/pdfiumObjects.mjs
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
const GetObjectType = lib.func('int FPDFPageObj_GetType(void *object)');
const GenerateContent = lib.func('int FPDFPage_GenerateContent(void *page)');
const GetBounds = lib.func(
  'int FPDFPageObj_GetBounds(void *object, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)',
);
// THE MATRIX PAIR. koffi passes a struct by value only if it is declared, so
// FS_MATRIX is declared here rather than passed as six floats.
koffi.struct('FS_MATRIX', {
  a: 'float',
  b: 'float',
  c: 'float',
  d: 'float',
  e: 'float',
  f: 'float',
});
const GetMatrix = lib.func('int FPDFPageObj_GetMatrix(void *object, _Out_ FS_MATRIX *matrix)');
const SetMatrix = lib.func('int FPDFPageObj_SetMatrix(void *object, const FS_MATRIX *matrix)');
const Transform = lib.func(
  'void FPDFPageObj_Transform(void *object, double a, double b, double c, double d, double e, double f)',
);
const GetFillColor = lib.func(
  'int FPDFPageObj_GetFillColor(void *object, _Out_ unsigned int *r, _Out_ unsigned int *g, _Out_ unsigned int *b, _Out_ unsigned int *a)',
);
const SetFillColor = lib.func(
  'int FPDFPageObj_SetFillColor(void *object, unsigned int r, unsigned int g, unsigned int b, unsigned int a)',
);
const RemoveObject = lib.func('int FPDFPage_RemoveObject(void *page, void *object)');
const DestroyObject = lib.func('void FPDFPageObj_Destroy(void *object)');
const SaveWithVersion = lib.func('int FPDF_SaveWithVersion(void *doc, void *writer, int flags, int version)');

InitLibrary();

/** `FPDF_PAGEOBJ_*`, so a type number reads as a word in the output. */
const OBJECT_KINDS = ['unknown', 'text', 'path', 'image', 'shading', 'form'];

/**
 * A page with one text run, one filled rectangle and one more text run.
 *
 * The rectangle is deliberately NOT at the origin: a scale about the page's
 * corner and a scale about the object's own are indistinguishable for a shape
 * sitting at (0, 0), which is the fixture the bug also handles correctly.
 */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('FIRST RUN', { x: 30, y: 230, size: 11, font });
  page.drawRectangle({ x: 200, y: 100, width: 120, height: 40, color: rgb(0, 0, 0) });
  page.drawText('SECOND RUN', { x: 30, y: 60, size: 11, font });
  return document.save();
}

// DECLARED ONCE. koffi registers a proto by NAME, so declaring it inside the
// function below throws `Duplicate type name` on the second serialise — which
// is what the first run of this script did.
const WriteBlock = koffi.pointer(
  koffi.proto('int WriteBlock(void *self, const void *data, unsigned long size)'),
);

/**
 * Serialises a document through PDFium's own writer, into a Uint8Array.
 *
 * @param {unknown} document
 * @returns {Uint8Array}
 */
function serialise(document) {
  /** @type {number[]} */
  const chunks = [];
  const writeBlock = koffi.register(
    /** @param {unknown} _self @param {unknown} data @param {number} size */
    (_self, data, size) => {
      chunks.push(...koffi.decode(data, 'unsigned char', size));
      return 1;
    },
    WriteBlock,
  );
  const writer = koffi.alloc('void *', 2);
  koffi.encode(writer, 0, 'int', 1);
  koffi.encode(writer, koffi.sizeof('void *'), 'void *', writeBlock);
  const written = SaveWithVersion(document, writer, 0, 17);
  koffi.unregister(writeBlock);
  if (written !== 1) throw new Error('FPDF_SaveWithVersion refused the document.');
  return new Uint8Array(chunks);
}

/**
 * The bounds of every object on page 0, read from BYTES rather than a session.
 *
 * @param {Uint8Array} bytes
 * @param {string} label
 */
function describe(bytes, label) {
  const document = LoadMemDocument(bytes, bytes.length, null);
  const page = LoadPage(document, 0);
  const count = CountObjects(page);
  process.stdout.write(`  ${label}: ${String(count)} object(s)\n`);
  for (let at = 0; at < count; at += 1) {
    const object = GetObject(page, at);
    const kind = OBJECT_KINDS[GetObjectType(object)] ?? '?';
    const left = [0];
    const bottom = [0];
    const right = [0];
    const top = [0];
    GetBounds(object, left, bottom, right, top);
    /** @type {Record<string, number>} */
    const matrix = {};
    const gotMatrix = GetMatrix(object, matrix);
    const red = [0];
    const green = [0];
    const blue = [0];
    const alpha = [0];
    const gotColour = GetFillColor(object, red, green, blue, alpha);
    process.stdout.write(
      `    [${String(at)}] ${kind.padEnd(6)}` +
        ` bounds ${(left[0] ?? 0).toFixed(1)},${(bottom[0] ?? 0).toFixed(1)}` +
        ` .. ${(right[0] ?? 0).toFixed(1)},${(top[0] ?? 0).toFixed(1)}` +
        (gotMatrix === 1
          ? `  matrix ${['a', 'b', 'c', 'd', 'e', 'f'].map((key) => Number(matrix[key]).toFixed(2)).join(' ')}`
          : '  matrix UNAVAILABLE') +
        (gotColour === 1
          ? `  fill ${String(red[0])},${String(green[0])},${String(blue[0])},${String(alpha[0])}`
          : '  fill UNAVAILABLE') +
        '\n',
    );
  }
  ClosePage(page);
  CloseDocument(document);
}

/**
 * Applies `work` to the object at `index`, then reports the reopened bytes.
 *
 * @param {Uint8Array} bytes
 * @param {number} index
 * @param {(object: unknown, page: unknown) => void} work
 * @param {string} label
 * @param {{ generate?: boolean }} [options]
 */
function apply(bytes, index, work, label, options = {}) {
  const document = LoadMemDocument(bytes, bytes.length, null);
  const page = LoadPage(document, 0);
  work(GetObject(page, index), page);
  const generated = options.generate === false ? 'SKIPPED' : String(GenerateContent(page));
  const after = serialise(document);
  ClosePage(page);
  CloseDocument(document);
  process.stdout.write(`\n## ${label}   (FPDFPage_GenerateContent: ${generated})\n\n`);
  describe(after, 'after');
  return after;
}

try {
  process.stdout.write(`# PDFium ${PDFIUM_VERSION} — moving, scaling, recolouring, deleting\n\n`);
  const original = await fixture();
  process.stdout.write('## the fixture, as PDFium reads it back\n\n');
  describe(original, 'original');

  // 1. DOES A TRANSFORM COMPOSE OR REPLACE? Applied twice: a composing call
  // moves 60pt in total, a replacing one moves 30.
  apply(
    original,
    1,
    (object) => {
      Transform(object, 1, 0, 0, 1, 30, 0);
      Transform(object, 1, 0, 0, 1, 30, 0);
    },
    'TWO translations of +30x on the rectangle — 60 total means Transform COMPOSES',
  );

  // 2. WHAT DOES A SCALE SCALE ABOUT? The rectangle sits at x=200..320. Scaled
  // by 2 about the PAGE origin it lands at 400..640 — off the page. About its
  // own left edge it stays at 200..440.
  apply(
    original,
    1,
    (object) => {
      Transform(object, 2, 0, 0, 1, 0, 0);
    },
    'SCALE x2 horizontally — where the rectangle lands says what the origin is',
  );

  // 3. IS A MATRIX A RESTORE? Read it, transform, put it back, and see whether
  // the bounds return to what they were. This is the whole inverse.
  const matrixBefore = {};
  {
    const document = LoadMemDocument(original, original.length, null);
    const page = LoadPage(document, 0);
    GetMatrix(GetObject(page, 1), matrixBefore);
    ClosePage(page);
    CloseDocument(document);
  }
  apply(
    original,
    1,
    (object) => {
      Transform(object, 2, 0, 0, 2, 50, 50);
      SetMatrix(object, matrixBefore);
    },
    'TRANSFORM then SetMatrix(what was read) — identical bounds means the inverse RESTORES',
  );

  // 4. DOES A TEXT OBJECT TAKE A FILL COLOUR? The row says *any page object*,
  // and text is the kind a person is most likely to recolour.
  apply(
    original,
    0,
    (object) => {
      const result = SetFillColor(object, 255, 0, 0, 255);
      process.stdout.write(`  FPDFPageObj_SetFillColor on the TEXT object returned ${String(result)}\n`);
    },
    'RECOLOUR the first text run to red',
  );

  // 5. AND A PATH? The rectangle is black; red is a luminance change the
  // fidelity comparator can see (CCCCCC-3).
  apply(
    original,
    1,
    (object) => {
      const result = SetFillColor(object, 255, 0, 0, 255);
      process.stdout.write(`  FPDFPageObj_SetFillColor on the PATH object returned ${String(result)}\n`);
    },
    'RECOLOUR the rectangle to red',
  );

  // 6. DELETE. `FPDFPage_RemoveObject` unlinks and hands ownership back, so
  // `FPDFPageObj_Destroy` is what frees it — the question is whether the count
  // drops in the SAVED bytes, and whether generation is what makes it so.
  apply(
    original,
    1,
    (object, page) => {
      const removed = RemoveObject(page, object);
      process.stdout.write(`  FPDFPage_RemoveObject returned ${String(removed)}\n`);
      DestroyObject(object);
    },
    'DELETE the rectangle',
  );

  // 7. THE CONTROL FOR EVERY GENERATION CLAIM ABOVE: the same delete with no
  // FPDFPage_GenerateContent. If the object is gone from the saved bytes here
  // too, then generation is not what carries these edits and ADR-0047's cost
  // model does not apply to them.
  apply(
    original,
    1,
    (object, page) => {
      RemoveObject(page, object);
      DestroyObject(object);
    },
    'CONTROL: the same delete with NO GenerateContent',
    { generate: false },
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
