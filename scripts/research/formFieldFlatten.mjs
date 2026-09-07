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
 */
import { PDFDocument, PDFDict, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/** A form with a filled text field, a ticked box, and a comment beside them. */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();

  const text = form.createTextField('applicant.name');
  text.setText('GRACE HOPPER');
  text.addToPage(page, { x: 20, y: 240, width: 240, height: 20, font });

  const box = form.createCheckBox('applicant.agrees');
  box.check();
  box.addToPage(page, { x: 20, y: 200, width: 16, height: 16 });

  return document.save();
}

/** The same page size with nothing on it — question 3's control subject. */
async function blank() {
  const document = await PDFDocument.create();
  document.addPage([400, 300]);
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
 * @param {Uint8Array} bytes
 * @param {boolean} annots
 * @param {boolean} widgets
 * @returns {Uint8Array}
 */
function baked(bytes, annots, widgets) {
  const document = open(bytes);
  try {
    document.bake(annots, widgets);
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
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
 * measured, 1891 both ways — because the renderer draws the widget either way.
 * That comparison cannot tell *the flatten moved the appearance into the
 * content stream* from *nothing happened*, which is item 4's rule about
 * mutation direction: the reading a working flatten produces is the reading its
 * absence produces too.
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

async function main() {
  const built = await fixture();

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

  const say = (/** @type {string} */ label, /** @type {Uint8Array} */ bytes) =>
    structure(bytes).then((shape) => {
      console.log(label, JSON.stringify(shape), JSON.stringify(inked(bytes)));
    });

  await say('0. as built:        ', built);
  const both = baked(built, true, true);
  await say('1. bake(true,true): ', both);
  await say('2. bake(false,true):', baked(built, false, true));
  await say('3. bake(true,false):', baked(built, true, false));

  // QUESTION 5: a flatten that only holds in the live session is not one. The
  // bytes above already went through a save; this reopens and re-reads them
  // with a fresh document, which is the half a same-session read cannot give.
  const reopened = await structure(both);
  console.log('4. reopened:        ', JSON.stringify(reopened));

  console.log(
    `\n   control: the fixture renders ${String(full.withExtras)} marked pixels against ` +
      `${String(empty.withExtras)} blank, and 0 from its own content stream`,
  );
}

await main();
