/**
 * What survives a `@cantoo/pdf-lib` load-and-save, and is the output stable?
 *
 * ADR-0039 routes every content-generation command through a byte-image
 * writer: the document's bytes go in, pdf-lib parses them, draws, and
 * re-serialises. That is a **whole-document rewrite**, and ADR-0006 measured
 * MuPDF's `rearrangePages` rewrite dropping `/AcroForm` while the widget
 * annotations stayed on their pages — fields rendering with an orphaned field
 * tree. So the question this script answers is not academic: if pdf-lib's
 * round trip loses the same four catalog entries, ADR-0039's design is wrong
 * and every Track F row is unbuildable through it.
 *
 * Two readings, and neither is inferable from the other:
 *
 *   1. **Preservation.** Does a document carrying `/AcroForm`, `/Outlines`,
 *      `/Names` and `/OCProperties` still carry all four afterwards — read back
 *      with **MuPDF**, a different library, because pdf-lib reporting that
 *      pdf-lib kept something is one library agreeing with itself.
 *   2. **Reproducibility.** `commandDeclarations.ts` declares `applyWatermark`
 *      as `reproducible: true`, which asserts that re-running it against the
 *      same document writes the same bytes. pdf-lib's `updateMetadata` defaults
 *      to `true` and stamps `ModDate` on save, so the declaration is false
 *      unless the option is turned off. That is exactly the shape of claim this
 *      project requires executed rather than asserted.
 *
 * Run:
 *
 *   node scripts/research/pdfLibRoundTrip.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * A scan for four names in a serialised document answers "found nothing" for a
 * genuine absence and for a broken reader alike, and "all four survived" is the
 * reassuring answer here. So the same reader is pointed at a document built to
 * carry **none** of them, and the script refuses to report if that one comes
 * back carrying any — which separates *the reader works* from *the reader says
 * yes to everything*.
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/** The catalog entries ADR-0006 measured a rebuild dropping. */
const CATALOG_ENTRIES = ['AcroForm', 'Outlines', 'Names', 'OCProperties'];

/**
 * A four-page document carrying all four catalog entries and one text field.
 *
 * The same fixture shape `extractGraft.mjs` builds, and deliberately so: a
 * claim about "the catalog" resting on one entry measured and three assumed is
 * the failure this corpus exists to make impossible.
 *
 * @returns {Promise<Uint8Array>}
 */
async function richDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 4; index += 1) document.addPage([200 + index, 500]);

  const pages = document.getPages();
  const second = pages[1];
  if (second === undefined) throw new Error('the fixture lost a page');

  const field = document.getForm().createTextField('applicant.name');
  field.addToPage(second, { x: 10, y: 10, width: 60, height: 16, font });

  const context = document.context;
  const child = context.obj({ Title: PDFString.of('Chapter one') });
  const childRef = context.register(child);
  const outlines = context.obj({ Type: PDFName.of('Outlines'), First: childRef, Last: childRef });
  document.catalog.set(PDFName.of('Outlines'), context.register(outlines));

  const names = context.obj({ Dests: context.obj({ Names: PDFArray.withContext(context) }) });
  document.catalog.set(PDFName.of('Names'), context.register(names));

  const group = context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of('Layer one') });
  const groupRef = context.register(group);
  const groups = PDFArray.withContext(context);
  groups.push(groupRef);
  const on = PDFArray.withContext(context);
  on.push(groupRef);
  const properties = context.obj({ OCGs: groups, D: context.obj({ ON: on }) });
  document.catalog.set(PDFName.of('OCProperties'), context.register(properties));

  // PINNED, and the reading depends on it. `PDFDocument.create` stamps a
  // `/ModDate` of its own, so a fixture built moments before the round trip
  // carries today's date — and then "pdf-lib stamped a new one" and "pdf-lib
  // left the old one" produce the SAME value and the reading below separates
  // nothing. A date in the past cannot be produced by a stamp.
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));

  // NO OPTIONS ON `save`. `updateMetadata` is a **load** option — pdf-lib
  // stores the flag on the document and `save` reads it back — so passing it
  // here did nothing. It was passed in both places while this file was plain
  // JavaScript, which is what the JSDoc typecheck then caught: the readings
  // below are the load option's, and always were.
  return document.save();
}

/**
 * A document carrying none of the four — the positive control's subject.
 *
 * @returns {Promise<Uint8Array>}
 */
async function bareDocument() {
  const document = await PDFDocument.create();
  document.addPage([200, 500]);
  // NO OPTIONS ON `save`. `updateMetadata` is a **load** option — pdf-lib
  // stores the flag on the document and `save` reads it back — so passing it
  // here did nothing. It was passed in both places while this file was plain
  // JavaScript, which is what the JSDoc typecheck then caught: the readings
  // below are the load option's, and always were.
  return document.save();
}

/**
 * Which of the four catalog entries a document's own catalog holds, read with
 * MuPDF rather than with pdf-lib.
 *
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
function catalogEntriesPresent(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    const trailer = document.getTrailer();
    const root = trailer.get('Root');
    return CATALOG_ENTRIES.filter((name) => {
      const value = root.get(name);
      return value !== undefined && !value.isNull();
    });
  } finally {
    document.destroy();
  }
}

/**
 * How many widget annotations sit on the document's pages.
 *
 * ADR-0006's failure was fields rendering with an orphaned field tree, so the
 * page side and the catalog side are two readings and not one.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function widgetsOnPages(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    let total = 0;
    for (let index = 0; index < document.countPages(); index += 1) {
      const annotations = document.findPage(index).get('Annots');
      if (annotations === undefined || annotations.isNull()) continue;
      total += annotations.length;
    }
    return total;
  } finally {
    document.destroy();
  }
}

/**
 * Loads, draws a watermark on every page, and saves.
 *
 * @param {Uint8Array} bytes
 * @param {boolean} updateMetadata whether pdf-lib may stamp `ModDate`
 * @returns {Promise<Uint8Array>}
 */
async function watermark(bytes, updateMetadata) {
  const document = await PDFDocument.load(bytes, { updateMetadata });
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    page.drawText('DRAFT', {
      x: width / 2 - 60,
      y: height / 2,
      size: 36,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.3,
      rotate: degrees(45),
    });
  }
  return document.save();
}

/**
 * The document information dictionary's `/ModDate`, or `null` if it has none.
 *
 * **Comparing two outputs for equality does not settle the metadata question**,
 * and the first version of this script thought it did: two `updateMetadata:
 * true` runs back to back landed inside one clock tick and came back
 * IDENTICAL, which reads exactly like *pdf-lib does not stamp a date*. That is
 * a fixture the defect also handles correctly — the reading was a property of
 * the runs being fast, and it would have flipped on a slower machine or across
 * a second boundary.
 *
 * So the reading below is of the **value**, which is deterministic: a stamped
 * date is present where an unstamped one is absent, whatever the clock did.
 *
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
function modificationDate(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    const info = document.getTrailer().get('Info');
    if (info === undefined || info.isNull()) return null;
    const date = info.get('ModDate');
    if (date === undefined || date.isNull()) return null;
    return date.asString();
  } finally {
    document.destroy();
  }
}

/** @param {Uint8Array} a @param {Uint8Array} b @returns {boolean} */
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

async function main() {
  const original = await richDocument();
  const bare = await bareDocument();

  // POSITIVE CONTROL FIRST, and the run stops if it fails. `catalogEntriesPresent`
  // reporting all four is the answer this script was written hoping for, and a
  // reader that says yes to everything produces it identically.
  const controlBefore = catalogEntriesPresent(bare);
  if (controlBefore.length !== 0) {
    throw new Error(
      `the reader reported ${controlBefore.join(', ')} on a document that carries none of the ` +
        `four, so it cannot separate presence from absence and nothing below means anything`,
    );
  }
  const seeded = catalogEntriesPresent(original);
  if (seeded.length !== CATALOG_ENTRIES.length) {
    throw new Error(
      `the fixture was built with all four catalog entries and the reader found only ` +
        `${seeded.join(', ') || 'none'} — the fixture or the reader is broken, and either way ` +
        `a survival reading below would be measuring the wrong thing`,
    );
  }

  console.log('fixture');
  console.log(`  bytes                 ${String(original.byteLength)}`);
  console.log(`  catalog entries       ${seeded.join(', ')}`);
  console.log(`  widgets on pages      ${String(widgetsOnPages(original))}`);
  console.log(`  pages                 4`);
  console.log('');

  const stamped = await watermark(original, false);
  console.log('after a pdf-lib load, drawText on every page, and save');
  console.log(`  bytes                 ${String(stamped.byteLength)}`);
  console.log(`  catalog entries       ${catalogEntriesPresent(stamped).join(', ') || 'NONE'}`);
  console.log(`  widgets on pages      ${String(widgetsOnPages(stamped))}`);
  console.log('');

  const again = await watermark(original, false);
  const withMetadata = await watermark(original, true);
  console.log('reproducibility — the same command against the same bytes, twice');
  console.log(`  updateMetadata false  ${sameBytes(stamped, again) ? 'IDENTICAL' : 'DIFFERENT'}`);
  console.log(`  fixture   /ModDate    ${modificationDate(original) ?? 'ABSENT'}`);
  console.log(`  false     /ModDate    ${modificationDate(stamped) ?? 'ABSENT'}`);
  console.log(`  true      /ModDate    ${modificationDate(withMetadata) ?? 'ABSENT'}`);
  console.log('');

  // Applying twice, to see whether a second command reads the first's output.
  const twice = await watermark(stamped, false);
  console.log('applied a second time, to its own output');
  console.log(`  bytes                 ${String(twice.byteLength)}`);
  console.log(`  catalog entries       ${catalogEntriesPresent(twice).join(', ') || 'NONE'}`);
  console.log(`  widgets on pages      ${String(widgetsOnPages(twice))}`);
}

await main();
