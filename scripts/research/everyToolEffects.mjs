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
 *   links: string[],
 *   rects: Record<string, number[][]>,
 *   fonts: string[],
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
  /** @type {string[]} */
  const links = [];
  /** @type {Record<string, number[][]>} */
  const rects = {};
  const pageRefs = document.getPages().map((page) => page.ref);
  for (const page of document.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      for (let at = 0; at < annots.size(); at += 1) {
        const annot = annots.lookup(at);
        if (!(annot instanceof PDFDict)) continue;
        const subtype = String(annot.get(PDFName.of('Subtype')) ?? '/None').replace('/', '');
        marks[subtype] = (marks[subtype] ?? 0) + 1;
        // WHERE EACH MARK STANDS, its /Rect as numbers, by kind, in page order: what a move is read by.
        const rect = annot.lookup(PDFName.of('Rect'));
        if (rect instanceof PDFArray) rects[subtype] = [...(rects[subtype] ?? []), rect.asArray().map((each) => Number(String(each)))];
        // WHERE A LINK GOES, as a reader follows it: a web address from its action, or the 1-based page its
        // destination's first entry names, whether the destination is the link's own or its GoTo action's.
        if (subtype === 'Link') {
          const action = annot.lookup(PDFName.of('A'));
          const uri = action instanceof PDFDict ? action.lookup(PDFName.of('URI')) : undefined;
          const dest = annot.lookup(PDFName.of('Dest')) ?? (action instanceof PDFDict ? action.lookup(PDFName.of('D')) : undefined);
          const first = dest instanceof PDFArray ? dest.get(0) : undefined;
          const pageAt = first instanceof PDFRef ? pageRefs.findIndex((ref) => ref === first || ref.toString() === first.toString()) : -1;
          if (uri !== undefined) links.push(`uri:${/** @type {{ decodeText?: () => string }} */ (uri).decodeText?.() ?? String(uri)}`);
          else if (pageAt >= 0) links.push(`page:${String(pageAt + 1)}`);
          else links.push('unknown');
        }
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
    links,
    rects,
    fonts: fontsOf(document.getPages()[0]?.node.Resources()),
  };
}

/**
 * The base font names page 1 draws with, from its resources and its forms' resources, a level deep.
 * @param {PDFDict | undefined} resources
 * @returns {string[]}
 */
function fontsOf(resources) {
  /** @type {string[]} */
  const names = [];
  const read = (/** @type {PDFDict | undefined} */ from, /** @type {number} */ depth) => {
    const fonts = from?.lookup(PDFName.of('Font'));
    if (fonts instanceof PDFDict) {
      for (const [, ref] of fonts.entries()) {
        const font = ref instanceof PDFRef ? fonts.context.lookup(ref) : ref;
        if (font instanceof PDFDict) names.push(String(font.get(PDFName.of('BaseFont')) ?? '').replace('/', ''));
      }
    }
    const xobjects = from?.lookup(PDFName.of('XObject'));
    if (depth > 0 && xobjects instanceof PDFDict) {
      for (const [, ref] of xobjects.entries()) {
        const object = ref instanceof PDFRef ? xobjects.context.lookup(ref) : ref;
        const inner = /** @type {{ dict?: PDFDict }} */ (object)?.dict?.lookup(PDFName.of('Resources'));
        if (inner instanceof PDFDict) read(inner, depth - 1);
      }
    }
  };
  read(resources, 1);
  return names;
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
 * What the walk types into each link tool's line: a web address, and page 2 rather than 1, so a link that went to the
 * page it sits on by default is not read as the one typed.
 * @type {Readonly<Record<string, string>>}
 */
export const LINK_TYPED = { 'annotate.link-address': 'https://example.org/walk', 'annotate.link-page': '2' };

/**
 * What a hand types into the empty fields of a command's question where an empty one is valid and does nothing, so the
 * walk's word would be refused and taken back and nothing done: Crop pages' four margins, where empty is zero; and where
 * a field takes pages, the pages: Replace pages' pages to take from the second document; and where it takes words to find,
 * a word the walk's document has.
 * @type {Readonly<Record<string, string>>}
 */
export const FIELD_TYPED = { 'document.crop-pages': '36', 'document.replace-page': '1', 'document.redact-matches': 'tool' };
/**
 * A word a tool's words are typed as where the walk's own words would not separate anything: "walk" is on every page of
 * the walk's document already.
 * @type {Readonly<Record<string, string>>}
 */
export const TYPED_WORD = { 'text.add': 'Quillfeather' };

/**
 * @typedef {{ before: Reading, prepared: Reading | null, after: Reading | null, outputs: string[], read: (path: string) => Promise<Reading | null> }} EffectContext
 * @typedef {(context: EffectContext) => Promise<string | null> | string | null} EffectCheck
 */

/**
 * The command each command that takes something away is given first, as a hand gives it (the walk's `prepare`), and
 * whose state is saved and read before the command runs (`prepared`): a removal judged against the fresh copy alone
 * passes where the add placed nothing, since both leave the page as it began.
 * @type {Readonly<Record<string, string>>}
 */
export const ADDED_FIRST = {
  'document.remove-watermark': 'document.watermark-pages',
  'document.remove-bates': 'document.bates-number',
  'document.remove-header-footer': 'document.header-footer',
};

/**
 * A removal: the prepared state carries what `added` says it adds, and the saved copy draws page 1's words as the fresh
 * copy did and less than the prepared state did.
 * @param {(before: Reading, prepared: Reading) => string | null} added
 * @returns {EffectCheck}
 */
const removes = (added) => ({ before, prepared, after }) => {
  if (prepared === null) return 'the state before the removal was not saved and read';
  return removed(added, before, prepared, after);
};

/**
 * The walk document's one note (`Text`, the comment the walk selects), moved by exactly `dx`, `dy` points along the
 * page's axes: a nudge is 1 point, or 10 (`annotationCommands.ts`' `NUDGE` and `NUDGE_FAR`).
 * @param {number} dx @param {number} dy @returns {EffectCheck}
 */
const movesNote = (dx, dy) =>
  saved((before, after) => {
    const [was] = before.rects['Text'] ?? [];
    const [now] = after.rects['Text'] ?? [];
    if (was === undefined || now === undefined) return 'the note is not on the page before and after';
    const moved = [(now[0] ?? 0) - (was[0] ?? 0), (now[1] ?? 0) - (was[1] ?? 0)];
    return Math.abs((moved[0] ?? 0) - dx) < 0.01 && Math.abs((moved[1] ?? 0) - dy) < 0.01 ? null : `the note moved ${JSON.stringify(moved.map((n) => Number(n.toFixed(2))))}, not [${String(dx)}, ${String(dy)}]`;
  });

/** Page 1's words, spaces aside. @param {Reading} reading */
const wordsOfPage1 = (reading) => (reading.texts[0] ?? '').replaceAll(/\s+/gu, '');

/**
 * A change to how page 1 draws its words that leaves the words themselves as they were.
 * @param {import('./everyToolEffects.mjs').EffectContext} context
 */
function redrawnKeepingWords({ before, after }) {
  if (after === null) return 'no saved copy was read: the command left the document unchanged, or the copy could not be read';
  if (wordsOfPage1(after) !== wordsOfPage1(before)) return `page 1’s words changed: ${JSON.stringify((after.texts[0] ?? '').slice(0, 120))}`;
  return (after.contentBytes[0] ?? 0) !== (before.contentBytes[0] ?? 0) ? null : 'page 1 draws as it did';
}

/** A widget's rectangle as its corners in order. @param {number[]} r */
const box = (r) => {
  const [a = 0, b = 0, c = 0, d = 0] = r;
  return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
};

/** How many pairs of the page's fields agree on `of`, to a hundredth of a point. @param {Reading} reading @param {(r: ReturnType<typeof box>) => number[]} of */
const pairsAgreeing = (reading, of) => {
  const values = (reading.rects['Widget'] ?? []).map((r) => of(box(r)));
  let pairs = 0;
  for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) if ((values[i] ?? []).every((v, at) => Math.abs(v - ((values[j] ?? [])[at] ?? Number.NaN)) < 0.01)) pairs += 1;
  return pairs;
};

/**
 * A field arrangement (`forms/arrange.ts`): some field moved or changed size, and more pairs of the page's fields agree on
 * what the arrangement makes equal than before.
 * @param {(r: ReturnType<typeof box>) => number[]} of @returns {EffectCheck}
 */
const arranges = (of) =>
  saved((before, after) => {
    if (JSON.stringify(after.rects['Widget'] ?? []) === JSON.stringify(before.rects['Widget'] ?? [])) return 'no field moved or changed size';
    const [was, now] = [pairsAgreeing(before, of), pairsAgreeing(after, of)];
    return now > was ? null : `${String(now)} pair(s) of fields agree after, ${String(was)} before`;
  });

/**
 * A distribution: some field moved, and three of the page's fields, in order along `axis`, stand at equal gaps.
 * @param {'x' | 'y'} axis @returns {EffectCheck}
 */
const distributes = (axis) =>
  saved((before, after) => {
    if (JSON.stringify(after.rects['Widget'] ?? []) === JSON.stringify(before.rects['Widget'] ?? [])) return 'no field moved';
    const spans = (after.rects['Widget'] ?? []).map(box).map((r) => (axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1])).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    for (let i = 0; i + 2 < spans.length; i += 1) {
      const [a, b, c] = [spans[i] ?? [], spans[i + 1] ?? [], spans[i + 2] ?? []];
      if (Math.abs((b[0] ?? 0) - (a[1] ?? 0) - ((c[0] ?? 0) - (b[1] ?? 0))) < 0.01) return null;
    }
    return `no three fields stand at equal gaps along ${axis}: ${JSON.stringify(spans)}`;
  });

/**
 * {@link removes} once the prepared state is read.
 * @param {(before: Reading, prepared: Reading) => string | null} added @param {Reading} before @param {Reading} prepared @param {Reading | null} after
 */
const removed = (added, before, prepared, after) => {
  const put = added(before, prepared);
  if (put !== null) return `the add given first placed nothing to remove: ${put}`;
  if (after === null) return 'no saved copy was read after the removal';
  if ((after.texts[0] ?? '') !== (before.texts[0] ?? '')) return `page 1’s words are not the fresh copy’s: ${JSON.stringify((after.texts[0] ?? '').slice(0, 120))}`;
  return (after.contentBytes[0] ?? 0) < (prepared.contentBytes[0] ?? 0) ? null : 'page 1 draws no less than with the mark on it';
};

/** A check that needs the saved copy: `null` where it is fine, else what is wrong. @param {(before: Reading, after: Reading) => string | null} check @returns {EffectCheck} */
const saved = (check) => ({ before, after }) => (after === null ? 'no saved copy was read: the command left the document unchanged, or the copy could not be read' : check(before, after));

/**
 * A redaction mark, read by what it did: a Redact kept, or the marked words `gone` from page 1 while `kept` stays. A
 * save with a mark pending asks first, and the walk answers its primary, Apply, which burns the mark in
 * (`pendingRedactions.ts`); the copy then holds no Redact, and read for one the three marking commands failed while the
 * words they marked were gone (the final walk of 2026-11-04).
 * @param {string} gone @param {string} kept
 * @returns {EffectCheck}
 */
const burnedOrMarked = (gone, kept) =>
  saved((before, after) => {
    if ((after.marks['Redact'] ?? 0) > (before.marks['Redact'] ?? 0)) return null;
    const page = after.texts[0] ?? '';
    return (before.texts[0] ?? '').includes(gone) && !page.includes(gone) && page.includes(kept)
      ? null
      : `the marked words are neither marked nor removed: ${JSON.stringify(after.marks)}`;
  });

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
  // PAGE 1 HOLDS THE SECOND DOCUMENT'S WORDS: the pages it is replaced by are as many as the dialog takes, all of the
  // second document's when its page field is left empty, so the count is not the reading (7 of 3 − 1 + 5, 2026-11-04).
  'document.replace-page': saved((before, after) =>
    // BY THE WALK'S OWN HEADING IN FULL: the second document's page 1 begins *Page 1 of 5*, which `HEADING_WORDS` matches.
    after.texts[0] !== before.texts[0] && !(after.texts[0] ?? '').includes("Page 1 of the walk's") && after.texts.some((words) => words.includes("Page 2 of the walk's"))
      ? null
      : 'page 1 holds the same words, so it was not replaced',
  ),
  'document.crop-pages': saved((before, after) => (after.boxes[0] !== before.boxes[0] ? null : `page 1's crop box is unchanged: ${before.boxes[0] ?? ''}`)),
  'document.resize-pages': saved((before, after) => (after.media[0] !== before.media[0] ? null : `page 1's size is unchanged: ${before.media[0] ?? ''}`)),
  'document.page-transition': saved((before, after) => (after.transitions > before.transitions ? null : 'no page carries a transition')),
  'document.tab-order': saved((before, after) => (after.tabs.join() !== before.tabs.join() ? null : 'no page’s tab order was set')),
  // WORDS ON THE PAGE
  'document.header-footer': saved((before, after) => ((after.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 holds no new words')),
  'document.bates-number': saved((before, after) => (/\d{3,}/u.test(after.texts[0] ?? '') && !/\d{3,}/u.test(before.texts[0] ?? '') ? null : 'page 1 holds no number of three or more digits')),
  'document.watermark-pages': saved((before, after) => ((after.contentBytes[0] ?? 0) > (before.contentBytes[0] ?? 0) || (after.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 draws nothing more')),
  'document.remove-header-footer': removes((before, prepared) => ((prepared.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 held no new words')),
  'document.remove-bates': removes((before, prepared) => (/\d{3,}/u.test(prepared.texts[0] ?? '') && !/\d{3,}/u.test(before.texts[0] ?? '') ? null : 'page 1 held no Bates number')),
  'document.remove-watermark': removes((before, prepared) =>
    (prepared.contentBytes[0] ?? 0) > (before.contentBytes[0] ?? 0) || (prepared.texts[0] ?? '').length > (before.texts[0] ?? '').length ? null : 'page 1 drew nothing more',
  ),
  // A DOCUMENT MADE FROM THE WALK'S OWN FILE (the walk's `MARKDOWN`, `TABLE`, `WORD` and `PICTURE`), read for its words or
  // its picture: the new document is the PDF the command wrote where its save picker was answered, and the trial of
  // 2026-11-04 read no unsaved tab, the file being already written.
  'document.new-from-markdown': pdfOut((made) => (made.texts.join(' ').includes('ordinary') ? null : `the new document holds not the Markdown’s words: ${JSON.stringify(made.texts.join(' ').slice(0, 120))}`)),
  'document.new-from-csv': pdfOut((made) => (made.texts.join(' ').includes('Pens') ? null : `the new document holds not the table’s rows: ${JSON.stringify(made.texts.join(' ').slice(0, 120))}`)),
  'document.new-from-office': pdfOut((made) => (made.texts.join(' ').includes('A letter the walk wrote') ? null : `the new document holds not the letter’s words: ${JSON.stringify(made.texts.join(' ').slice(0, 120))}`)),
  'document.new-from-images': pdfOut((made) => (made.images > 0 ? null : 'the new document holds no picture')),
  'document.insert-image': saved((before, after) => (after.pages > before.pages && after.images > before.images ? null : `pages ${String(before.pages)} to ${String(after.pages)}, pictures ${String(before.images)} to ${String(after.images)}`)),
  'document.append-markdown': saved((before, after) => (after.pages > before.pages && after.texts.slice(before.pages).join(' ').includes('ordinary') ? null : `pages ${String(before.pages)} to ${String(after.pages)}, and no new page holds the Markdown’s words`)),
  ...Object.fromEntries(
    /** @type {const} */ ([['left', -1, 0], ['right', 1, 0], ['up', 0, 1], ['down', 0, -1]]).flatMap(([way, dx, dy]) =>
      /** @type {const} */ ([['', 1], ['-far', 10]]).map(([far, step]) => [`annotate.nudge-${way}${far}`, movesNote(dx * step, dy * step)]),
    ),
  ),
  // A FORMAT OF THE CHOSEN WORDS of page 1's first block (the walk's `prepare` chooses them): a face of the kind the
  // format names appears, or, for a format with no face of its own, page 1 draws differently with its words unchanged.
  // BOLD BY ITS NAME OR ITS NAMED WEIGHT: the face the edit embeds is a variable font's instance, named by its weight
  // ("Arimo-Regular-wght700", the trial of 2026-11-04), not "Bold".
  'text.format.bold': saved((before, after) => {
    const bold = (/** @type {string} */ f) => /Bold|wght[6-9]00/u.test(f);
    return after.fonts.some(bold) && !before.fonts.some(bold) ? null : `no bold face: ${JSON.stringify(after.fonts)}`;
  }),
  'text.format.italic': saved((before, after) => (after.fonts.some((f) => /Italic|Oblique/u.test(f)) && !before.fonts.some((f) => /Italic|Oblique/u.test(f)) ? null : `no italic face: ${JSON.stringify(after.fonts)}`)),
  ...Object.fromEntries(['underline', 'strike', 'subscript', 'superscript', 'align-center', 'align-right', 'align-justify', 'indent-more'].map((name) => [`text.format.${name}`, redrawnKeepingWords])),
  'text.format.bullets': saved((before, after) => (/[•‣◦▪•]/u.test(after.texts[0] ?? '') && !/[•‣◦▪]/u.test(before.texts[0] ?? '') ? null : `no bullet on page 1: ${JSON.stringify((after.texts[0] ?? '').slice(0, 120))}`)),
  'text.format.numbering': saved((before, after) => ((after.texts[0] ?? '').replace(before.texts[0] ?? '', '') !== '' && /(^|\s)1[.)]/u.test(after.texts[0] ?? '') ? null : `no number on page 1: ${JSON.stringify((after.texts[0] ?? '').slice(0, 120))}`)),
  'forms.arrange.align-left': arranges((r) => [r.x0]),
  'forms.arrange.align-right': arranges((r) => [r.x1]),
  'forms.arrange.align-top': arranges((r) => [r.y1]),
  'forms.arrange.align-bottom': arranges((r) => [r.y0]),
  'forms.arrange.centre-horizontally': arranges((r) => [(r.x0 + r.x1) / 2]),
  'forms.arrange.centre-vertically': arranges((r) => [(r.y0 + r.y1) / 2]),
  'forms.arrange.same-width': arranges((r) => [r.x1 - r.x0]),
  'forms.arrange.same-height': arranges((r) => [r.y1 - r.y0]),
  'forms.arrange.same-size': arranges((r) => [r.x1 - r.x0, r.y1 - r.y0]),
  'forms.arrange.distribute-horizontally': distributes('x'),
  'forms.arrange.distribute-vertically': distributes('y'),
  // THE COPY, written where its picker was answered: the document's pages and page 1's words.
  'document.save-copy': pdfOut((copy, before) => (copy.pages === before.pages && wordsOfPage1(copy) === wordsOfPage1(before) ? null : `the copy holds ${String(copy.pages)} pages against ${String(before.pages)}, or other words on page 1`)),
  'document.delete-pages': saved((before, after) => (after.pages < before.pages ? null : `pages ${String(before.pages)} to ${String(after.pages)}`)),
  // THE PARTS BESIDE THE DOCUMENT (`doc-<id> 1.pdf` and on, `outputsOf`), every page in exactly one.
  'document.split': async ({ before, outputs, read }) => {
    const parts = outputs.filter((path) => /\s\d+\.pdf$/u.test(path));
    if (parts.length < 2) return `${String(parts.length)} part(s) were written`;
    let pages = 0;
    for (const part of parts) {
      const reading = await read(part);
      if (reading === null || reading.pages === 0) return `a part cannot be read or holds no page: ${part}`;
      pages += reading.pages;
    }
    return pages === before.pages ? null : `the parts hold ${String(pages)} pages, the document ${String(before.pages)}`;
  },
  // UNDO OF THE ROTATION THE WALK GIVES FIRST (`prepare`): the prepared state is turned, and the document after the undo
  // is the fresh copy's turn again, saved or left clean (no saved copy is then the effect, not its absence).
  'document.undo': ({ before, prepared, after }) => {
    if (prepared === null) return 'the turned state before the undo was not saved and read';
    if (JSON.stringify(prepared.rotations) === JSON.stringify(before.rotations)) return 'the rotation given first turned nothing, so the undo had nothing to undo';
    if (after === null) return null;
    return JSON.stringify(after.rotations) === JSON.stringify(before.rotations) ? null : `the pages are still turned: ${JSON.stringify(after.rotations)}`;
  },
  // REDO OF THAT ROTATION, undone first: the prepared state is the fresh copy's turn, and the saved copy is turned again.
  'document.redo': ({ before, prepared, after }) => {
    if (prepared === null) return 'the undone state before the redo was not saved and read';
    if (JSON.stringify(prepared.rotations) !== JSON.stringify(before.rotations)) return 'the undo given first left the pages turned';
    if (after === null) return 'no saved copy was read after the redo';
    return JSON.stringify(after.rotations) !== JSON.stringify(before.rotations) ? null : 'the redo turned no page';
  },
  'document.page-background': saved((before, after) => ((after.contentBytes[0] ?? 0) !== (before.contentBytes[0] ?? 0) ? null : "page 1's drawing is unchanged")),
  // THE WORDS THE WALK MARKS, the start of page 1's heading (`selectWords` drags across its first line's first 160 px).
  'document.apply-redactions': saved((before, after) => ((before.texts[0] ?? '').includes(HEADING_WORDS) && !(after.texts[0] ?? '').includes(HEADING_WORDS) ? null : 'the marked words are still on page 1')),
  // EVERY "tool" MARKED, then burned in by the save's Apply as Mark text for redaction's is, or kept as marks: the walk
  // searches for a word its document has (`FIELD_TYPED`); its own test word matched nothing and marked nothing (the final
  // walk of 2026-11-04).
  'document.redact-matches': saved((before, after) => {
    if ((after.marks['Redact'] ?? 0) > (before.marks['Redact'] ?? 0)) return null;
    return allWords(before).includes(' tool ') && !allWords(after).includes(' tool ') && allWords(after).includes('Every')
      ? null
      : `the matches are neither marked nor removed: ${JSON.stringify(after.marks)}`;
  }),
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
  'annotate.stamp': addsMark('Stamp'),
  'annotate.eraser': saved((before, after) => ((after.marks['Text'] ?? 0) < (before.marks['Text'] ?? 0) ? null : `the note is still there: ${JSON.stringify(after.marks)}`)),
  // A PICTURE PLACED, as a mark carrying it or drawn on the page.
  'annotate.image': saved((before, after) => (allMarks(after) > allMarks(before) || after.images > before.images ? null : `no new mark and no new picture: ${JSON.stringify(after.marks)}`)),
  'text.add': saved((before, after) => (after.texts.join(' ').includes(TYPED_WORD['text.add'] ?? '') && !before.texts.join(' ').includes(TYPED_WORD['text.add'] ?? '') ? null : `the typed word is not on any page: ${JSON.stringify((after.texts[0] ?? '').slice(0, 160))}`)),
  // A LINK THAT GOES WHERE IT WAS TOLD, read the way a reader follows it: the address or page the walk typed (`LINK_TYPED`).
  'annotate.link-address': saved((before, after) => (after.links.filter((each) => each === `uri:${LINK_TYPED['annotate.link-address']}`).length > before.links.filter((each) => each === `uri:${LINK_TYPED['annotate.link-address']}`).length ? null : `no new link to the typed address: ${JSON.stringify(after.links)}`)),
  'annotate.link-page': saved((before, after) => (after.links.filter((each) => each === `page:${LINK_TYPED['annotate.link-page']}`).length > before.links.filter((each) => each === `page:${LINK_TYPED['annotate.link-page']}`).length ? null : `no new link to the typed page: ${JSON.stringify(after.links)}`)),
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
  // THE MARKED WORDS GONE AND THE REST OF THE LINE KEPT: the tool's gesture marks the first paragraph's opening words.
  'annotate.redact-text': burnedOrMarked(WALK_WORDS, 'a person runs it'),
  // MARKS FROM THE SELECTION
  'text.highlight': addsMark('Highlight'),
  'text.underline': addsMark('Underline'),
  'text.strikeout': addsMark('StrikeOut'),
  // THE SELECTION THE WALK MAKES, the first line's words dragged over: the heading's opening, the paragraph kept.
  'text.redact': burnedOrMarked("Page 1 of the walk's", WALK_WORDS),
  'text.comment': saved((before, after) => (allMarks(after) > allMarks(before) ? null : 'no comment was added')),
  'annotate.delete-selection': saved((before, after) => (allMarks(after) < allMarks(before) ? null : 'the comment is still in the file')),
  'edit.cut': saved((before, after) => (allMarks(after) < allMarks(before) ? null : 'the comment is still in the file')),
  'annotate.paste': saved((before, after) => (allMarks(after) > allMarks(before) ? null : 'no comment was pasted')),
  // THE DOCUMENT AS A WHOLE
  'document.protect': saved((_before, after) => (after.encrypted ? null : 'the saved copy is not encrypted')),
  // A PAGE THAT LISTS THE BOOKMARKS, walked on a copy that has them (`bookmarkedDocument`): an outline is no reading, since
  // the copy had one before the command ran, and only the inserted page carries their titles as words.
  'document.generate-toc': saved((before, after) =>
    after.pages > before.pages && after.texts.some((words) => words.includes('Part 1 of the walk')) && !before.texts.some((words) => words.includes('Part 1 of the walk'))
      ? null
      : `no page listing the bookmarks was inserted: ${String(after.pages)} pages`,
  ),
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
  // AND THE PARTS A COMMAND WRITES BESIDE THE DOCUMENT, by its name and a number (`doc-<id> 1.pdf`): Split's.
  // OF ANY KIND: Export pages as images writes its pictures there too (`doc-<id> 1.png`), and a PDF-only pattern read
  // them as no picture written (the final walk of 2026-11-04).
  const beside = new RegExp(`^doc-${id.replaceAll('.', '\\.')} \\d+\\.[a-z]+$`, 'u');
  return readdirSync(output)
    .filter((name) => name.startsWith(stem) || beside.test(name))
    .map((name) => join(output, name))
    .filter((path) => statSync(path).isFile());
}

/**
 * Why a command not in {@link EFFECTS} is RESPONDED only, by what it is: never a blank.
 * @param {string} id
 */
export function respondedWhy(id) {
  if (id.startsWith('view.') || id.startsWith('app.') || id.startsWith('log.')) return 'a change to the window, judged by the window changing and not by which part of it';
  if (id === 'text.format.align-left' || id === 'text.format.indent-less') return 'the walk’s first block is already left-aligned and unindented, so it rightly changes nothing there to read';
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
