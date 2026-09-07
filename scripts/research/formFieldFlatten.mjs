// @ts-check
/**
 * Executing the verification `docs/ENGINE-SPIKE.md` H2 asked for and never ran.
 *
 * H2 corrects the founding matrix — MuPDF *can* flatten form fields, through
 * `PDFDocument.bake(bakeAnnots?, bakeWidgets?)` — and ends with a sentence that
 * has stood unexecuted since 2026-08-16:
 *
 * > Verify that a baked field renders identically to its pre-bake appearance
 * > and is no longer present in the AcroForm tree.
 *
 * Both halves matter and they fail in opposite directions. A bake that removes
 * the field and draws nothing is **data loss that looks like success** — the
 * form is gone and so is what it said. A bake that draws the appearance and
 * leaves the field is a document that still offers to be filled in, which is
 * the display-only defect at document scale.
 *
 * Five questions, and each one changes the row:
 *
 *   1. **Is the field gone from `/AcroForm`?** Read with pdf-lib, because MuPDF
 *      agreeing with itself about a document it just wrote is not evidence.
 *   2. **Is the widget gone from the page's `/Annots`?**
 *   3. **Does the page still show what the field said?** Measured by RENDERING
 *      and comparing pixels, not by reading a string back — a value in a
 *      dictionary nobody draws is exactly what a bad flatten leaves.
 *   4. **What does `bakeAnnots` do separately?** ADR-0008's flatten rule is
 *      about removal, and *which* removal is a payload question: a person may
 *      want the form fixed and the comments still editable.
 *   5. **Does it survive a save and reopen?** A flatten that only holds in the
 *      live session is not a flatten.
 *
 * ## THREE MORE, ADDED 2026-09-07 — the ones that decide whether the row ships
 *
 * H2's five say the engine call works. They do not say a command may make it,
 * and each of these was reached by asking what the D5 row owes rather than what
 * the spike asked:
 *
 *   6. **Does the value survive the save as a recoverable object?**
 *      [ADR-0008](../../docs/DECISIONS/0008-save-mode-is-determined-by-purpose.md)
 *      rule 1 puts flatten on the removal list and requires *a full rewrite
 *      with object garbage collection*. This build's only save is
 *      `saveToBuffer('')`, which `mupdfWriter.ts` documents as *"no incremental
 *      update, no garbage-collection pass"* — so the widget MuPDF unlinked may
 *      still be in the file, with its value in it. Counting the widget
 *      dictionaries left in the saved bytes is the reading; searching for the
 *      value is not, because a correct flatten DRAWS that text and the search
 *      would find it either way.
 *   7. **Is a bake reproducible?** `commandDeclarations.ts` makes every command
 *      declare it, and two commands were mis-declared this week because pdf-lib
 *      stamps `/ModDate` — a defect that surfaced as a once-a-second flake and
 *      could not have been caught by comparing two saves. So the reading is the
 *      stamped fields themselves (`/ModDate`, the trailer `/ID`) beside the
 *      byte comparison, never the byte comparison alone.
 *   8. **Do all six types bake?** Row 1's standard, applied here: six types is
 *      six behaviours, and a fixture carrying two proves nothing about the
 *      other four. Ink is counted **inside each field's own rectangle**, so a
 *      type whose appearance did not come across shows zero in its own box
 *      while the page total still looks healthy.
 *
 * Run:
 *
 *   node scripts/research/formFieldFlatten.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * Question 3's reassuring answer is *the pixels match*, and two blank pages
 * match perfectly. So the script first asserts the fixture renders MORE ink
 * than an empty page of the same size, and refuses to report if it does not —
 * without which a renderer that produced nothing would report a flawless
 * flatten of every field.
 *
 * Question 6 has the mirror control and it is the one that is easy to skip: its
 * reassuring answer is *no widget dictionaries left*, which a detector that
 * cannot recognise a widget also produces. So the detector must first find the
 * widgets in the UNBAKED fixture, and the count it finds there is printed.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * One field of each of the six types, plus a push button and a read-only text.
 *
 * WIDENED 2026-09-07 from a text field and a tick box, for question 8. The
 * shape is `formFields.test.ts`' six-type fixture — the signature built by hand
 * because `@cantoo/pdf-lib` has no API for one — with the push button and the
 * read-only field added, since those are the two the FILL path refuses and a
 * flatten has no reason to.
 *
 * @returns {Promise<{ bytes: Uint8Array, boxes: Array<{ name: string, rect: [number, number, number, number] }> }>}
 */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();

  const text = form.createTextField('applicant.name');
  text.setText('GRACE HOPPER');
  text.addToPage(page, { x: 20, y: 540, width: 200, height: 20, font });

  const box = form.createCheckBox('applicant.agrees');
  box.check();
  box.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  // TWO WIDGETS, ONE FIELD — and for a flatten that is the interesting shape,
  // because a bake that handled the field rather than the widget would leave
  // one of these two boxes blank while the other came across.
  const radio = form.createRadioGroup('applicant.post');
  radio.addOptionToPage('first', page, { x: 20, y: 460, width: 16, height: 16 });
  radio.addOptionToPage('second', page, { x: 60, y: 460, width: 16, height: 16 });
  radio.select('first');

  const dropdown = form.createDropdown('applicant.title');
  dropdown.addOptions(['Dr', 'Mr', 'Ms']);
  dropdown.select('Dr');
  dropdown.addToPage(page, { x: 20, y: 420, width: 100, height: 20, font });

  const listbox = form.createOptionList('applicant.languages');
  listbox.addOptions(['English', 'Dutch', 'Welsh']);
  listbox.select('Dutch');
  listbox.addToPage(page, { x: 20, y: 340, width: 100, height: 60, font });

  const locked = form.createTextField('applicant.reference');
  locked.setText('LOCKED');
  locked.enableReadOnly();
  locked.addToPage(page, { x: 20, y: 300, width: 200, height: 20, font });

  const push = form.createButton('applicant.submit');
  push.addToPage('Send', page, { x: 20, y: 200, width: 60, height: 20, font });

  const context = document.context;
  const signature = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('applicant.signature'),
    Rect: context.obj([20, 240, 220, 280]),
    F: 4,
  });
  const signatureRef = context.register(signature);
  page.node.addAnnot(signatureRef);
  document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray)
    .push(signatureRef);

  return {
    // NOT PINNED, and it cannot be: `updateMetadata` is a LOAD option and this
    // document was created rather than loaded. It does not matter here —
    // question 7 compares two BAKES of these same bytes, so whatever this save
    // stamped is the same constant on both sides of that comparison.
    bytes: await document.save(),
    boxes: [
      { name: 'text', rect: [20, 540, 220, 560] },
      { name: 'checkbox', rect: [20, 500, 36, 516] },
      { name: 'radio.first', rect: [20, 460, 36, 476] },
      { name: 'radio.second', rect: [60, 460, 76, 476] },
      { name: 'dropdown', rect: [20, 420, 120, 440] },
      { name: 'listbox', rect: [20, 340, 120, 400] },
      { name: 'readonly', rect: [20, 300, 220, 320] },
      { name: 'pushbutton', rect: [20, 200, 80, 220] },
      { name: 'signature', rect: [20, 240, 220, 280] },
    ],
  };
}

/** The same page size with nothing on it — question 3's control subject. */
async function blank() {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return document.save();
}

/** @param {Uint8Array} bytes @returns {mupdf.PDFDocument} */
function open(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  return document;
}

/**
 * Bakes and saves.
 *
 * `options` is MuPDF's write-option string and defaults to the empty one this
 * build's `serialise` uses, so a reading taken here is a reading about the save
 * that actually ships unless it says otherwise.
 *
 * @param {Uint8Array} bytes
 * @param {boolean} annots
 * @param {boolean} widgets
 * @param {string} [options]
 * @returns {Uint8Array}
 */
function baked(bytes, annots, widgets, options = '') {
  const document = open(bytes);
  try {
    document.bake(annots, widgets);
    return new Uint8Array(document.saveToBuffer(options).asUint8Array());
  } finally {
    document.destroy();
  }
}

/**
 * How many non-white pixels page 0 renders, with and without annotations.
 *
 * THE OBSERVABLE FOR QUESTION 3, and the second reading is the one that makes
 * it an observable at all. `toPixmap`'s fourth argument is `showExtras`, which
 * decides whether widget and annotation appearances are drawn on top of the
 * page. With it ON, a baked document and an unbaked one render **identically** —
 * measured, 1891 both ways on the two-field fixture this began with — because
 * the renderer draws the widget either way. That comparison cannot tell *the
 * flatten moved the appearance into the content stream* from *nothing
 * happened*, which is item 4's rule about mutation direction: the reading a
 * working flatten produces is the reading its absence produces too.
 *
 * With extras OFF, only the page's own content is drawn. An unbaked field
 * contributes nothing and a baked one contributes its appearance, so the two
 * numbers differ exactly when the flatten did its job.
 *
 * @param {Uint8Array} bytes
 * @returns {{ withExtras: number, contentOnly: number }}
 */
function inked(bytes) {
  const document = open(bytes);
  try {
    const page = document.loadPage(0);
    const count = (/** @type {boolean} */ extras) => {
      const pixmap = page.toPixmap(
        mupdf.Matrix.identity,
        mupdf.ColorSpace.DeviceGray,
        false,
        extras,
      );
      let marked = 0;
      for (const sample of pixmap.getPixels()) if (sample < 250) marked += 1;
      return marked;
    };
    return { withExtras: count(true), contentOnly: count(false) };
  } finally {
    document.destroy();
  }
}

/**
 * Ink inside each field's own rectangle, from the page's content stream alone.
 *
 * QUESTION 8'S OBSERVABLE, and the reason it is per-rectangle rather than a
 * page total: a page total is one number for nine widgets, so a type whose
 * appearance did not bake is hidden by the eight that did. Two of the nine are
 * the two halves of one radio group, which is the case a field-level rather
 * than widget-level bake would get wrong.
 *
 * The y flip is explicit: `/Rect` is in PDF user space with the origin at the
 * bottom-left and the pixmap's origin is top-left, at identity scale, so a
 * rectangle's rows run from `height - top` to `height - bottom`.
 *
 * @param {Uint8Array} bytes
 * @param {Array<{ name: string, rect: [number, number, number, number] }>} boxes
 * @returns {Record<string, number>}
 */
function inkedPerBox(bytes, boxes) {
  const document = open(bytes);
  try {
    const pixmap = document
      .loadPage(0)
      .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, false);
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const stride = pixmap.getStride();
    const samples = pixmap.getPixels();
    /** @type {Record<string, number>} */
    const marked = {};
    for (const { name, rect } of boxes) {
      const [left, bottom, right, top] = rect;
      let count = 0;
      const firstRow = Math.max(0, Math.floor(height - top));
      const lastRow = Math.min(height, Math.ceil(height - bottom));
      const firstColumn = Math.max(0, Math.floor(left));
      const lastColumn = Math.min(width, Math.ceil(right));
      for (let y = firstRow; y < lastRow; y += 1) {
        for (let x = firstColumn; x < lastColumn; x += 1) {
          if ((samples[y * stride + x] ?? 255) < 250) count += 1;
        }
      }
      marked[name] = count;
    }
    return marked;
  } finally {
    document.destroy();
  }
}

/**
 * What both structures say, read with the OTHER library where it can see.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ widgets: number, annots: number, acroFields: string[], hasAcroForm: boolean }>}
 */
async function structure(bytes) {
  const document = open(bytes);
  /** @type {{ widgets: number, annots: number }} */
  let walked;
  try {
    const page = document.loadPage(0);
    walked = { widgets: page.getWidgets().length, annots: page.getAnnotations().length };
  } finally {
    document.destroy();
  }
  const { widgets, annots } = walked;

  const byPdfLib = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    widgets,
    annots,
    acroFields: byPdfLib.getForm().getFields().map((field) => field.getName()),
    hasAcroForm: byPdfLib.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict) !== undefined,
  };
}

/**
 * Objects still IN the saved bytes, whatever the page tree points at.
 *
 * QUESTION 6'S OBSERVABLE. `structure` above walks from the catalog, so an
 * object nothing references is invisible to it — which is exactly the object
 * this question is about. `enumerateIndirectObjects` reads the cross-reference
 * table, so an unlinked widget that MuPDF wrote out anyway is counted here and
 * nowhere else.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ objects: number, widgetDicts: number, fieldDicts: number }>}
 */
async function residue(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let widgetDicts = 0;
  let fieldDicts = 0;
  const all = document.context.enumerateIndirectObjects();
  for (const [, object] of all) {
    if (!(object instanceof PDFDict)) continue;
    if (object.lookupMaybe(PDFName.of('Subtype'), PDFName) === PDFName.of('Widget')) widgetDicts += 1;
    if (object.get(PDFName.of('FT')) !== undefined) fieldDicts += 1;
  }
  return { objects: all.length, widgetDicts, fieldDicts };
}

/**
 * What a save stamped, read as fields rather than inferred from bytes.
 *
 * QUESTION 7. Byte equality between two saves is the assertion that cannot see
 * a per-second clock — it holds whenever both land inside one tick, which is
 * almost always — so the stamped values are read directly and printed beside
 * it.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ modDate: string | null, creationDate: string | null, id: string | null }>}
 */
async function stamps(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict);
  const read = (/** @type {string} */ key) => {
    const value = info?.get(PDFName.of(key));
    return value === undefined ? null : value.toString();
  };
  const ids = document.context.lookupMaybe(document.context.trailerInfo.ID, PDFArray);
  return {
    modDate: read('ModDate'),
    creationDate: read('CreationDate'),
    id: ids === undefined ? null : ids.toString(),
  };
}

async function main() {
  const { bytes: built, boxes } = await fixture();

  // THE CONTROL, before *the pixels match* is believed anywhere below: two
  // blank pages match perfectly, so a renderer producing nothing would report
  // a flawless flatten.
  const empty = inked(await blank());
  const full = inked(built);
  if (full.withExtras <= empty.withExtras) {
    throw new Error(
      `CONTROL FAILED: the fixture renders ${String(full.withExtras)} marked pixels against ` +
        `${String(empty.withExtras)} for a blank page of the same size, so nothing below can be ` +
        'read as evidence that a flatten preserved anything',
    );
  }
  // AND THE SECOND HALF OF THE CONTROL: the unbaked fixture must render NOTHING
  // from its own content, or `contentOnly` cannot separate a flatten from a
  // no-op below — it would already be carrying the ink the flatten is supposed
  // to add.
  if (full.contentOnly !== 0) {
    throw new Error(
      `CONTROL FAILED: the unbaked fixture already renders ${String(full.contentOnly)} pixels ` +
        'from its own content stream, so a baked one showing ink proves nothing',
    );
  }
  // QUESTION 6'S CONTROL, and it is the mirror of the two above: *no widget
  // dictionaries left* is also what a detector that cannot recognise one says.
  const before = await residue(built);
  if (before.widgetDicts === 0 || before.fieldDicts === 0) {
    throw new Error(
      `CONTROL FAILED: the residue detector finds ${JSON.stringify(before)} in the UNBAKED ` +
        'fixture, so a zero after a bake would say nothing about the bake',
    );
  }

  const say = (/** @type {string} */ label, /** @type {Uint8Array} */ bytes) =>
    structure(bytes).then((shape) => {
      console.log(label, JSON.stringify(shape), JSON.stringify(inked(bytes)));
    });

  await say('0. as built:        ', built);
  const both = baked(built, true, true);
  await say('1. bake(true,true): ', both);
  const widgetsOnly = baked(built, false, true);
  await say('2. bake(false,true):', widgetsOnly);
  await say('3. bake(true,false):', baked(built, true, false));

  // QUESTION 5: a flatten that only holds in the live session is not one. The
  // bytes above already went through a save; this reopens and re-reads them
  // with a fresh document, which is the half a same-session read cannot give.
  const reopened = await structure(both);
  console.log('4. reopened:        ', JSON.stringify(reopened));

  // QUESTION 8, per rectangle. `widgetsOnly` is the shape the row would ship.
  console.log('\n8. ink inside each field’s own rectangle, from page content alone');
  console.log('   before:', JSON.stringify(inkedPerBox(built, boxes)));
  console.log('   after: ', JSON.stringify(inkedPerBox(widgetsOnly, boxes)));

  // QUESTION 6. Two saves of the same baked document, one with the option
  // string this build ships and one asking for garbage collection.
  console.log('\n6. objects left in the saved bytes, whatever references them');
  console.log('   unbaked            :', JSON.stringify(before));
  console.log('   bake + saveToBuffer(""):', JSON.stringify(await residue(widgetsOnly)));
  for (const option of ['garbage', 'garbage=compact', 'garbage=deduplicate']) {
    try {
      console.log(
        `   bake + saveToBuffer("${option}"):`,
        JSON.stringify(await residue(baked(built, false, true, option))),
      );
    } catch (error) {
      console.log(`   bake + saveToBuffer("${option}"): REFUSED —`, String(error));
    }
  }

  // QUESTION 7. ACROSS A SECOND BOUNDARY, deliberately. Two saves inside one
  // clock tick produce identical bytes whether or not anything is stamped —
  // that is why the `/ModDate` mis-declaration this week surfaced as a rare
  // flake rather than as a failing case — so the comparison is only worth
  // taking once the two bakes are known to straddle a tick.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const again = baked(built, false, true);
  console.log('\n7. is a bake reproducible? (the two bakes are 1.1s apart)');
  console.log(
    '   same bytes:',
    widgetsOnly.byteLength === again.byteLength &&
      widgetsOnly.every((byte, at) => byte === again[at]),
  );
  console.log('   input :', JSON.stringify(await stamps(built)));
  console.log('   first :', JSON.stringify(await stamps(widgetsOnly)));
  console.log('   second:', JSON.stringify(await stamps(again)));

  console.log(
    `\n   control: the fixture renders ${String(full.withExtras)} marked pixels against ` +
      `${String(empty.withExtras)} blank, 0 from its own content stream, and the residue ` +
      `detector finds ${String(before.widgetDicts)} widget dictionaries in it before any bake`,
  );
}

await main();
