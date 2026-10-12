// @ts-check
/**
 * Can a PDFium text object carry CHARACTER SPACING, a JUSTIFIED line and a TAB, and how do the readers see each?
 *
 * ## The question, and what it decides
 *
 * The in-place editor's writer (`pdfiumFfi.ts`) places text objects and never states a glyph's own position: PDFium's
 * public edit API has no setter for `Tc` or `Tw`. PDFium 155 exports one experimental call that could carry all three,
 * `FPDFText_SetPositions`, which sets each character's position after the first. Four facts decide whether the writer
 * may use it:
 *
 * - **What does `FPDFPage_GenerateContent` write for positions?** Read from the saved content stream.
 * - **Does PDFium's own text page read the characters back, in order, with the gaps where they were set?** That is the
 *   editor's own read of a block, so a write it cannot read is a block that cannot be edited again.
 * - **Does MuPDF read them back?** The second reader, the one search and the text layer use.
 * - **A tab.** WinAnsi code 9 in a standard font has no glyph. What does a text object holding U+0009 write and read,
 *   and does a `/Span` mark carrying `/ActualText` survive generation, so a tab can be written as a gap with the
 *   character kept?
 *
 * ## The control
 *
 * The same text written WITHOUT positions: its character boxes must sit at the font's own advances. A probe that read
 * the same boxes with and without positions could not tell a call that worked from one that was ignored.
 *
 * Usage: node scripts/research/pdfiumPositions.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, PDFArray } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { shimLibraryPath } from '../provision/mupdf.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const library = pdfiumLibrary(REPO_ROOT);
if (!existsSync(library)) {
  process.stderr.write(`\nNo PDFium at ${library}. Run \`npm run provision:pdfium\`.\n`);
  process.exit(1);
}
const lib = koffi.load(library);

/** @param {string} signature @returns {(...args: unknown[]) => any} */
const required = (signature) => /** @type {(...args: unknown[]) => any} */ (lib.func(signature));

const InitLibrary = required('void FPDF_InitLibrary()');
const LoadMemDocument = required('void *FPDF_LoadMemDocument(const void *buf, int size, const char *pw)');
const LoadPage = required('void *FPDF_LoadPage(void *doc, int index)');
const ClosePage = required('void FPDF_ClosePage(void *page)');
const CloseDocument = required('void FPDF_CloseDocument(void *doc)');
const InsertObject = required('void FPDFPage_InsertObject(void *page, void *object)');
koffi.struct('FS_MATRIX', { a: 'float', b: 'float', c: 'float', d: 'float', e: 'float', f: 'float' });
const SetMatrix = required('int FPDFPageObj_SetMatrix(void *object, const FS_MATRIX *matrix)');
const SetText = required('int FPDFText_SetText(void *object, const uint16_t *text)');
const SetPositions = required('int FPDFText_SetPositions(void *object, const float *positions, size_t count)');
const CreateTextObj = required('void *FPDFPageObj_CreateTextObj(void *doc, void *font, float size)');
const LoadStandardFont = required('void *FPDFText_LoadStandardFont(void *doc, const char *font)');
const AddMark = required('void *FPDFPageObj_AddMark(void *object, const char *name)');
const SetStringParam = required('int FPDFPageObjMark_SetStringParam(void *doc, void *object, void *mark, const char *key, const char *value)');
const GenerateContent = required('int FPDFPage_GenerateContent(void *page)');
const LoadTextPage = required('void *FPDFText_LoadPage(void *page)');
const CloseTextPage = required('void FPDFText_ClosePage(void *textPage)');
const CountChars = required('int FPDFText_CountChars(void *textPage)');
const GetUnicode = required('unsigned int FPDFText_GetUnicode(void *textPage, int index)');
const GetCharBox = required(
  'int FPDFText_GetCharBox(void *textPage, int index, _Out_ double *left, _Out_ double *right, _Out_ double *bottom, _Out_ double *top)',
);
const SaveWithVersion = required('int FPDF_SaveWithVersion(void *doc, void *writer, int flags, int version)');
const WriteBlock = koffi.pointer(koffi.proto('int WriteBlock(void *self, const void *data, unsigned long size)'));

/** @param {unknown} document @returns {Uint8Array} */
function serialise(document) {
  /** @type {number[]} */
  const chunks = [];
  const writeBlock = koffi.register(
    /** @param {unknown} _self @param {unknown} data @param {number} size */
    (_self, data, size) => {
      for (const byte of koffi.decode(data, 'unsigned char', size)) chunks.push(byte);
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

/** @param {string} text */
function wide(text) {
  const units = new Uint16Array(text.length + 1);
  for (let at = 0; at < text.length; at += 1) units[at] = text.charCodeAt(at);
  return units;
}

InitLibrary();

/**
 * One page holding `text` in Helvetica 20 at (100, 700), with `positions` set where given and a `/Span` mark carrying
 * `actualText` where given. Answers the saved bytes.
 *
 * @param {string} text
 * @param {number[] | null} positions
 * @param {string | null} actualText
 */
async function written(text, positions, actualText) {
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  const bytes = await blank.save();
  const buffer = Buffer.from(bytes);
  const document = LoadMemDocument(buffer, buffer.length, null);
  const page = LoadPage(document, 0);
  const font = LoadStandardFont(document, 'Helvetica');
  const object = CreateTextObj(document, font, 20);
  if (SetText(object, wide(text)) !== 1) throw new Error('FPDFText_SetText refused');
  const positioned = positions === null ? null : SetPositions(object, Float32Array.from(positions), positions.length);
  if (actualText !== null) {
    const mark = AddMark(object, 'Span');
    SetStringParam(document, object, mark, 'ActualText', actualText);
  }
  SetMatrix(object, { a: 1, b: 0, c: 0, d: 1, e: 100, f: 700 });
  InsertObject(page, object);
  if (GenerateContent(page) !== 1) throw new Error('FPDFPage_GenerateContent refused');
  const saved = serialise(document);
  ClosePage(page);
  CloseDocument(document);
  return { saved, positioned };
}

/** @param {Uint8Array} bytes @returns {Promise<string>} */
async function contentOf(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = document.getPage(0).node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let out = '';
  for (const ref of refs) {
    const stream = document.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const raw = stream.contents;
    const filter = stream.dict.get(PDFName.of('Filter'));
    out += filter === undefined ? Buffer.from(raw).toString('latin1') : inflateSync(raw).toString('latin1');
  }
  return out;
}

/** What PDFium's text page reads: each character and the left edge of its box. @param {Uint8Array} bytes */
function pdfiumRead(bytes) {
  const buffer = Buffer.from(bytes);
  const document = LoadMemDocument(buffer, buffer.length, null);
  const page = LoadPage(document, 0);
  const textPage = LoadTextPage(page);
  const count = CountChars(textPage);
  /** @type {{ char: string, left: number }[]} */
  const chars = [];
  for (let at = 0; at < count; at += 1) {
    const left = [0];
    const right = [0];
    const bottom = [0];
    const top = [0];
    GetCharBox(textPage, at, left, right, bottom, top);
    chars.push({ char: String.fromCodePoint(GetUnicode(textPage, at)), left: Math.round((left[0] ?? 0) * 10) / 10 });
  }
  CloseTextPage(textPage);
  ClosePage(page);
  CloseDocument(document);
  return chars;
}

// A LITERAL SPECIFIER, relative to this file, so the Electron-import scan can read what it loads.
const raw = await import('../../packages/kernel/dist/mupdfRaw.js');
raw.openMupdfShim(shimLibraryPath(REPO_ROOT));

/** What MuPDF's structured text reads. @param {Uint8Array} bytes */
function mupdfRead(bytes) {
  const document = raw.Document.openDocument(bytes, 'application/pdf');
  const page = document.loadPage(0);
  const text = page.toStructuredText('preserve-whitespace').asText();
  document.destroy();
  return JSON.stringify(text);
}

const report = /** @param {string} title @param {{ saved: Uint8Array, positioned: unknown }} result */ async (title, result) => {
  const content = await contentOf(result.saved);
  process.stdout.write(`\n## ${title}\n`);
  process.stdout.write(`SetPositions answered: ${String(result.positioned)}\n`);
  process.stdout.write(`content: ${JSON.stringify(content.split('\n').filter((line) => /T[Jj]|BDC|EMC|Tc|Tw|Td|Tm/u.test(line)))}\n`);
  process.stdout.write(`pdfium: ${JSON.stringify(pdfiumRead(result.saved))}\n`);
  process.stdout.write(`mupdf: ${mupdfRead(result.saved)}\n`);
};

// THE CONTROL: no positions, the font's own advances.
await report('control: "AB CD", no positions', await written('AB CD', null, null));
// CHARACTER SPACING: each position the advance so far plus 4 points per character.
const advances = [13.34, 13.34, 5.56, 14.44]; // Helvetica 20: A 667, B 667, space 278, C 722 (AFM), in points
let x = 0;
const spaced = advances.map((advance) => (x += advance + 4));
await report('spacing: "AB CD", 4 pt after every character', await written('AB CD', spaced, null));
// JUSTIFY: the space alone widened by 30 points.
await report('justify: "AB CD", the space 30 pt wider', await written('AB CD', [13.34, 26.68, 62.24, 76.68], null));
// A TAB as a character.
await report('tab: "A\\tB", no positions', await written('A\tB', null, null));
// A TAB as a gap with the character kept in ActualText: a space positioned to the stop, marked.
await report('tab as a gap: "A B", B at 72 pt, the space marked ActualText TAB', await written('A B', [13.34, 72], '\t'));
// REALISTIC SIZES: spacing of 1 pt and 0.4 pt (5% and 2% of the size), and a justified space 6 pt wider.
for (const extra of [1, 0.4, 2, 2.5, 3, -1, -2]) {
  let at = 0;
  await report(`spacing: "AB CD", ${String(extra)} pt`, await written('AB CD', advances.map((advance) => (at += advance + extra)), null));
}
await report('justify: "AB CD", the space 6 pt wider', await written('AB CD', [13.34, 26.68, 38.24, 52.68], null));
await report('justify: "AB CD", the space 12 pt wider', await written('AB CD', [13.34, 26.68, 44.24, 58.68], null));

/**
 * Three objects: `A`, a lone space marked `/ActualText (TAB)`, and `B` at the stop. Answers the saved bytes.
 */
async function tabAsOwnObject() {
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  const buffer = Buffer.from(await blank.save());
  const document = LoadMemDocument(buffer, buffer.length, null);
  const page = LoadPage(document, 0);
  const font = LoadStandardFont(document, 'Helvetica');
  /** @param {string} text @param {number} left @param {string | null} actual */
  const place = (text, left, actual) => {
    const object = CreateTextObj(document, font, 20);
    SetText(object, wide(text));
    if (actual !== null) SetStringParam(document, object, AddMark(object, 'Span'), 'ActualText', actual);
    SetMatrix(object, { a: 1, b: 0, c: 0, d: 1, e: left, f: 700 });
    InsertObject(page, object);
  };
  place('A', 100, null);
  place(' ', 113.34, '\t');
  place('B', 172, null);
  GenerateContent(page);
  const saved = serialise(document);
  ClosePage(page);
  CloseDocument(document);
  return { saved, positioned: 'n/a' };
}
await report('tab as its own object: "A", a marked space, "B" at 72 pt', await tabAsOwnObject());
