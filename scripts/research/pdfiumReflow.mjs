// @ts-check
/**
 * Can PDFium lay out a paragraph of edited text in the fonts the page already
 * uses — and what does each call it would need actually do?
 *
 * ## The question, and what it decides
 *
 * The owner rejected the line-picking dialog (2026-09-23): editing text is done
 * IN PLACE, on the page, and a paragraph REFLOWS as it is typed into. The words
 * a person types into a block that is already full have to go somewhere, so a
 * block edit may need a line the page did not have — a new text object, in the
 * font of the run it continues, placed a line below. Four facts decide whether
 * that is buildable at all, and none of them is on the page of a header:
 *
 * - **Can a NEW text object be made in a font the page already uses?**
 *   `FPDFPageObj_CreateTextObj` takes an `FPDF_FONT`; `FPDFTextObj_GetFont`
 *   answers one. Whether the second is accepted by the first — for a standard
 *   font, an embedded one, and a SUBSET one — and whether what was written reads
 *   back from reopened bytes, is the whole feasibility question.
 * - **What does `FPDFFont_GetGlyphWidth` take?** Its parameter is named
 *   `glyph`. A Unicode code point, a character code and a glyph index agree for
 *   `A` in some fonts and not in others, so each is separated below by a
 *   character where they differ. Line breaking is measured with this call, and
 *   a width read for the wrong character breaks every line in the wrong place.
 * - **Does the sum of the widths match where PDFium actually draws the run?**
 *   Read against `FPDFPageObj_GetBounds` of a run written with the same string —
 *   if they disagree, measuring with one and drawing with the other overflows.
 * - **What does a character the subset does not carry do?** Typed text is
 *   arbitrary; a subset font carries only the glyphs the document used.
 *
 * And one for the surface: `FPDFTextObj_GetFontSize` and the font's flags, so
 * the editor drawn over the page can be set at the size and in the style of the
 * text beneath it.
 *
 * ## Nothing here is bound in `pdfiumFfi.ts` yet, deliberately
 *
 * `pdfiumLines.mjs`' rule: a binding written into the adapter before anything
 * drove it is a declaration nothing can contradict.
 *
 * ## Every reading is taken from REOPENED bytes
 *
 * A getter answering what its setter was given proves nothing about what was
 * stored.
 *
 * ## The corpus pass prints COUNTS and never a file name
 *
 * Set `MONSTERA_CORPUS` to a directory of PDFs and the last section repeats the
 * round trip over each file's first page, in whatever fonts real documents
 * carry — which is where a subset font is the ordinary case.
 *
 * **There is no built subset fixture, and the one that was tried is why.** A
 * MuPDF page in Arial, embedded with `addSimpleFont` and cut down with
 * `subsetFonts`, read back through PDFium as a 14-character run 10.26pt wide
 * with every glyph width zero — the fixture disagreeing with itself, before any
 * question about PDFium could be asked of it. Real documents from real writers
 * are the better subject, so the corpus is the subset case.
 *
 * ## Findings, 2026-09-23, PDFium 155.0.8044.0, the eleven-file corpus
 *
 * - `FPDFFont_GetGlyphWidth` takes a UNICODE code point: `€` answers 5.56 at
 *   10pt for U+20AC (Helvetica's 556) and 2.78 for WinAnsi 0x80.
 * - A new object in an existing page font round-trips for 426 of 457 runs.
 * - Summed glyph widths agree with the run's drawn width for 176 of 457; an
 *   UNINSERTED object laid out by PDFium agrees for 355 of 457. The second is
 *   the instrument, because it is the width of the object that will be
 *   written, laid out by the engine that will draw it — the disagreements are
 *   original runs drawn with spacing a plain rewrite does not carry.
 * - A character the font cannot carry is the control, and its figure is
 *   printed beside the round trip's.
 *
 * Usage: node scripts/research/pdfiumReflow.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/**
 * Binds one export, or answers `null` when the build does not export it — so a
 * missing call is a REPORTED line rather than a crash that hides every later
 * finding.
 *
 * @param {string} signature
 * @returns {((...args: unknown[]) => unknown) | null}
 */
function optional(signature) {
  try {
    return /** @type {(...args: unknown[]) => unknown} */ (lib.func(signature));
  } catch {
    return null;
  }
}

/**
 * @param {string} signature
 * @returns {(...args: unknown[]) => any}
 */
function required(signature) {
  return /** @type {(...args: unknown[]) => any} */ (lib.func(signature));
}

const InitLibrary = required('void FPDF_InitLibrary()');
const LoadMemDocument = required('void *FPDF_LoadMemDocument(const void *buf, int size, const char *pw)');
const LoadPage = required('void *FPDF_LoadPage(void *doc, int index)');
const ClosePage = required('void FPDF_ClosePage(void *page)');
const CloseDocument = required('void FPDF_CloseDocument(void *doc)');
const CountObjects = required('int FPDFPage_CountObjects(void *page)');
const GetObject = required('void *FPDFPage_GetObject(void *page, int index)');
const GetObjectType = required('int FPDFPageObj_GetType(void *object)');
const GenerateContent = required('int FPDFPage_GenerateContent(void *page)');
const InsertObject = required('void FPDFPage_InsertObject(void *page, void *object)');
const GetBounds = required(
  'int FPDFPageObj_GetBounds(void *object, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)',
);
koffi.struct('FS_MATRIX', { a: 'float', b: 'float', c: 'float', d: 'float', e: 'float', f: 'float' });
const GetMatrix = required('int FPDFPageObj_GetMatrix(void *object, _Out_ FS_MATRIX *matrix)');
const SetMatrix = required('int FPDFPageObj_SetMatrix(void *object, const FS_MATRIX *matrix)');
const SetText = required('int FPDFText_SetText(void *object, const uint16_t *text)');
const LoadTextPage = required('void *FPDFText_LoadPage(void *page)');
const CloseTextPage = required('void FPDFText_ClosePage(void *textPage)');
const TextObjGetText = required(
  'unsigned long FPDFTextObj_GetText(void *object, void *textPage, _Out_ uint16_t *buffer, unsigned long length)',
);
const SaveWithVersion = required('int FPDF_SaveWithVersion(void *doc, void *writer, int flags, int version)');

const GetFont = optional('void *FPDFTextObj_GetFont(void *object)');
const GetFontSize = optional('int FPDFTextObj_GetFontSize(void *object, _Out_ float *size)');
const GetGlyphWidth = optional('int FPDFFont_GetGlyphWidth(void *font, uint32_t glyph, float size, _Out_ float *width)');
const GetBaseFontName = optional('unsigned long FPDFFont_GetBaseFontName(void *font, _Out_ uint8_t *buffer, size_t length)');
const GetFamilyName = optional('unsigned long FPDFFont_GetFamilyName(void *font, _Out_ uint8_t *buffer, size_t length)');
const GetFlags = optional('int FPDFFont_GetFlags(void *font)');
const GetWeight = optional('int FPDFFont_GetWeight(void *font)');
const GetIsEmbedded = optional('int FPDFFont_GetIsEmbedded(void *font)');
const GetAscent = optional('int FPDFFont_GetAscent(void *font, float size, _Out_ float *ascent)');
const GetDescent = optional('int FPDFFont_GetDescent(void *font, float size, _Out_ float *descent)');
const CreateTextObj = optional('void *FPDFPageObj_CreateTextObj(void *doc, void *font, float size)');

InitLibrary();

process.stdout.write(`# PDFium ${PDFIUM_VERSION} — laying out edited text in the page's own fonts\n\n`);
process.stdout.write('## Which of the calls this needs the pinned build exports\n\n');
for (const [name, bound] of /** @type {const} */ ([
  ['FPDFTextObj_GetFont', GetFont],
  ['FPDFTextObj_GetFontSize', GetFontSize],
  ['FPDFFont_GetGlyphWidth', GetGlyphWidth],
  ['FPDFFont_GetBaseFontName', GetBaseFontName],
  ['FPDFFont_GetFamilyName', GetFamilyName],
  ['FPDFFont_GetFlags', GetFlags],
  ['FPDFFont_GetWeight', GetWeight],
  ['FPDFFont_GetIsEmbedded', GetIsEmbedded],
  ['FPDFFont_GetAscent', GetAscent],
  ['FPDFFont_GetDescent', GetDescent],
  ['FPDFPageObj_CreateTextObj', CreateTextObj],
])) {
  process.stdout.write(`  ${name.padEnd(28)} ${bound === null ? 'NOT EXPORTED' : 'exported'}\n`);
}

const WriteBlock = koffi.pointer(koffi.proto('int WriteBlock(void *self, const void *data, unsigned long size)'));

/**
 * @param {unknown} document
 * @returns {Uint8Array}
 */
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

/**
 * @param {unknown} object
 * @param {unknown} textPage
 */
function textOf(object, textPage) {
  const bytes = Number(TextObjGetText(object, textPage, null, 0));
  if (bytes <= 2) return '';
  const buffer = new Uint16Array(bytes / 2);
  TextObjGetText(object, textPage, buffer, bytes);
  return String.fromCharCode(...buffer.subarray(0, buffer.length - 1));
}

/**
 * @param {(font: unknown, buffer: Uint8Array, length: number) => unknown} call
 * @param {unknown} font
 */
function asciiName(call, font) {
  const buffer = new Uint8Array(256);
  const length = Number(call(font, buffer, buffer.length));
  if (length <= 1) return '(empty)';
  return String.fromCharCode(...buffer.subarray(0, length - 1));
}

/** @param {unknown} object */
function boundsOf(object) {
  const left = [0];
  const bottom = [0];
  const right = [0];
  const top = [0];
  GetBounds(object, left, bottom, right, top);
  return { left: left[0] ?? 0, bottom: bottom[0] ?? 0, right: right[0] ?? 0, top: top[0] ?? 0 };
}

/**
 * The widths `FPDFFont_GetGlyphWidth` answers for each character of `text`,
 * summed, at `size`.
 *
 * @param {unknown} font
 * @param {string} text
 * @param {number} size
 */
function measured(font, text, size) {
  if (GetGlyphWidth === null) return Number.NaN;
  let total = 0;
  for (const character of text) {
    const width = [0];
    if (GetGlyphWidth(font, character.codePointAt(0), size, width) !== 1) return Number.NaN;
    total += width[0] ?? 0;
  }
  return total;
}

/** A pdf-lib page in Helvetica — a STANDARD font, not embedded. */
async function standardFixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Wide iii Euro €', { x: 30, y: 230, size: 11, font });
  return document.save();
}

/**
 * Reads the first text object's font facts, then writes a NEW text object in
 * that font saying `written`, one line below, and reads it back from reopened
 * bytes.
 *
 * @param {Uint8Array} bytes
 * @param {string} label
 * @param {string} written
 */
function examine(bytes, label, written) {
  process.stdout.write(`\n## ${label}\n\n`);
  const document = LoadMemDocument(bytes, bytes.length, null);
  const page = LoadPage(document, 0);
  let source = null;
  for (let at = 0; at < CountObjects(page); at += 1) {
    if (GetObjectType(GetObject(page, at)) === 1) {
      source = GetObject(page, at);
      break;
    }
  }
  if (source === null || GetFont === null) {
    process.stdout.write('  no text object, or FPDFTextObj_GetFont is not exported\n');
    return;
  }
  const font = GetFont(source);
  const size = [0];
  const gotSize = GetFontSize === null ? 0 : GetFontSize(source, size);
  /** @type {Record<string, number>} */
  const matrix = {};
  GetMatrix(source, matrix);
  const base = GetBaseFontName === null ? '(not exported)' : asciiName(GetBaseFontName, font);
  const family = GetFamilyName === null ? '(not exported)' : asciiName(GetFamilyName, font);
  process.stdout.write(
    `  font: base ${base}, family ${family}, flags ${String(GetFlags?.(font))}, weight ${String(GetWeight?.(font))},` +
      ` embedded ${String(GetIsEmbedded?.(font))}\n` +
      `  FPDFTextObj_GetFontSize: returned ${String(gotSize)}, size ${String(size[0])}` +
      `   matrix ${['a', 'b', 'c', 'd', 'e', 'f'].map((key) => Number(matrix[key]).toFixed(2)).join(' ')}\n`,
  );

  // WHAT THE `glyph` PARAMETER IS. `W` is 944/1000 in Helvetica and `i` 222;
  // `€` is U+20AC and WinAnsi 0x80, so a call that answers for 0x20AC and not
  // for 0x80 takes a Unicode code point, and the reverse takes a char code.
  if (GetGlyphWidth !== null) {
    for (const [what, glyph] of /** @type {const} */ ([
      ['W (U+0057)', 0x57],
      ['i (U+0069)', 0x69],
      ['€ as Unicode U+20AC', 0x20ac],
      ['€ as WinAnsi 0x80', 0x80],
      ['Z (absent from the subset fixture)', 0x5a],
    ])) {
      const width = [0];
      const ok = GetGlyphWidth(font, glyph, 10, width);
      process.stdout.write(`  width at 10pt of ${what.padEnd(36)} ok=${String(ok)} ${Number(width[0]).toFixed(3)}\n`);
    }
  }

  const ascent = [0];
  const descent = [0];
  if (GetAscent !== null && GetDescent !== null) {
    GetAscent(font, 11, ascent);
    GetDescent(font, 11, descent);
    process.stdout.write(`  ascent ${Number(ascent[0]).toFixed(2)}, descent ${Number(descent[0]).toFixed(2)} at 11pt\n`);
  }

  const before = boundsOf(source);
  process.stdout.write(
    `  source run bounds x ${before.left.toFixed(2)}..${before.right.toFixed(2)} (width ${(before.right - before.left).toFixed(2)})\n`,
  );

  if (CreateTextObj === null) {
    process.stdout.write('  FPDFPageObj_CreateTextObj is not exported — the continuation line cannot be made\n');
    return;
  }
  const effective = (size[0] ?? 0) * Math.abs(Number(matrix['a'] ?? 1));
  const created = CreateTextObj(document, font, size[0] ?? 0);
  process.stdout.write(`  FPDFPageObj_CreateTextObj(existing font) returned ${created === null ? 'NULL' : 'an object'}\n`);
  if (created === null) return;
  const set = SetText(created, wide(written));
  SetMatrix(created, { ...matrix, f: Number(matrix['f'] ?? 0) - 20 });
  InsertObject(page, created);
  const generated = GenerateContent(page);
  const saved = serialise(document);
  ClosePage(page);
  CloseDocument(document);
  process.stdout.write(`  FPDFText_SetText ${String(set)}, FPDFPage_GenerateContent ${String(generated)}\n`);

  const reopened = LoadMemDocument(saved, saved.length, null);
  const again = LoadPage(reopened, 0);
  const textPage = LoadTextPage(again);
  const last = GetObject(again, CountObjects(again) - 1);
  const read = textOf(last, textPage);
  const drawn = boundsOf(last);
  const sum = measured(GetFont(last), written, effective);
  process.stdout.write(
    `  REOPENED: ${String(CountObjects(again))} objects; the new one reads ${JSON.stringify(read)}` +
      ` (wrote ${JSON.stringify(written)}) — ${read === written ? 'EQUAL' : 'DIFFERENT'}\n` +
      `  its drawn width ${(drawn.right - drawn.left).toFixed(2)} against the summed glyph widths ${sum.toFixed(2)}` +
      ` at the effective size ${effective.toFixed(2)}\n`,
  );
  CloseTextPage(textPage);
  ClosePage(again);
  CloseDocument(reopened);
}

/**
 * The corpus pass: on each file's first page, every text object's font makes a
 * new object saying that object's own text — the characters its font is known
 * to carry — and the reopened reading is compared. Counts only.
 *
 * @param {string} directory
 */
function corpus(directory) {
  process.stdout.write('\n## Corpus: every text object on each first page, rewritten in its own font\n\n');
  let files = 0;
  let objects = 0;
  let equal = 0;
  let sizeAnswered = 0;
  let widthWithin = 0;
  let measuredRuns = 0;
  let zeroSums = 0;
  let probed = 0;
  let probeWithin = 0;
  let alienWritten = 0;
  let alienEqual = 0;
  let liveEqual = 0;
  for (const name of readdirSync(directory).filter((entry) => entry.toLowerCase().endsWith('.pdf'))) {
    const bytes = readFileSync(join(directory, name));
    const document = LoadMemDocument(bytes, bytes.length, null);
    if (document === null) continue;
    files += 1;
    const page = LoadPage(document, 0);
    const textPage = LoadTextPage(page);
    const count = CountObjects(page);
    /** @type {{ font: unknown, size: number, matrix: Record<string, number>, text: string, width: number }[]} */
    const plans = [];
    for (let at = 0; at < count; at += 1) {
      const object = GetObject(page, at);
      if (GetObjectType(object) !== 1 || GetFont === null || GetFontSize === null) continue;
      const text = textOf(object, textPage);
      if (text.trim() === '') continue;
      const size = [0];
      if (GetFontSize(object, size) === 1) sizeAnswered += 1;
      /** @type {Record<string, number>} */
      const matrix = {};
      GetMatrix(object, matrix);
      const bounds = boundsOf(object);
      plans.push({ font: GetFont(object), size: size[0] ?? 0, matrix, text, width: bounds.right - bounds.left });
    }
    CloseTextPage(textPage);
    const before = count;
    for (const plan of plans) {
      if (CreateTextObj === null) break;
      // THE SECOND INSTRUMENT: an object made and laid out by PDFium and never
      // inserted. If its bounds agree with the original run's, the engine that
      // draws can also MEASURE, and no glyph arithmetic of ours is needed.
      const probe = CreateTextObj(document, plan.font, plan.size);
      if (probe !== null) {
        SetText(probe, wide(plan.text));
        SetMatrix(probe, plan.matrix);
        const laid = boundsOf(probe);
        const laidWidth = laid.right - laid.left;
        if (plan.width > 0) {
          probed += 1;
          if (Math.abs(laidWidth - plan.width) <= Math.max(0.5, plan.width * 0.02)) probeWithin += 1;
        }
      }
      const made = CreateTextObj(document, plan.font, plan.size);
      if (made === null) continue;
      SetText(made, wide(plan.text));
      SetMatrix(made, plan.matrix);
      InsertObject(page, made);
      objects += 1;
      // THE MEASUREMENT AGAINST THE ENGINE'S OWN LAYOUT, on text whose glyphs
      // are known to be in the font: within 2% or 0.5pt counts as agreement.
      const effective = plan.size * Math.abs(Number(plan.matrix['a'] ?? 1));
      const sum = measured(plan.font, plan.text, effective);
      if (Number.isFinite(sum) && plan.width > 0) {
        measuredRuns += 1;
        if (sum === 0) zeroSums += 1;
        if (Math.abs(sum - plan.width) <= Math.max(0.5, plan.width * 0.02)) widthWithin += 1;
      }
    }
    // THE POSITIVE SIDE OF THE CONTROL BELOW, read the same way it is: from a
    // LIVE text page, before anything is saved. Without it, a live page that saw
    // no new object at all would make the control read 0 for the wrong reason.
    const livePage = LoadTextPage(page);
    for (const [offset, plan] of plans.entries()) {
      const object = GetObject(page, before + offset);
      if (object !== null && textOf(object, livePage) === plan.text) liveEqual += 1;
    }
    CloseTextPage(livePage);
    GenerateContent(page);
    const saved = serialise(document);
    ClosePage(page);
    CloseDocument(document);

    const reopened = LoadMemDocument(saved, saved.length, null);
    const again = LoadPage(reopened, 0);
    const againText = LoadTextPage(again);
    for (const [offset, plan] of plans.entries()) {
      const object = GetObject(again, before + offset);
      if (object !== null && textOf(object, againText) === plan.text) equal += 1;
    }
    CloseTextPage(againText);

    // THE CONTROL FOR THE ROUND TRIP: the same fonts asked to write a character
    // no Latin font carries. If this read back EQUAL as often as the run's own
    // text does, the comparison above could not tell a written character from a
    // dropped one, and a check built on it would pass everything.
    for (let at = 0; at < CountObjects(again) && at < before; at += 1) {
      const object = GetObject(again, at);
      if (GetObjectType(object) !== 1 || GetFont === null || GetFontSize === null || CreateTextObj === null) continue;
      const size = [0];
      GetFontSize(object, size);
      const alien = CreateTextObj(reopened, GetFont(object), size[0] ?? 0);
      if (alien === null) continue;
      SetText(alien, wide('中'));
      InsertObject(again, alien);
      alienWritten += 1;
      const alienPage = LoadTextPage(again);
      if (textOf(alien, alienPage) === '中') alienEqual += 1;
      CloseTextPage(alienPage);
    }
    ClosePage(again);
    CloseDocument(reopened);
  }
  process.stdout.write(
    `  ${String(files)} file(s), ${String(objects)} text object(s) rewritten in their own font\n` +
      `  read back EQUAL from reopened bytes: ${String(equal)} of ${String(objects)}\n` +
      `  read back EQUAL from the LIVE text page, before saving: ${String(liveEqual)} of ${String(objects)}\n` +
      `  FPDFTextObj_GetFontSize answered: ${String(sizeAnswered)}\n` +
      `  summed glyph widths within 2% (or 0.5pt) of the run's drawn width: ${String(widthWithin)} of ${String(measuredRuns)}` +
      ` (${String(zeroSums)} summed to ZERO)\n` +
      `  an UNINSERTED object's own bounds within 2% (or 0.5pt) of the run's: ${String(probeWithin)} of ${String(probed)}\n` +
      `  CONTROL — a character no Latin font carries, read back from the LIVE text page: ${String(alienEqual)} of ${String(alienWritten)}\n`,
  );
}

try {
  examine(await standardFixture(), 'Helvetica, a STANDARD font (pdf-lib, not embedded)', 'Wide iii Euro €');
  const directory = process.env['MONSTERA_CORPUS'];
  if (directory === undefined) process.stdout.write('\n(MONSTERA_CORPUS is not set, so the corpus pass did not run.)\n');
  else corpus(directory);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
