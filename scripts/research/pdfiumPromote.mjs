// @ts-check
/**
 * Can PDFium itself perform normalize-then-edit, or does the promotion need
 * the structural writer?
 *
 * ## Why this is asked now
 *
 * `BUILD-PROMPT.md`:278 owes *"on first edit of such a page, promote the
 * XObject content into the page content stream with its matrix composed in,
 * then edit in flat space"*. Its `docs/FEATURES.md` row deferred that behind a
 * trigger, and the trigger fired on 2026-09-10: two of eleven corpus documents
 * carry text inside a Form XObject, one of them with **no** page-level text at
 * all, so every editing row this build shipped can name nothing on it.
 *
 * ## The question is about OWNERSHIP, and the header answers half of it
 *
 * `FPDFFormObj_RemoveObject` says *"ownership of the removed page_object is
 * transferred to the caller"*, and `FPDFPage_InsertObject` says it *"takes
 * ownership"*. So the move is expressible. What a header cannot say is whether
 * the result is CORRECT:
 *
 * 1. **Does the text land where it was?** A form is drawn under its own matrix,
 *    so a child's effective placement is its matrix composed with the form's.
 *    Moving a child without composing puts the text somewhere else — and the
 *    page still renders, which is the defect that looks like a feature.
 * 2. **Do the resources travel?** A text object inside a form names a font in
 *    the FORM's resource dictionary. Whether content generation re-registers it
 *    on the page is a fact about PDFium, not about PDF.
 * 3. **Does it survive the save?** Section 4 of `pdfiumXObjects.mjs` measured a
 *    nested `FPDFText_SetText` returning 1, `GenerateContent` returning 1, and
 *    the edit vanishing from the reopened bytes. Two successes and no effect is
 *    this API's demonstrated failure mode here, so nothing counts until it is
 *    read back from a reopened document.
 * 4. **Is the text then EDITABLE, which is the whole point?** A promotion that
 *    produces addressable objects the editor still cannot change has moved the
 *    problem rather than solved it.
 *
 * ## The fixture carries a non-identity matrix on purpose
 *
 * The XObject is placed at an offset AND scaled. With an identity matrix every
 * composition rule agrees, which is the fixture the bug also handles correctly.
 *
 * Usage: node scripts/research/pdfiumPromote.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { formatError } from '../lib/reportError.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const library = pdfiumLibrary(REPO_ROOT);
if (!existsSync(library)) {
  process.stderr.write(`\nNo PDFium at ${library}. Run \`npm run provision:pdfium\`.\n`);
  process.exit(1);
}

const lib = koffi.load(library);
koffi.struct('FS_MATRIX', { a: 'float', b: 'float', c: 'float', d: 'float', e: 'float', f: 'float' });
koffi.struct('FS_RECTF', { left: 'float', top: 'float', right: 'float', bottom: 'float' });

const InitLibrary = lib.func('void FPDF_InitLibrary()');
const LoadMemDocument = lib.func('void *FPDF_LoadMemDocument(const void *buf, int size, const char *pw)');
const LoadPage = lib.func('void *FPDF_LoadPage(void *doc, int index)');
const ClosePage = lib.func('void FPDF_ClosePage(void *page)');
const CloseDocument = lib.func('void FPDF_CloseDocument(void *doc)');
const CountObjects = lib.func('int FPDFPage_CountObjects(void *page)');
const GetObject = lib.func('void *FPDFPage_GetObject(void *page, int index)');
const GetObjectType = lib.func('int FPDFPageObj_GetType(void *object)');
const InsertObject = lib.func('int FPDFPage_InsertObject(void *page, void *object)');
const RemovePageObject = lib.func('int FPDFPage_RemoveObject(void *page, void *object)');
const DestroyObject = lib.func('void FPDFPageObj_Destroy(void *object)');
const GetMatrix = lib.func('int FPDFPageObj_GetMatrix(void *object, _Out_ FS_MATRIX *matrix)');
const SetMatrix = lib.func('int FPDFPageObj_SetMatrix(void *object, const FS_MATRIX *matrix)');
const GetBounds = lib.func(
  'int FPDFPageObj_GetBounds(void *object, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)',
);
const CountFormObjects = lib.func('int FPDFFormObj_CountObjects(void *object)');
const GetFormObject = lib.func('void *FPDFFormObj_GetObject(void *object, unsigned long index)');
const FormRemoveObject = lib.func('int FPDFFormObj_RemoveObject(void *form, void *object)');
const TextLoadPage = lib.func('void *FPDFText_LoadPage(void *page)');
const TextClosePage = lib.func('void FPDFText_ClosePage(void *tp)');
const CountChars = lib.func('int FPDFText_CountChars(void *tp)');
const GetText = lib.func('int FPDFText_GetText(void *tp, int start, int count, _Out_ uint16_t *buffer)');
const SetText = lib.func('int FPDFText_SetText(void *object, const void *text)');
const GenerateContent = lib.func('int FPDFPage_GenerateContent(void *page)');
const SaveWithVersion = lib.func('int FPDF_SaveWithVersion(void *doc, void *writer, int flags, int version)');

const KINDS = ['unknown', 'text', 'path', 'image', 'shading', 'form'];

const WriteBlock = koffi.pointer(
  koffi.proto('int WriteBlock(void *self, const void *data, unsigned long size)'),
);

/** @param {unknown} document @returns {Uint8Array} */
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

/** @param {unknown} object */
function boundsOf(object) {
  const left = [0];
  const bottom = [0];
  const right = [0];
  const top = [0];
  GetBounds(object, left, bottom, right, top);
  const round = (/** @type {number[]} */ value) => Math.round((value[0] ?? 0) * 100) / 100;
  return { left: round(left), bottom: round(bottom), right: round(right), top: round(top) };
}

/** @param {unknown} object */
function matrixOf(object) {
  const out = {};
  GetMatrix(object, out);
  return /** @type {{a:number,b:number,c:number,d:number,e:number,f:number}} */ (out);
}

/**
 * `child` then `form`, which is the order a form's content is drawn in.
 *
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} child
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} form
 */
function compose(child, form) {
  return {
    a: child.a * form.a + child.b * form.c,
    b: child.a * form.b + child.b * form.d,
    c: child.c * form.a + child.d * form.c,
    d: child.c * form.b + child.d * form.d,
    e: child.e * form.a + child.f * form.c + form.e,
    f: child.e * form.b + child.f * form.d + form.f,
  };
}

/** @param {unknown} page @returns {string} */
function textOf(page) {
  const textPage = TextLoadPage(page);
  try {
    const chars = CountChars(textPage);
    if (chars <= 0) return '';
    const buffer = new Uint16Array(chars + 1);
    GetText(textPage, 0, chars, buffer);
    let text = '';
    for (const unit of buffer) {
      if (unit === 0) break;
      text += String.fromCharCode(unit);
    }
    return text;
  } finally {
    TextClosePage(textPage);
  }
}

/** The fixture: one ordinary run, and two runs inside a placed, scaled form. */
async function fixture() {
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([300, 120]);
  const innerFont = await inner.embedFont(StandardFonts.Helvetica);
  innerPage.drawText('INSIDE THE XOBJECT', { x: 10, y: 60, size: 14, font: innerFont });
  innerPage.drawText('SECOND LINE INSIDE', { x: 10, y: 30, size: 14, font: innerFont });

  const outer = await PDFDocument.create();
  const embedded = await outer.embedPdf(await inner.save());
  const page = outer.addPage([400, 300]);
  const font = await outer.embedFont(StandardFonts.Helvetica);
  page.drawText('OUTSIDE, ON THE PAGE', { x: 30, y: 260, size: 14, font });
  const form = embedded[0];
  if (form === undefined) throw new Error('embedPdf produced no page');
  page.drawPage(form, { x: 40, y: 80, xScale: 1.2, yScale: 1.2 });
  return outer.save();
}

InitLibrary();

try {
  process.stdout.write(`# PDFium ${PDFIUM_VERSION} — can it promote a form's content onto the page?\n\n`);

  const bytes = await fixture();
  const document = LoadMemDocument(bytes, bytes.length, null);
  const page = LoadPage(document, 0);

  // ── 1. WHERE THE TEXT IS BEFORE ──────────────────────────────────────────
  process.stdout.write('## 1. Before\n\n');
  let formObject = null;
  for (let at = 0; at < CountObjects(page); at += 1) {
    const object = GetObject(page, at);
    const kind = KINDS[GetObjectType(object)] ?? '?';
    process.stdout.write(`  [${String(at)}] ${kind} ${JSON.stringify(boundsOf(object))}\n`);
    if (kind === 'form') formObject = object;
  }
  if (formObject === null) throw new Error('the fixture carries no form object');

  const formMatrix = matrixOf(formObject);
  process.stdout.write(`  the form's matrix: ${JSON.stringify(formMatrix)}\n`);
  const children = CountFormObjects(formObject);
  for (let inner = 0; inner < children; inner += 1) {
    const child = GetFormObject(formObject, inner);
    process.stdout.write(
      `    child ${String(inner)}: ${KINDS[GetObjectType(child)] ?? '?'} ` +
        `own matrix ${JSON.stringify(matrixOf(child))} bounds ${JSON.stringify(boundsOf(child))}\n`,
    );
  }
  const textBefore = textOf(page);

  // ── 2. THE PROMOTION ─────────────────────────────────────────────────────
  //
  // Composed FIRST, moved second. The child's bounds are reported in the
  // FORM's space, so composing before the move is what makes the two readings
  // comparable — and the composition is the clause's own words: "with its
  // matrix composed in".
  process.stdout.write('\n## 2. Promoting\n\n');
  // THE HANDLES ARE TAKEN FIRST, IN ORDER, and only then removed. Two reasons,
  // and the second is the one a reader would not predict:
  //
  // - `FPDFFormObj_GetObject` is indexed, so removing while walking renumbers
  //   what is left — the same shape `removeObjects` already handles by taking
  //   the OBJECT rather than the index.
  // - ORDER IS CONTENT, not bookkeeping. Inserting the children in reverse put
  //   `SECOND LINE INSIDE` ahead of `INSIDE THE XOBJECT` in the extracted text
  //   — measured, in this file's first run. Content-stream order is what the
  //   editor's grouping and every reader downstream sees, so a promotion that
  //   reversed it would move the words on the page's own reading of itself
  //   while leaving every pixel where it was.
  const kids = [];
  for (let inner = 0; inner < children; inner += 1) kids.push(GetFormObject(formObject, inner));

  /** @type {unknown[]} */
  const taken = [];
  for (const [index, child] of kids.entries()) {
    const composed = compose(matrixOf(child), formMatrix);
    const set = SetMatrix(child, composed);
    const removed = FormRemoveObject(formObject, child);
    process.stdout.write(
      `  child ${String(index)}: SetMatrix=${String(set)} FPDFFormObj_RemoveObject=${String(removed)}\n`,
    );
    if (removed === 1) taken.push(child);
  }
  for (const child of taken) {
    const inserted = InsertObject(page, child);
    process.stdout.write(`  FPDFPage_InsertObject=${String(inserted)}\n`);
  }
  const removedForm = RemovePageObject(page, formObject);
  process.stdout.write(`  FPDFPage_RemoveObject(the empty form)=${String(removedForm)}\n`);
  if (removedForm === 1) DestroyObject(formObject);
  const generated = GenerateContent(page);
  process.stdout.write(`  FPDFPage_GenerateContent=${String(generated)}\n`);

  const after = serialise(document);
  ClosePage(page);
  CloseDocument(document);

  // ── 3. READ BACK FROM THE SAVED BYTES ────────────────────────────────────
  process.stdout.write('\n## 3. After, from the reopened document\n\n');
  const reopened = LoadMemDocument(after, after.length, null);
  const reopenedPage = LoadPage(reopened, 0);
  for (let at = 0; at < CountObjects(reopenedPage); at += 1) {
    const object = GetObject(reopenedPage, at);
    process.stdout.write(
      `  [${String(at)}] ${KINDS[GetObjectType(object)] ?? '?'} ${JSON.stringify(boundsOf(object))}\n`,
    );
  }
  const textAfter = textOf(reopenedPage);
  process.stdout.write(`\n  text before: ${JSON.stringify(textBefore)}\n`);
  process.stdout.write(`  text after:  ${JSON.stringify(textAfter)}\n`);

  // ── 4. AND IS IT EDITABLE NOW? ───────────────────────────────────────────
  process.stdout.write('\n## 4. Editing a promoted object\n\n');
  let edited = 'no text object was found on the page';
  for (let at = 0; at < CountObjects(reopenedPage); at += 1) {
    const object = GetObject(reopenedPage, at);
    if ((KINDS[GetObjectType(object)] ?? '') !== 'text') continue;
    if (boundsOf(object).top > 250) continue; // the ordinary run, not a promoted one
    const wide = Buffer.alloc(('PROMOTED AND EDITED'.length + 1) * 2);
    wide.write('PROMOTED AND EDITED', 'utf16le');
    const set = SetText(object, wide);
    const regenerated = GenerateContent(reopenedPage);
    edited = `FPDFText_SetText=${String(set)} FPDFPage_GenerateContent=${String(regenerated)}`;
    break;
  }
  process.stdout.write(`  ${edited}\n`);
  const twice = serialise(reopened);
  ClosePage(reopenedPage);
  CloseDocument(reopened);

  const third = LoadMemDocument(twice, twice.length, null);
  const thirdPage = LoadPage(third, 0);
  const finalText = textOf(thirdPage);
  process.stdout.write(`  reopened again: ${JSON.stringify(finalText)}\n`);
  process.stdout.write(
    `  the edit ${finalText.includes('PROMOTED AND EDITED') ? 'SURVIVED' : 'did NOT survive'} the save\n`,
  );
  ClosePage(thirdPage);
  CloseDocument(third);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
