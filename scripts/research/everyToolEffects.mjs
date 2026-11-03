// @ts-check
/**
 * WHAT EACH COMMAND OF THE FULL WALK DID, read from the files it left (the reviewer of 2026-11-03: a pass that shows only
 * that a tool responded and the file stayed whole does not show the tool did the right thing). `everyToolWalk.mjs` takes
 * this module's one reading of a PDF and its table of effects, so a row is EFFECT where its check ran and passed, and
 * RESPONDED only with the reason no check reads it.
 *
 * ## One reader, and it is not the application
 *
 * pdf-lib for the document's structure and pdf.js for its words: neither is the engine the app edits with, so a check
 * cannot pass by asking the app what it believes it wrote.
 *
 * ## A check compares the saved copy with the document the step began from
 *
 * The walk's document is copied fresh for every step, so `before` is that copy's reading and `after` the reading of the
 * copy saved and opened again; an export's check reads the file the export's picker was answered with.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from '@cantoo/pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * @typedef {{
 *   pages: number,
 *   rotations: number[],
 *   boxes: string[],
 *   media: string[],
 *   marks: Record<string, number>,
 *   fields: Record<string, string>,
 *   values: Record<string, string>,
 *   texts: string[],
 *   encrypted: boolean,
 *   outline: boolean,
 *   transitions: number,
 *   tabs: string[],
 *   title: string,
 *   contentBytes: number[],
 *   images: number,
 * }} Reading
 */

/** The words of each page, as pdf.js reads them, whitespace collapsed. @param {Uint8Array} bytes */
async function wordsOf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: 'walk-test-1', verbosity: 0 });
  try {
    const loaded = await task.promise;
    /** @type {string[]} */
    const texts = [];
    for (let number = 1; number <= loaded.numPages; number += 1) {
      const content = await (await loaded.getPage(number)).getTextContent();
      texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replaceAll(/\s+/gu, ' ').trim());
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

/**
 * A PDF as the effect checks read it. A file encrypted with the walk's own password is read through it; one that cannot
 * be read at all answers `null`, which every check takes as a failure of its own.
 * @param {string} path
 * @returns {Promise<Reading | null>}
 */
export async function readPdf(path) {
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const encrypted = Buffer.from(bytes).includes('/Encrypt');
  let document;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, password: 'walk-test-1' });
  } catch {
    return null;
  }
  /** @type {Record<string, number>} */
  const marks = {};
  let transitions = 0;
  /** @type {string[]} */
  const tabs = [];
  const contentBytes = [];
  let images = 0;
  for (const page of document.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      for (let at = 0; at < annots.size(); at += 1) {
        const annot = annots.lookup(at);
        if (!(annot instanceof PDFDict)) continue;
        const subtype = String(annot.get(PDFName.of('Subtype')) ?? '/None').replace('/', '');
        marks[subtype] = (marks[subtype] ?? 0) + 1;
      }
    }
    if (page.node.get(PDFName.of('Trans')) !== undefined) transitions += 1;
    tabs.push(String(page.node.get(PDFName.of('Tabs')) ?? ''));
    const contents = page.node.Contents();
    let size = 0;
    const streams = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
    for (const each of streams) {
      const stream = each instanceof PDFRef ? document.context.lookup(each) : each;
      size += /** @type {{ getContentsSize?: () => number }} */ (stream)?.getContentsSize?.() ?? 0;
    }
    contentBytes.push(size);
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    if (xobjects instanceof PDFDict) {
      for (const [, ref] of xobjects.entries()) {
        const object = ref instanceof PDFRef ? document.context.lookup(ref) : ref;
        const dict = /** @type {{ dict?: PDFDict }} */ (object)?.dict;
        if (String(dict?.get(PDFName.of('Subtype')) ?? '') === '/Image') images += 1;
      }
    }
  }
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {Record<string, string>} */
  const values = {};
  try {
    for (const field of document.getForm().getFields()) {
      fields[field.getName()] = field.constructor.name.replace(/^PDF/u, '');
      const value = field.acroField.dict.get(PDFName.of('V'));
      values[field.getName()] = value === undefined ? '' : String(value);
    }
  } catch {
    // A form pdf-lib cannot read is counted as none: the checks that need fields then fail by name.
  }
  const box = (/** @type {{ x: number, y: number, width: number, height: number }} */ b) => [b.x, b.y, b.width, b.height].map((n) => n.toFixed(1)).join(' ');
  // NO WORDS WHERE pdf.js CANNOT READ THEM: every check of words then fails by name rather than this one throwing.
  const texts = await wordsOf(bytes).catch(() => /** @type {string[]} */ ([]));
  return {
    pages: document.getPageCount(),
    rotations: document.getPages().map((page) => page.getRotation().angle),
    boxes: document.getPages().map((page) => box(page.getCropBox())),
    media: document.getPages().map((page) => box(page.getMediaBox())),
    marks,
    fields,
    values,
    texts,
    encrypted,
    outline: document.catalog.get(PDFName.of('Outlines')) !== undefined,
    transitions,
    tabs,
    title: document.getTitle() ?? '',
    contentBytes,
    images,
  };
}

/** How many marks of the given kinds. @param {Reading} reading @param {readonly string[]} kinds */
const marksOf = (reading, kinds) => kinds.reduce((sum, kind) => sum + (reading.marks[kind] ?? 0), 0);
/** Every mark, whatever its kind. @param {Reading} reading */
const allMarks = (reading) => Object.values(reading.marks).reduce((sum, count) => sum + count, 0);
/** The words of every page, as one string. @param {Reading} reading */
const allWords = (reading) => reading.texts.join(' ');

/**
 * The words the walk's document begins with on every page, which a check of words kept or removed looks for. The walk's
 * document draws them (`walkDocument`); they are restated here, the one place outside it, and a check whose `before`
 * does not hold them fails as an instrument that cannot see.
 */
export const WALK_WORDS = 'Every tool is run on these words';
/** The start of page 1's heading, which the walk's selection covers. */
export const HEADING_WORDS = 'Page 1 of';
/** The words on the walk's scanned page, drawn into its picture and nowhere as text (`scannedPageDocument`). */
export const SCANNED_WORDS = 'MONSTERA SCANNED PAGE';

/**
 * @typedef {{ before: Reading, after: Reading | null, outputs: string[], read: (path: string) => Promise<Reading | null> }} EffectContext
 * @typedef {(context: EffectContext) => Promise<string | null> | string | null} EffectCheck
 */

/** A check that needs the saved copy: `null` where it is fine, else what is wrong. @param {(before: Reading, after: Reading) => string | null} check @returns {EffectCheck} */
const saved = (check) => ({ before, after }) => (after === null ? 'no saved copy was read: the command left the document unchanged, or the copy could not be read' : check(before, after));

/** A mark of one of `kinds` more in the saved copy than in the document. @param {...string} kinds */
const addsMark = (...kinds) =>
  saved((before, after) => (marksOf(after, kinds) > marksOf(before, kinds) ? null : `no new ${kinds.join(' or ')} mark: ${JSON.stringify(after.marks)} against ${JSON.stringify(before.marks)}`));

/** A field of one of `kinds` more. @param {...string} kinds */
const addsField = (...kinds) =>
  saved((before, after) => {
    const count = (/** @type {Reading} */ r) => Object.values(r.fields).filter((kind) => kinds.includes(kind)).length;
    return count(after) > count(before) ? null : `no new ${kinds.join(' or ')} field: ${JSON.stringify(after.fields)}`;
  });

/** Page 1 turned by `by` degrees. @param {number} by */
const turns = (by) => saved((before, after) => ((((after.rotations[0] ?? 0) - (before.rotations[0] ?? 0)) % 360) + 360) % 360 === by ? null : `page 1 turned from ${String(before.rotations[0])} to ${String(after.rotations[0])}, not by ${String(by)}`);

/** The page count moved by `by`. @param {number} by */
const pagesBy = (by) => saved((before, after) => (after.pages - before.pages === by ? null : `${String(before.pages)} pages became ${String(after.pages)}, not ${String(before.pages + by)}`));

/** The file an export wrote, by extension, or `null`. @param {string[]} outputs @param {string} extension */
const outputOf = (outputs, extension) => outputs.find((path) => path.toLowerCase().endsWith(`.${extension}`)) ?? null;

/** An Office file whose parts hold `words`. @param {string} extension @param {RegExp} part @param {string} words @returns {EffectCheck} */
const officeHolds = (extension, part, words) => ({ outputs }) => {
  const file = outputOf(outputs, extension);
  if (file === null) return `no .${extension} was written`;
  let parts;
  try {
    parts = unzipSync(new Uint8Array(readFileSync(file)));
  } catch {
    return `the .${extension} is not a package`;
  }
  const text = Object.entries(parts)
    .filter(([name]) => part.test(name))
    .map(([, data]) => strFromU8(data))
    .join(' ');
  return text.includes(words) ? null : `the .${extension}'s ${String(part)} parts do not hold “${words}”`;
};

/** A text file holding `words`. @param {string} extension @param {string} words @returns {EffectCheck} */
const textHolds = (extension, words) => ({ outputs }) => {
  const file = outputOf(outputs, extension);
  if (file === null) return `no .${extension} was written`;
  return readFileSync(file, 'utf8').includes(words) ? null : `the .${extension} does not hold “${words}”`;
};

/** A PDF the export wrote, read and checked. @param {(reading: Reading, before: Reading) => string | null} check @returns {EffectCheck} */
const pdfOut = (check) => async ({ outputs, before, read }) => {
  const file = outputOf(outputs, 'pdf');
  if (file === null) return 'no PDF was written';
  const reading = await read(file);
  return reading === null ? 'the PDF written cannot be read' : check(reading, before);
};

/**
 * THE EFFECTS, by command. A command named here is EFFECT when its check returns `null`, and a failure otherwise; one not
 * named is RESPONDED, and `respondedWhy` says why.
 * @type {Readonly<Record<string, EffectCheck>>}
 */
export const EFFECTS = {
  // PAGES
  'document.rotate-page': turns(90),
  'document.rotate-page-270': turns(270),
  'document.rotate-page-180': turns(180),
  'document.delete-page': pagesBy(-1),
  'document.duplicate-page': pagesBy(1),
  'document.insert-blank-page': saved((before, after) => (after.pages === before.pages + 1 && after.texts.some((words) => words === '') ? null : `no blank page was added: ${String(after.pages)} pages`)),
  'document.insert-from-pdf': saved((before, after) => (after.pages > before.pages ? null : `no page was inserted: ${String(after.pages)} pages`)),
  'document.merge': saved((before, after) => (after.pages > before.pages ? null : `nothing was merged in: ${String(after.pages)} pages`)),
  'document.move-page-earlier': saved((before, after) => (after.texts[0] === before.texts[1] && after.texts[1] === before.texts[0] ? null : 'page 2 is not before page 1')),
  'document.move-page-later': saved((before, after) => (after.texts[1] === before.texts[0] ? null : 'page 1 did not move after page 2')),
  'document.replace-page': saved((before, after) => (after.pages === before.pages && after.texts[0] !== before.texts[0] ? null : 'page 1 holds the same words, so it was not replaced')),
  'document.crop-pages': saved((before, after) => (after.boxes[0] !== before.boxes[0] ? null : `page 1's crop box is unchanged: ${before.boxes[0] ?? ''}`)),
  'document.resize-pages': saved((before, after) => (after.media[0] !== before.media[0] ? null : `page 1's size is unchanged: ${before.media[0] ?? ''}`)),
  'document.page-transition': saved((before, after) => (after.transitions > before.transitions ? null : 'no page carries a transition')),
  'document.tab-order': saved((before, after) => (after.tabs.join() !== before.tabs.join() ? null : 'no page’s tab order was set')),
  // WORDS ON THE PAGE
  'document.header-footer': saved((before, after) => ((after.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 holds no new words')),
  'document.bates-number': saved((before, after) => (/\d{3,}/u.test(after.texts[0] ?? '') && !/\d{3,}/u.test(before.texts[0] ?? '') ? null : 'page 1 holds no number of three or more digits')),
  'document.watermark-pages': saved((before, after) => ((after.contentBytes[0] ?? 0) > (before.contentBytes[0] ?? 0) || (after.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 draws nothing more')),
  'document.page-background': saved((before, after) => ((after.contentBytes[0] ?? 0) !== (before.contentBytes[0] ?? 0) ? null : "page 1's drawing is unchanged")),
  // THE WORDS THE WALK MARKS, the start of page 1's heading (`selectWords` drags across its first line's first 160 px).
  'document.apply-redactions': saved((before, after) => ((before.texts[0] ?? '').includes(HEADING_WORDS) && !(after.texts[0] ?? '').includes(HEADING_WORDS) ? null : 'the marked words are still on page 1')),
  'document.redact-matches': addsMark('Redact'),
  'document.convert-scan': saved((_before, after) => (allWords(after).includes(SCANNED_WORDS) ? null : 'the scanned page’s words are not text in the saved copy')),
  'document.ocr': saved((_before, after) => (allWords(after).includes(SCANNED_WORDS) ? null : 'the scanned page’s words are not text in the saved copy')),
  // FORMS
  'document.flatten-form': saved((before, after) => (Object.keys(before.fields).length > 0 && Object.keys(after.fields).length === 0 ? null : `fields remain: ${JSON.stringify(after.fields)}`)),
  'forms.field-text': addsField('TextField'),
  'forms.field-checkbox': addsField('CheckBox'),
  'forms.field-radio': addsField('RadioGroup'),
  'forms.field-dropdown': addsField('Dropdown'),
  'forms.field-listbox': addsField('OptionList'),
  'forms.field-button': addsField('Button'),
  'forms.field-signature': addsField('Signature'),
  'forms.field-date': addsField('TextField'),
  'forms.duplicate-field': saved((before, after) => (Object.keys(after.fields).length > Object.keys(before.fields).length ? null : 'no field was added')),
  'forms.copy-to-pages': saved((before, after) => (Object.keys(after.fields).length > Object.keys(before.fields).length || allMarks(after) > allMarks(before) ? null : 'no field was copied to another page')),
  'forms.paste-fields': saved((before, after) => (Object.keys(after.fields).length > Object.keys(before.fields).length ? null : 'no field was pasted')),
  // MARKS A TOOL DRAWS, by the gesture `everyToolWalk.mjs` makes with it
  'annotate.rectangle': addsMark('Square'),
  'annotate.ellipse': addsMark('Circle'),
  'annotate.line': addsMark('Line'),
  'annotate.arrow': addsMark('Line'),
  'annotate.highlight-area': addsMark('Highlight', 'Square'),
  // A MARK, OR THE AREA ALREADY APPLIED: saving asks whether to apply the marks first, and the walk answers as a hand,
  // so the saved copy carries the area burned into page 1's drawing (the trial of 2026-11-03).
  'annotate.redact': saved((before, after) => (marksOf(after, ['Redact']) > marksOf(before, ['Redact']) || (after.contentBytes[0] ?? 0) !== (before.contentBytes[0] ?? 0) ? null : 'no redaction mark and page 1’s drawing is unchanged')),
  'annotate.text-box': addsMark('FreeText'),
  'annotate.callout': addsMark('FreeText'),
  'annotate.cloud': addsMark('Polygon', 'Square', 'Circle'),
  'annotate.measure-distance': addsMark('Line'),
  'annotate.sticky-note': addsMark('Text'),
  'annotate.typewriter': addsMark('FreeText'),
  'annotate.caret': addsMark('Caret'),
  'annotate.polygon': addsMark('Polygon'),
  'annotate.polyline': addsMark('PolyLine'),
  'annotate.measure-area': addsMark('Polygon'),
  'annotate.measure-perimeter': addsMark('PolyLine'),
  'annotate.ink': addsMark('Ink'),
  'annotate.highlight': addsMark('Highlight'),
  'annotate.underline': addsMark('Underline'),
  'annotate.strikeout': addsMark('StrikeOut'),
  'annotate.redact-text': addsMark('Redact'),
  // MARKS FROM THE SELECTION
  'text.highlight': addsMark('Highlight'),
  'text.underline': addsMark('Underline'),
  'text.strikeout': addsMark('StrikeOut'),
  'text.redact': addsMark('Redact'),
  'text.comment': saved((before, after) => (allMarks(after) > allMarks(before) ? null : 'no comment was added')),
  'annotate.delete-selection': saved((before, after) => (allMarks(after) < allMarks(before) ? null : 'the comment is still in the file')),
  'edit.cut': saved((before, after) => (allMarks(after) < allMarks(before) ? null : 'the comment is still in the file')),
  'annotate.paste': saved((before, after) => (allMarks(after) > allMarks(before) ? null : 'no comment was pasted')),
  // THE DOCUMENT AS A WHOLE
  'document.protect': saved((_before, after) => (after.encrypted ? null : 'the saved copy is not encrypted')),
  'document.generate-toc': saved((before, after) => (after.outline || after.pages > before.pages ? null : 'neither a page of contents nor bookmarks were written')),
  // EXPORTS, by what the written file holds
  'document.export-word': officeHolds('docx', /^word\/document\.xml$/u, 'Every tool'),
  'document.export-powerpoint': officeHolds('pptx', /^ppt\/slides\/slide\d+\.xml$/u, 'Every tool'),
  'document.export-excel': officeHolds('xlsx', /^xl\//u, 'Pens'),
  'document.export-text': textHolds('txt', WALK_WORDS),
  'document.export-layout-text': textHolds('txt', WALK_WORDS),
  'document.export-annotations-json': textHolds('json', 'walk'),
  'document.export-annotations-xfdf': textHolds('xfdf', 'walk'),
  'document.export-annotations-fdf': textHolds('fdf', 'walk'),
  'document.export-form-data-json': textHolds('json', 'name'),
  'document.export-form-data-xfdf': textHolds('xfdf', 'name'),
  'document.export-form-data-fdf': textHolds('fdf', 'name'),
  'document.export-pdfa': pdfOut((reading, before) => (reading.pages === before.pages && allWords(reading).includes(WALK_WORDS) ? null : 'the PDF/A copy does not hold every page’s words')),
  'document.export-searchable': pdfOut((reading) => (allWords(reading).includes(WALK_WORDS) ? null : 'the searchable copy holds no words')),
  'document.extract-pages': pdfOut((reading, before) => (reading.pages > 0 && reading.pages <= before.pages ? null : `the extracted PDF has ${String(reading.pages)} pages`)),
  'document.optimize': pdfOut((reading, before) => (reading.pages === before.pages ? null : 'the smaller copy lost pages')),
  'document.convert-text-to-curves': pdfOut((reading, before) => (reading.pages === before.pages && !allWords(reading).includes(WALK_WORDS) ? null : 'the curves copy still holds the words as text')),
  'document.export-page-images': ({ outputs }) => {
    const pictures = outputs.filter((path) => /\.(png|jpe?g)$/iu.test(path));
    if (pictures.length === 0) return 'no picture was written';
    const head = readFileSync(pictures[0] ?? '').subarray(0, 4);
    return head[1] === 0x50 || head[0] === 0xff ? null : 'the picture written is not a PNG or a JPEG';
  },
};

/**
 * The files a step's export wrote: its save picker is answered `out-<id>.<extension>` (`answerPickers`), and an export
 * of several files writes them beside that name with a suffix of its own.
 * @param {string} output
 * @param {string} id
 */
export function outputsOf(output, id) {
  const stem = `out-${id}`;
  return readdirSync(output)
    .filter((name) => name.startsWith(stem))
    .map((name) => join(output, name))
    .filter((path) => statSync(path).isFile());
}

/**
 * Why a command not in {@link EFFECTS} is RESPONDED only, by what it is: never a blank.
 * @param {string} id
 */
export function respondedWhy(id) {
  if (id.startsWith('view.') || id.startsWith('app.') || id.startsWith('log.')) return 'a change to the window, judged by the window changing and not by which part of it';
  // OPEN, 2026-11-03: the walk's drag and press with these on placed nothing, and why is not yet read.
  if (['annotate.stamp', 'annotate.link-address', 'annotate.link-page'].includes(id)) return 'the walk’s gesture placed nothing with it on, and why is not yet read: open';
  if (id.startsWith('annotate.') || id.startsWith('text.format.') || id.startsWith('forms.arrange.')) return 'a tool or a change the walk makes with no gesture that leaves a mark it reads back';
  if (id.startsWith('document.import-')) return 'an import of the file its own export wrote, whose values are already the document’s';
  if (id.startsWith('start.') || id.startsWith('ai.') || id.startsWith('cloud.') || id.startsWith('tools.')) return 'a card or a panel that opens on screen, judged by its opening';
  return 'no reading of its result is written yet: judged by what it showed and the saved copy opening whole';
}

/**
 * The walk's scanned page: a picture of printed words with no text in it, the input a scan conversion and Make scanned
 * pages searchable exist for. Drawn by PDFium from a page of words, so the picture is a real raster of letters, then
 * placed alone on a page of its own. `rasterise` is the caller's, so this module binds no engine.
 * @param {(pdf: Uint8Array, width: number, height: number) => Promise<{ width: number, height: number, bgra: Uint8Array }>} rasterise
 */
export async function scannedPageDocument(rasterise) {
  const words = await PDFDocument.create();
  const font = await words.embedFont(StandardFonts.HelveticaBold);
  words.addPage([612, 792]).drawText(SCANNED_WORDS, { x: 72, y: 600, size: 36, font });
  const [width, height] = [1275, 1650];
  const bitmap = await rasterise(await words.save(), width, height);
  // THE BITMAP AS A PNG, by hand: BGRA rows to RGB rows each led by filter 0, deflated, in IHDR, IDAT and IEND.
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = y * (width * 3 + 1) + 1 + x * 3;
      raw[to] = bitmap.bgra[from + 2] ?? 255;
      raw[to + 1] = bitmap.bgra[from + 1] ?? 255;
      raw[to + 2] = bitmap.bgra[from] ?? 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (/** @type {Buffer} */ data) => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const scanned = await PDFDocument.create();
  const picture = await scanned.embedPng(png);
  scanned.addPage([612, 792]).drawImage(picture, { x: 0, y: 0, width: 612, height: 792 });
  return scanned.save();
}
