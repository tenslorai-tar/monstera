// @ts-check
/**
 * Can this build EDIT text that lives inside a Form XObject?
 *
 * ## The clause, and why it is asked now rather than designed now
 *
 * `BUILD-PROMPT.md`:278: *"Text inside Form XObjects (how Office/InDesign emit
 * text): implement **normalize-then-edit** — on first edit of such a page,
 * promote the XObject content into the page content stream with its matrix
 * composed in, then edit in flat space."* `:706` puts it in Stage 5 beside the
 * editing rows.
 *
 * It has **no `docs/FEATURES.md` row**, which is the shape *a missing row, not
 * an undecided design* names: the question to ask first is what would CALL it.
 * The answer is the five editing rows that landed on 2026-09-09 and 2026-09-10 —
 * every one of them names an object by its index in `FPDFPage_GetObject`'s walk.
 * So the clause is owed exactly to the extent that walk cannot see this text,
 * and that is a fact about PDFium rather than a design decision.
 *
 * ## What is measured, and what each answer would mean
 *
 * A page whose text is drawn through a Form XObject, asked three questions:
 *
 * 1. **What does `FPDFPage_GetObject` see?** If it reports a `form` object and
 *    no `text` objects, the editing rows cannot name the text at all and
 *    normalize-then-edit is what would make them able to.
 * 2. **What does the TEXT PAGE see?** `FPDFText_CountChars` walks rendered text,
 *    which may descend where the object walk does not — so the words can be
 *    findable and unaddressable at the same time, which is the state that would
 *    make `replaceAllText` silently skip them.
 * 3. **What does `FPDFText_GetTextObject` answer for those characters?** This is
 *    the crux. `textRuns` builds an address table from `FPDFPage_GetObject` and
 *    matches against it; a character whose object is the FORM — or is not in the
 *    table at all — produces a run the editor cannot address, or no run.
 *
 * ## The fixture is a REAL Form XObject, not a description of one
 *
 * `PDFDocument.embedPage` produces a `/Subtype /Form` XObject and draws it with
 * `Do`, which is exactly how Office and InDesign emit text. A fixture built by
 * hand-writing a content stream would be this script's opinion about what such a
 * document looks like.
 *
 * The page also carries **one ordinary text run outside the XObject**, which is
 * the control: it separates *PDFium sees no text here* from *PDFium sees no text
 * on this page*, and those are opposite conclusions.
 *
 * Usage: node scripts/research/pdfiumXObjects.mjs
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
const TextLoadPage = lib.func('void *FPDFText_LoadPage(void *page)');
const TextClosePage = lib.func('void FPDFText_ClosePage(void *tp)');
const CountChars = lib.func('int FPDFText_CountChars(void *tp)');
const GetText = lib.func('int FPDFText_GetText(void *tp, int start, int count, _Out_ uint16_t *buffer)');
const GetTextObject = lib.func('void *FPDFText_GetTextObject(void *tp, int index)');
const IsGenerated = lib.func('int FPDFText_IsGenerated(void *tp, int index)');
// THE TWO THIS QUESTION MAY NEED, bound so the answer can be complete rather
// than "the object walk does not see it, and nothing here looked further".
const CountFormObjects = lib.func('int FPDFFormObj_CountObjects(void *object)');
const GetFormObject = lib.func('void *FPDFFormObj_GetObject(void *object, unsigned long index)');

const SetText = lib.func('int FPDFText_SetText(void *object, const void *text)');
const GenerateContent = lib.func('int FPDFPage_GenerateContent(void *page)');
const SaveWithVersion = lib.func('int FPDF_SaveWithVersion(void *doc, void *writer, int flags, int version)');

/** `FPDFPageObj_GetType`'s answers, as words. */
const KINDS = ['unknown', 'text', 'path', 'image', 'shading', 'form'];

/** What section 4 writes into the nested object, chosen to appear nowhere else. */
const REPLACEMENT = 'EDITED NESTED RUN';

// DECLARED ONCE. koffi registers a proto by NAME, so declaring it inside the
// function would throw `Duplicate type name` on a second serialise.
const WriteBlock = koffi.pointer(
  koffi.proto('int WriteBlock(void *self, const void *data, unsigned long size)'),
);

/**
 * The document's bytes, through PDFium's own writer.
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

InitLibrary();

/**
 * A page whose text is inside a Form XObject, plus one ordinary run.
 *
 * @returns {Promise<Uint8Array>}
 */
async function textInsideAnXObject() {
  // THE INNER DOCUMENT becomes the XObject. `embedPage` takes a page from
  // another document and produces a `/Subtype /Form` — the same construct
  // Office and InDesign emit, rather than a hand-written approximation.
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([300, 120]);
  const innerFont = await inner.embedFont(StandardFonts.Helvetica);
  innerPage.drawText('INSIDE THE XOBJECT', { x: 10, y: 60, size: 14, font: innerFont });
  innerPage.drawText('SECOND LINE INSIDE', { x: 10, y: 30, size: 14, font: innerFont });

  const outer = await PDFDocument.create();
  const embedded = await outer.embedPdf(await inner.save());
  const page = outer.addPage([400, 300]);
  const font = await outer.embedFont(StandardFonts.Helvetica);
  // THE CONTROL, drawn directly on the page: one ordinary text object, so
  // *PDFium sees no text inside the XObject* is separable from *PDFium sees no
  // text on this page*.
  page.drawText('OUTSIDE, ON THE PAGE', { x: 30, y: 260, size: 14, font });
  const form = embedded[0];
  if (form === undefined) throw new Error('embedPdf produced no page');
  // A NON-IDENTITY MATRIX, because the clause is about composing one in: the
  // XObject is placed at an offset and scaled, so anything that read a
  // coordinate out of it without composing would be visibly wrong.
  page.drawPage(form, { x: 40, y: 80, xScale: 1.2, yScale: 1.2 });
  return outer.save();
}

/** @param {Uint16Array} buffer @param {number} units */
function decode(buffer, units) {
  const view = new Uint16Array(buffer.buffer, buffer.byteOffset, units);
  let text = '';
  for (const unit of view) {
    if (unit === 0) break;
    text += String.fromCharCode(unit);
  }
  return text;
}

try {
  process.stdout.write(`# PDFium ${PDFIUM_VERSION} — can the editing rows reach text in a Form XObject?\n\n`);

  const bytes = await textInsideAnXObject();
  const document = LoadMemDocument(bytes, bytes.length, null);
  if (document === null) throw new Error('PDFium refused the fixture');
  const page = LoadPage(document, 0);
  const textPage = TextLoadPage(page);

  // ── 1. THE OBJECT WALK, which is what every editing command names ──────────
  const total = CountObjects(page);
  process.stdout.write(`## 1. FPDFPage_GetObject — the walk every editing command names\n\n`);
  process.stdout.write(`  ${String(total)} object(s) on the page\n`);
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  /** @type {Map<string, number>} */
  const insideForm = new Map();
  for (let at = 0; at < total; at += 1) {
    const object = GetObject(page, at);
    const kind = KINDS[GetObjectType(object)] ?? '?';
    indexOf.set(String(koffi.address(object)), at);
    process.stdout.write(`    [${String(at)}] ${kind}\n`);
    if (kind === 'form') {
      // WHAT IS INSIDE IT, which is the half that says whether the text is
      // reachable at all or merely un-numbered by the page's own walk.
      const nested = CountFormObjects(object);
      process.stdout.write(`         FPDFFormObj_CountObjects: ${String(nested)}\n`);
      for (let inner = 0; inner < nested; inner += 1) {
        const child = GetFormObject(object, inner);
        const childKind = KINDS[GetObjectType(child)] ?? '?';
        insideForm.set(String(koffi.address(child)), at);
        process.stdout.write(`         [${String(at)}.${String(inner)}] ${childKind}\n`);
      }
    }
  }

  // ── 2. THE TEXT PAGE, which is what search and extraction read ─────────────
  const chars = CountChars(textPage);
  const buffer = new Uint16Array(chars + 1);
  GetText(textPage, 0, chars, buffer);
  process.stdout.write(
    `\n## 2. FPDFText — what search and extraction see\n\n` +
      `  ${String(chars)} character(s): ${JSON.stringify(decode(buffer, chars + 1))}\n`,
  );

  // ── 3. THE CRUX: which OBJECT does each character belong to? ───────────────
  let onPage = 0;
  let inForm = 0;
  let generated = 0;
  let unresolved = 0;
  for (let at = 0; at < chars; at += 1) {
    if (IsGenerated(textPage, at) === 1) {
      generated += 1;
      continue;
    }
    const owner = String(koffi.address(GetTextObject(textPage, at)));
    if (indexOf.has(owner)) onPage += 1;
    else if (insideForm.has(owner)) inForm += 1;
    else unresolved += 1;
  }
  process.stdout.write(
    `\n## 3. FPDFText_GetTextObject — which object owns each character\n\n` +
      `  in a PAGE-LEVEL object   ${String(onPage)}\n` +
      `  in a FORM's child object ${String(inForm)}\n` +
      `  generated (no object)    ${String(generated)}\n` +
      `  resolved to NEITHER      ${String(unresolved)}\n\n`,
  );

  TextClosePage(textPage);
  ClosePage(page);
  CloseDocument(document);

  // ── 4. THE QUESTION THAT DECIDES HOW MUCH IS OWED ─────────────────────────
  //
  // `FPDFFormObj_GetObject` reaches the nested text objects, so before designing
  // a promotion the cheap question is whether they can simply be EDITED where
  // they are. `FPDFText_SetText` needs no coordinates — it replaces a string —
  // so if it works through a nested handle and survives a save, then
  // normalize-then-edit is owed only for the rows that DO read coordinates, and
  // the founding record's clause is broader than the gap.
  //
  // Measured rather than reasoned, because "the handle is valid so the setter
  // works" is exactly the shape a declaration makes plausible and a run refutes.
  process.stdout.write(`\n## 4. Can a nested text object be edited IN PLACE?\n\n`);
  const editing = LoadMemDocument(bytes, bytes.length, null);
  const editPage = LoadPage(editing, 0);
  let nestedEdit = 'no form object was found to try';
  for (let at = 0; at < CountObjects(editPage); at += 1) {
    const object = GetObject(editPage, at);
    if ((KINDS[GetObjectType(object)] ?? '') !== 'form') continue;
    const child = GetFormObject(object, 0);
    const wide = Buffer.alloc((REPLACEMENT.length + 1) * 2);
    wide.write(REPLACEMENT, 'utf16le');
    const set = SetText(child, wide);
    const generated = GenerateContent(editPage);
    nestedEdit = `FPDFText_SetText=${String(set)} FPDFPage_GenerateContent=${String(generated)}`;
    break;
  }
  process.stdout.write(`  ${nestedEdit}\n`);

  const after = serialise(editing);
  ClosePage(editPage);
  CloseDocument(editing);

  // READ BACK FROM THE SAVED BYTES, never from the session that wrote them: a
  // setter agreeing with itself is the reassuring answer this whole question is
  // vulnerable to.
  const reopened = LoadMemDocument(after, after.length, null);
  const reopenedPage = LoadPage(reopened, 0);
  const reopenedText = TextLoadPage(reopenedPage);
  const reopenedChars = CountChars(reopenedText);
  const reopenedBuffer = new Uint16Array(reopenedChars + 1);
  GetText(reopenedText, 0, reopenedChars, reopenedBuffer);
  const read = decode(reopenedBuffer, reopenedChars + 1);
  process.stdout.write(
    `  reopened: ${JSON.stringify(read)}\n` +
      `  the edit ${read.includes(REPLACEMENT) ? 'SURVIVED' : 'did NOT survive'} the save\n\n`,
  );
  TextClosePage(reopenedText);
  ClosePage(reopenedPage);
  CloseDocument(reopened);

  process.stdout.write(
    `## What this decides\n\n` +
      `  \`textRuns\` builds its address table from FPDFPage_GetObject alone, so a\n` +
      `  character owned by a FORM's child resolves to nothing and is dropped —\n` +
      `  the words are findable through FPDFText and unaddressable by every\n` +
      `  shipped command. Section 4 says whether closing that needs the promotion\n` +
      `  BUILD-PROMPT.md:278 names, or only a deeper walk for the rows that do\n` +
      `  not read coordinates.\n`,
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
