/**
 * What does an extract-to-new-PDF carry, and by which route?
 *
 * Extract is a rebuild by definition — the output is a document that did not
 * exist — so ADR-0006's ban on rebuilding the OPEN document does not decide it.
 * What that ADR does establish is the failure class to look for: it measured
 * `rearrangePages` dropping `/AcroForm` while the widget annotations stayed on
 * their pages, so the fields rendered and the field tree was orphaned.
 *
 * Three candidate routes, measured side by side:
 *
 *   A. `graftPage(to, srcDoc, srcPage)` — MuPDF's own page copy.
 *   B. `graftObject(pageDict)` + `insertPage(at, …)` — the object copy
 *      `duplicatePage` already uses within one document.
 *   C. B, plus grafting the four catalog entries a page tree does not carry.
 *
 * Run:
 *
 *   node scripts/research/extractGraft.mjs
 *
 * It prints readings, never a verdict. What it established on 2026-09-04 is in
 * `packages/kernel/src/pageExtract.ts`'s header, and the distinction survives as
 * a mutation-verified case rather than only as this script's output.
 *
 * The fixture carries **all four** catalog entries deliberately: one of them
 * would let a claim about "the catalog" rest on one axis measured and three
 * assumed.
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * A four-page document carrying all four catalog entries and one text field.
 *
 * @returns {Promise<Uint8Array>}
 */
async function richDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 4; index += 1) document.addPage([100 + index, 500]);

  const pages = document.getPages();
  const second = pages[1];
  const third = pages[2];
  if (second === undefined || third === undefined) throw new Error('the fixture lost a page');

  const field = document.getForm().createTextField('applicant.name');
  field.addToPage(second, { x: 10, y: 10, width: 60, height: 16, font });

  const context = document.context;
  const child = context.obj({ Title: PDFString.of('Chapter one') });
  const childRef = context.register(child);
  const outlines = context.obj({
    Type: PDFName.of('Outlines'),
    First: childRef,
    Last: childRef,
    Count: PDFNumber.of(1),
  });
  const outlinesRef = context.register(outlines);
  child.set(PDFName.of('Parent'), outlinesRef);
  document.catalog.set(PDFName.of('Outlines'), outlinesRef);

  const groups = PDFArray.withContext(context);
  groups.push(
    context.register(context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of('A layer') })),
  );
  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({ OCGs: groups, D: context.obj({ Order: groups }) }),
  );

  const names = PDFArray.withContext(context);
  names.push(PDFString.of('anchor'));
  names.push(context.obj([third.ref, PDFName.of('Fit')]));
  document.catalog.set(PDFName.of('Names'), context.obj({ Dests: context.obj({ Names: names }) }));

  return document.save({ useObjectStreams: false });
}

/**
 * Prints what MuPDF sees in a document: the catalog, and each page's `/Annots`.
 *
 * @param {string} label
 * @param {mupdf.PDFDocument} out
 * @returns {void}
 */
function report(label, out) {
  const root = out.getTrailer().get('Root');
  console.log(`--- ${label} ---`);
  console.log('  pages:', out.countPages());
  for (const key of ['AcroForm', 'Outlines', 'Names', 'OCProperties']) {
    console.log(`    /${key}:`, root.get(key).isNull() ? 'ABSENT' : 'present');
  }
  for (let index = 0; index < out.countPages(); index += 1) {
    const page = out.findPage(index);
    const box = page.getInheritable('MediaBox');
    console.log(
      `    page ${String(index)}: /Annots`,
      page.get('Annots').isNull() ? 'absent' : 'PRESENT',
      '· /MediaBox',
      box.isNull() ? 'absent' : box.toString(),
    );
  }
}

/**
 * Prints what a DIFFERENT library sees, which is the only reading that says the
 * bytes are a document rather than that MuPDF agrees with itself.
 *
 * @param {string} label
 * @param {mupdf.PDFDocument} out
 * @returns {Promise<void>}
 */
async function readBack(label, out) {
  const reopened = await PDFDocument.load(out.saveToBuffer().asUint8Array(), {
    updateMetadata: false,
  });
  const fields = reopened.getForm().getFields();
  console.log(`  ${label} read back with pdf-lib:`);
  console.log('    pages:', reopened.getPageCount());
  console.log(
    '    widths:',
    reopened.getPages().map((page) => Math.round(page.getWidth())),
  );
  console.log(
    '    fields:',
    fields.map((field) => `${field.getName()} (${String(field.acroField.getWidgets().length)} widget)`),
  );
}

/**
 * Gives a leaf its inherited geometry outright, so a graft carries it.
 *
 * @param {mupdf.PDFDocument} document
 * @param {number} page
 * @returns {mupdf.PDFObject}
 */
function pushDown(document, page) {
  const leaf = document.findPage(page);
  for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
    if (leaf.get(key).isNull()) {
      const inherited = leaf.getInheritable(key);
      if (!inherited.isNull()) leaf.put(key, inherited);
    }
  }
  return leaf;
}

const bytes = await richDocument();
const opened = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
if (!(opened instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
const source = opened;
report('the source', source);

const viaGraftPage = new mupdf.PDFDocument();
for (const page of [1, 2]) viaGraftPage.graftPage(viaGraftPage.countPages(), source, page);
report('A. graftPage', viaGraftPage);
await readBack('A.', viaGraftPage);

const viaGraftObject = new mupdf.PDFDocument();
for (const page of [1, 2]) {
  viaGraftObject.insertPage(
    viaGraftObject.countPages(),
    viaGraftObject.graftObject(pushDown(source, page)),
  );
}
report('B. graftObject + insertPage', viaGraftObject);
await readBack('B.', viaGraftObject);

const withCatalog = new mupdf.PDFDocument();
for (const page of [1, 2]) {
  withCatalog.insertPage(withCatalog.countPages(), withCatalog.graftObject(pushDown(source, page)));
}
const sourceRoot = source.getTrailer().get('Root');
for (const key of ['AcroForm', 'Outlines', 'Names', 'OCProperties']) {
  const entry = sourceRoot.get(key);
  if (!entry.isNull()) withCatalog.getTrailer().get('Root').put(key, withCatalog.graftObject(entry));
}
report('C. B plus the four catalog entries', withCatalog);
await readBack('C.', withCatalog);
