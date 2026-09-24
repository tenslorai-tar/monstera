// @ts-check
/**
 * When a page's own font cannot carry what is written, can a STANDARD font carry it instead —
 * and what does asking cost?
 *
 * ## The question, and what it decides
 *
 * Translating a page writes words the document never used. Real documents embed their fonts as
 * SUBSETS, which carry only the glyphs the document already had, so a translation into French
 * asks a subset of an English document for `é`, `à` and `ç`. ADR-0096 refuses an edit a font
 * cannot carry, which is right for one block a person is typing into and would refuse most of a
 * translated page. The alternative is a twin: a new text object in one of PDF's standard fonts
 * (Helvetica, Times, Courier — every reader must supply them, so nothing is embedded), at the same
 * size, colour and matrix. Four facts decide it:
 *
 * - **How often does the page's own font refuse Latin-1 text?** The corpus's fonts, asked for a
 *   string of accented Western European letters, read back from the live text page.
 * - **Does the standard twin carry it where the own font did not?** Same string, same read-back.
 * - **The control**: the twin asked for `中`, which no standard font carries. It must read back
 *   unequal every time, or the read-back could not tell a written character from a dropped one.
 * - **What does a live read-back cost?** A write that is checked as it is made loads a text page
 *   per check, so `FPDFText_LoadPage` is timed on each first page.
 *
 * And one for a translation that is planned block by block: **does closing a page without
 * generating its content discard what was set on it?** If it does, a block can be tried on a page
 * that is then thrown away, and the document is untouched.
 *
 * ## The corpus pass prints COUNTS and never a file name
 *
 * ## Findings, 2026-09-24, PDFium 155.0.8044.0, the eleven-file corpus
 *
 * - The run's OWN font carries the accented string for **132 of 457** runs. So a translation into
 *   French written only in the page's fonts would be refused on about seven runs in ten.
 * - Where it did not, the standard twin carries it for **308 of 325**; the positive control — the
 *   same twin writing plain ASCII — reads back for **316 of 325**, so the misses are placements the
 *   text page does not read (this instrument stacks its test objects), not letters the font lacks.
 * - The control: the twin asked for `中` reads back for **0 of 325**.
 * - The twin is chosen by the run's font flags and weight: Helvetica 296, Helvetica-Bold 27,
 *   Helvetica-Oblique 2. Its width for the run's own text is a median **0.997** of the run's.
 * - `FPDFText_LoadPage`: median about 6 ms, max about 32–45 ms, over 336 loads (three runs).
 * - A page closed WITHOUT generating keeps its original text on reload: **5 of 5**.
 *
 * **The first run read the twin back as 0 of 325, and it was the instrument.** The twin had written
 * every character; the read-back carried one trailing U+0020, which the text page generates between
 * objects stacked at one position. The positive control is what exposed it, and a read differing by
 * exactly that one space is now counted apart — nothing else is forgiven.
 *
 * Usage: MONSTERA_CORPUS=<dir> node scripts/research/pdfiumFallbackFont.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

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
const GetFont = required('void *FPDFTextObj_GetFont(void *object)');
const GetFontSize = required('int FPDFTextObj_GetFontSize(void *object, _Out_ float *size)');
const GetFlags = required('int FPDFFont_GetFlags(void *font)');
const GetWeight = required('int FPDFFont_GetWeight(void *font)');
const CreateTextObj = required('void *FPDFPageObj_CreateTextObj(void *doc, void *font, float size)');
const LoadStandardFont = required('void *FPDFText_LoadStandardFont(void *doc, const char *font)');
const FontClose = required('void FPDFFont_Close(void *font)');

InitLibrary();

/** Accented Western European text, every character in WinAnsiEncoding. */
const LATIN = 'Façade déjà vu: Straße, niño, Ærø, crème brûlée, 12 €';
const ALIEN = '中';
const ASCII = 'Plain ASCII text 123';

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

/** @param {unknown} object */
function widthOf(object) {
  const left = [0];
  const bottom = [0];
  const right = [0];
  const top = [0];
  GetBounds(object, left, bottom, right, top);
  return (right[0] ?? 0) - (left[0] ?? 0);
}

/**
 * The standard font a run's own font is nearest to: PDF's flags say fixed-pitch (bit 1), serif
 * (bit 2) and italic (bit 7); the weight or ForceBold (bit 19) says bold.
 *
 * @param {unknown} font
 */
function standardFor(font) {
  const flags = Number(GetFlags(font));
  const known = flags >= 0;
  const fixed = known && (flags & 1) !== 0;
  const serif = known && (flags & 2) !== 0;
  const italic = known && (flags & 64) !== 0;
  const bold = Number(GetWeight(font)) >= 600 || (known && (flags & 0x40000) !== 0);
  if (fixed) return `Courier${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
  if (serif) return `Times${bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '-Roman'}`;
  return `Helvetica${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? Number.NaN : (sorted[Math.floor(sorted.length / 2)] ?? Number.NaN);
}

/** @param {string} directory */
function corpus(directory) {
  let files = 0;
  let runs = 0;
  let ownEqual = 0;
  let twinTried = 0;
  let twinEqual = 0;
  let alienTried = 0;
  let alienEqual = 0;
  let plainEqual = 0;
  /** The code units the first failing twin read back, as hex — what the engine made of the text. */
  let sample = '';
  /** @type {number[]} */
  const widthRatios = [];
  /** @type {number[]} */
  const textPageMs = [];
  let discardTried = 0;
  let discardHeld = 0;
  /** @type {Map<string, number>} */
  const standards = new Map();

  for (const name of readdirSync(directory).filter((entry) => entry.toLowerCase().endsWith('.pdf'))) {
    const bytes = readFileSync(join(directory, name));
    const document = LoadMemDocument(bytes, bytes.length, null);
    if (document === null) continue;
    files += 1;

    // CLOSING WITHOUT GENERATING: set the first run's text, close, reload, read.
    {
      const page = LoadPage(document, 0);
      const before = LoadTextPage(page);
      let first = null;
      let original = '';
      for (let at = 0; at < CountObjects(page); at += 1) {
        const object = GetObject(page, at);
        if (GetObjectType(object) === 1 && textOf(object, before).trim() !== '') {
          first = at;
          original = textOf(object, before);
          SetText(object, wide('CHANGED WITHOUT GENERATING'));
          break;
        }
      }
      CloseTextPage(before);
      ClosePage(page);
      if (first !== null) {
        discardTried += 1;
        const again = LoadPage(document, 0);
        const text = LoadTextPage(again);
        if (textOf(GetObject(again, first), text) === original) discardHeld += 1;
        CloseTextPage(text);
        ClosePage(again);
      }
    }

    const page = LoadPage(document, 0);
    const started = performance.now();
    const reading = LoadTextPage(page);
    textPageMs.push(performance.now() - started);
    /** @type {{ font: unknown, size: number, matrix: Record<string, number>, width: number, text: string }[]} */
    const plans = [];
    for (let at = 0; at < CountObjects(page); at += 1) {
      const object = GetObject(page, at);
      if (GetObjectType(object) !== 1) continue;
      const text = textOf(object, reading);
      if (text.trim() === '') continue;
      const size = [0];
      GetFontSize(object, size);
      /** @type {Record<string, number>} */
      const matrix = {};
      GetMatrix(object, matrix);
      plans.push({ font: GetFont(object), size: size[0] ?? 0, matrix, width: widthOf(object), text });
    }
    CloseTextPage(reading);

    /** @type {Map<string, unknown>} */
    const loaded = new Map();
    const standard = (/** @type {string} */ label) => {
      const held = loaded.get(label);
      if (held !== undefined) return held;
      const font = LoadStandardFont(document, label);
      loaded.set(label, font);
      return font;
    };

    for (const plan of plans) {
      runs += 1;
      const own = CreateTextObj(document, plan.font, plan.size);
      if (own === null) continue;
      SetText(own, wide(LATIN));
      SetMatrix(own, plan.matrix);
      InsertObject(page, own);
      const ownPage = LoadTextPage(page);
      const ownOk = textOf(own, ownPage) === LATIN;
      CloseTextPage(ownPage);
      if (ownOk) {
        ownEqual += 1;
        continue;
      }
      const label = standardFor(plan.font);
      standards.set(label, (standards.get(label) ?? 0) + 1);
      const font = standard(label);
      if (font === null) continue;
      twinTried += 1;
      const twin = CreateTextObj(document, font, plan.size);
      SetText(twin, wide(LATIN));
      SetMatrix(twin, plan.matrix);
      InsertObject(page, twin);
      // HOW DIFFERENT IT LOOKS: the twin saying the run's OWN text, against the run's width.
      const same = CreateTextObj(document, font, plan.size);
      SetText(same, wide(plan.text));
      SetMatrix(same, plan.matrix);
      if (plan.width > 1) widthRatios.push(widthOf(same) / plan.width);
      const alien = CreateTextObj(document, font, plan.size);
      SetText(alien, wide(ALIEN));
      SetMatrix(alien, plan.matrix);
      InsertObject(page, alien);
      alienTried += 1;
      // THE POSITIVE CONTROL: plain ASCII in the same twin font. Without it, a twin that read back
      // nothing at all would make the Latin figure 0 for the instrument's reason, not the font's.
      const plain = CreateTextObj(document, font, plan.size);
      SetText(plain, wide(ASCII));
      SetMatrix(plain, plan.matrix);
      InsertObject(page, plain);
      const started2 = performance.now();
      const twinPage = LoadTextPage(page);
      textPageMs.push(performance.now() - started2);
      // THE THREE TEST OBJECTS SHARE ONE POSITION, so the text page may join them with a space it
      // generates — measured: the first run of this script read the twin back exactly, plus one
      // trailing U+0020. That space is this instrument's layout, not the font, so a read differing
      // ONLY by it is counted apart; nothing else is forgiven.
      const matches = (/** @type {string} */ read, /** @type {string} */ written) =>
        read === written || read === `${written} `;
      const read = textOf(twin, twinPage);
      if (matches(read, LATIN)) twinEqual += 1;
      else if (sample === '') sample = [...read].map((c) => c.charCodeAt(0).toString(16)).join(' ');
      if (matches(textOf(alien, twinPage), ALIEN)) alienEqual += 1;
      if (matches(textOf(plain, twinPage), ASCII)) plainEqual += 1;
      CloseTextPage(twinPage);
    }
    for (const font of loaded.values()) if (font !== null) FontClose(font);
    ClosePage(page);
    CloseDocument(document);
  }

  process.stdout.write(
    `# PDFium ${PDFIUM_VERSION} — a standard-font twin for text a page's font cannot carry\n\n` +
      `  ${String(files)} file(s), ${String(runs)} text run(s) on first pages\n` +
      `  the run's OWN font carries ${JSON.stringify(LATIN)}: ${String(ownEqual)} of ${String(runs)}\n` +
      `  where it did not, the STANDARD twin carries it: ${String(twinEqual)} of ${String(twinTried)}\n` +
      `  CONTROL — the twin asked for ${ALIEN}: ${String(alienEqual)} of ${String(alienTried)} read back equal\n` +
      `  POSITIVE CONTROL — the twin asked for ${JSON.stringify(ASCII)}: ${String(plainEqual)} of ${String(alienTried)}\n` +
      `  the first failing twin read back (hex code units): ${sample === '' ? '(none failed)' : sample}\n` +
      `  twin width / run width for the run's own text: median ${median(widthRatios).toFixed(3)} over ${String(widthRatios.length)}\n` +
      `  standard fonts chosen: ${[...standards].map(([label, count]) => `${label} ${String(count)}`).join(', ')}\n` +
      `  FPDFText_LoadPage: median ${median(textPageMs).toFixed(2)} ms, max ${Math.max(...textPageMs).toFixed(2)} ms over ${String(textPageMs.length)}\n` +
      `  a page closed WITHOUT generating kept its original text on reload: ${String(discardHeld)} of ${String(discardTried)}\n`,
  );
}

try {
  const directory = process.env['MONSTERA_CORPUS'];
  if (directory === undefined) {
    process.stdout.write('MONSTERA_CORPUS is not set; this measurement is about real documents and has nothing to read.\n');
    process.exitCode = 1;
  } else corpus(directory);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
