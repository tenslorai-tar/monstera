// @ts-check
/**
 * What MuPDF actually removes when a form field's widget is deleted.
 *
 * A widget is an entry in a page's `/Annots` **and** a field in the document's
 * `/AcroForm` `/Fields`, and a radio group's widgets are `/Kids` of one field
 * dictionary. So *delete this field* is at least two writes and possibly three,
 * and `PDFPage.deleteAnnotation` is declared over a `PDFAnnotation`
 * (`mupdf.d.ts:578`) with `PDFWidget` extending it — which says nothing about
 * whether it knows any of that.
 *
 * The question decides the shape of the command rather than an implementation
 * detail. If the engine tidies up, deleting is one call. If it does not, this
 * build would be writing `/AcroForm` by hand — a second opinion about a
 * structure MuPDF owns (B3a) — and the row's design has to say so out loud.
 *
 * Four readings, and each one changes what gets built:
 *
 *   1. **Is the widget gone from the page's walk?** The reader's index space is
 *      that walk, so this is what a panel would see.
 *   2. **Is the FIELD gone from `/AcroForm` `/Fields`?** A document listing a
 *      field whose widget no longer exists is one every other reader has to
 *      cope with, and it is the state a half-delete leaves.
 *   3. **What happens to a radio group's siblings?** Deleting one widget of a
 *      group must not leave `/Kids` naming an object that is gone.
 *   4. **Does the other library still open it?** MuPDF agreeing with itself
 *      about a document it just wrote is not evidence that the document is
 *      well-formed.
 *
 * Run:
 *
 *   node scripts/research/formFieldDelete.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * The reassuring answer to *did the delete work* is a smaller number, and a
 * walk that broke returns a smaller number too — zero, which reads as *every
 * field was deleted*. So the script first asserts the fixture has the fields it
 * was built with, and refuses to report if it does not.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * A form with a lone text field, a lone checkbox and a two-widget radio group.
 *
 * The group is the whole of question 3, and the two lone fields are what
 * separate *a delete works* from *a delete works on things with no siblings*.
 *
 * @returns {Promise<Uint8Array>}
 */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();

  const text = form.createTextField('applicant.name');
  text.setText('Ada');
  text.addToPage(page, { x: 20, y: 540, width: 200, height: 20, font });

  const box = form.createCheckBox('applicant.agrees');
  box.check();
  box.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  const radio = form.createRadioGroup('applicant.post');
  radio.addOptionToPage('first', page, { x: 20, y: 460, width: 16, height: 16 });
  radio.addOptionToPage('second', page, { x: 60, y: 460, width: 16, height: 16 });
  radio.select('first');

  // THE MERGED SHAPE, BY HAND, and it is the HARD one (audit item 2). pdf-lib
  // always writes a field dictionary with a `/Kids` array holding a separate
  // widget; the format also allows a field with exactly one widget to be ONE
  // dictionary carrying both — `/FT` and `/T` beside `/Subtype /Widget` — and
  // that is what a great many real forms contain. A delete built and tested
  // only against the split shape has never met the common one.
  const context = document.context;
  const merged = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    T: PDFString.of('merged'),
    Rect: context.obj([20, 400, 220, 420]),
    F: 4,
  });
  const mergedRef = context.register(merged);
  page.node.addAnnot(mergedRef);
  document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray)
    .push(mergedRef);

  return document.save();
}

/**
 * @param {Uint8Array} bytes
 * @returns {mupdf.PDFDocument}
 */
function open(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  return document;
}

/**
 * The `/AcroForm` field tree, as `partial.path → what that node is`.
 *
 * A node is a FIELD, a WIDGET, or both: the format merges them when a field has
 * exactly one widget, which is why `/Subtype /Widget` is checked rather than
 * assumed from the position in the tree. `kids` is the count, so a group that
 * loses one child is visible without reading the whole subtree again.
 *
 * @param {mupdf.PDFObject} fields
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
function tree(fields, prefix) {
  /** @type {Record<string, string>} */
  const found = {};
  if (!fields.isArray()) return found;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields.get(index);
    const title = field.get('T');
    const partial = title.isString() ? title.asString() : '(unnamed)';
    const qualified = prefix === '' ? partial : `${prefix}.${partial}`;
    const kids = field.get('Kids');
    const subtype = field.get('Subtype');
    const isWidget = subtype.isName() && subtype.asName() === 'Widget';
    found[qualified] = kids.isArray()
      ? `${String(kids.length)} kid(s)`
      : isWidget
        ? 'widget'
        : 'field with no kids';
    if (kids.isArray()) Object.assign(found, tree(kids, qualified));
  }
  return found;
}

/**
 * What the document says about itself, from both structures at once.
 *
 * The two counts are kept apart deliberately: the page walk is what a panel
 * sees and `/AcroForm` `/Fields` is what every other reader sees, and a delete
 * that moves one and not the other is exactly the half-state this is looking
 * for.
 *
 * @param {Uint8Array} bytes
 * @returns {{ widgets: string[], acroFields: Record<string, string> }}
 */
function structure(bytes) {
  const document = open(bytes);
  try {
    const widgets = document
      .loadPage(0)
      .getWidgets()
      .map((widget) => widget.getName());

    // THE WHOLE TREE, not the top level. The first spelling of this read only
    // `/Fields`' own entries and reported ONE field for a document built with
    // three, because `/T` is a PARTIAL name and the qualified one is the path:
    // `applicant` holds `name`, `agrees` and `post`. A reading that stops at
    // the top says a three-field form has one field.
    const acroFields = tree(document.getTrailer().get('Root').get('AcroForm').get('Fields'), '');
    return { widgets, acroFields };
  } finally {
    document.destroy();
  }
}

/**
 * Deletes the widgets whose field name matches, and saves.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {{ first?: boolean }} [options] only the first matching widget
 * @returns {Uint8Array}
 */
function deleted(bytes, name, options = {}) {
  const document = open(bytes);
  try {
    const page = document.loadPage(0);
    const matching = page.getWidgets().filter((widget) => widget.getName() === name);
    const chosen = options.first === true ? matching.slice(0, 1) : matching;
    for (const widget of chosen) page.deleteAnnotation(widget);
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  } finally {
    document.destroy();
  }
}

/**
 * What pdf-lib makes of the result — the second library.
 *
 * A document MuPDF wrote and MuPDF reads back is MuPDF agreeing with itself. A
 * dangling `/Kids` entry or a field with no widget is the kind of thing another
 * parser meets as an error.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ fields: string[] } | { threw: string }>}
 */
async function byPdfLib(bytes) {
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    return { fields: document.getForm().getFields().map((field) => field.getName()) };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Whether the catalog still holds an `/AcroForm` at all.
 *
 * ADR-0006 measured MuPDF's `rearrangePages` dropping the whole dictionary, so
 * *the form survived* is a question this project asks of any structural write
 * rather than assumes.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<boolean>}
 */
async function hasAcroForm(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict) !== undefined;
}

async function main() {
  const built = await fixture();

  // THE CONTROL, before any smaller number is believed: a walk that broke
  // returns zero, which reads as *everything was deleted*.
  const before = structure(built);
  if (before.widgets.length !== 5) {
    throw new Error(
      `CONTROL FAILED: the fixture reads ${String(before.widgets.length)} widget(s) and was ` +
        'built with 5',
    );
  }
  // THE FIELD COUNT IS NOT ASSERTED, and that is a finding rather than a
  // loosened control. The first spelling required three, because three fields
  // were built; it read ONE, which is what `/AcroForm` `/Fields` actually holds
  // for this document. What that array contains is the question below rather
  // than an assumption this script may make — so the walk is the control and
  // the field structure is printed.

  console.log('0. as built:              ', JSON.stringify(before));

  const withoutText = deleted(built, 'applicant.name');
  console.log('1. after deleting the TEXT field:');
  console.log('   structure:             ', JSON.stringify(structure(withoutText)));
  console.log('   pdf-lib:               ', JSON.stringify(await byPdfLib(withoutText)));
  console.log('   /AcroForm survives:    ', JSON.stringify(await hasAcroForm(withoutText)));

  const withoutBox = deleted(built, 'applicant.agrees');
  console.log('2. after deleting the CHECKBOX:');
  console.log('   structure:             ', JSON.stringify(structure(withoutBox)));
  console.log('   pdf-lib:               ', JSON.stringify(await byPdfLib(withoutBox)));

  const withoutOneRadio = deleted(built, 'applicant.post', { first: true });
  console.log('3. after deleting ONE widget of the radio group:');
  console.log('   structure:             ', JSON.stringify(structure(withoutOneRadio)));
  console.log('   pdf-lib:               ', JSON.stringify(await byPdfLib(withoutOneRadio)));

  const withoutGroup = deleted(built, 'applicant.post');
  console.log('4. after deleting BOTH widgets of the group:');
  console.log('   structure:             ', JSON.stringify(structure(withoutGroup)));
  console.log('   pdf-lib:               ', JSON.stringify(await byPdfLib(withoutGroup)));

  const withoutMerged = deleted(built, 'merged');
  console.log('5. after deleting the MERGED field/widget (the hard shape):');
  console.log('   structure:             ', JSON.stringify(structure(withoutMerged)));
  console.log('   pdf-lib:               ', JSON.stringify(await byPdfLib(withoutMerged)));

  console.log('\n   control: the fixture read 5 widgets before any delete');
}

await main();
