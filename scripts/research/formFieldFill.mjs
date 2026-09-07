/**
 * What MuPDF will actually WRITE to a form field, and what it refuses.
 *
 * `formFields.mjs` settled how a field is read and named. This settles the
 * other half, and it starts from a fact about the library's surface rather than
 * from a design: `mupdf.d.ts:812-834` declares exactly three mutators on
 * `PDFWidget` — `setTextValue`, `setChoiceValue` and `toggle()`. There is no
 * `setValue`, and **no setter that names a state**. So the shape of the fill
 * command is decided by what those three do, not by what a payload would like
 * to say.
 *
 * Five questions, and each one changes the command if its answer goes the other
 * way:
 *
 *   1. **What is `toggle()` keyed on — the field's value, or the widget's
 *      appearance state?** They disagree in the wild: `@cantoo/pdf-lib`'s
 *      `check()` writes `/V` and leaves `/AS` at `/Off`, measured 2026-09-07.
 *      If `toggle()` reads `/AS`, then a command spelt *set this box to on* is
 *      not expressible as one toggle, because the same call does different
 *      things to two documents that agree about the data.
 *   2. **Is it a setter at all?** A toggle is its own inverse only if toggling
 *      twice returns the document to where it started, and §4's undo log needs
 *      an inverse that is a COMMAND rather than a repetition.
 *   3. **Can a radio group be pointed at a named widget?** Several widgets share
 *      one field, so *select the second option* has to be expressible.
 *   4. **Does the appearance follow the value?** A fill nobody can see is a
 *      display-only defect with the data half green — so this is measured by
 *      RENDERING, not by reading back the string that was written.
 *   5. **What is refused?** A read-only field, a signature, a push button, and
 *      a choice value the document does not offer. A write that silently
 *      succeeds where it should refuse is the shape a hostile document uses.
 *
 * Run:
 *
 *   node scripts/research/formFieldFill.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * Every reading here is *did the document change?*, and the reassuring answer
 * for a broken write and for a refused one is the same **no change**. So the
 * script first performs a write it knows must land — a text field — and refuses
 * to report if that one comes back unchanged. Without it, a run in which
 * nothing at all works prints a tidy table of refusals.
 */
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * A page carrying the fields this script writes to.
 *
 * `consistent` decides the checkbox's own agreement: pdf-lib's `check()` leaves
 * `/AS` stale, so `uncheck()` is used for the box whose two entries agree —
 * measured, an unchecked box reads `/V` absent and `/AS /Off`. The two boxes
 * are what separates question 1's two answers, and one box alone cannot.
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

  // THE DISAGREEING BOX: `/V` says ticked, `/AS` says otherwise.
  const stale = form.createCheckBox('box.stale');
  stale.check();
  stale.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  // THE AGREEING BOX: both say off. A toggle keyed on either answers the same
  // for this one, which is why it is the control rather than the subject.
  const agreed = form.createCheckBox('box.agreed');
  agreed.uncheck();
  agreed.addToPage(page, { x: 60, y: 500, width: 16, height: 16 });

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

  return document.save();
}

/**
 * Opens with MuPDF, hands the document over, and returns the saved bytes.
 *
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => void} write
 * @returns {Uint8Array}
 */
function edited(bytes, write) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    write(document);
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  } finally {
    document.destroy();
  }
}

/**
 * @template T
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => T} read
 * @returns {T}
 */
function inspected(bytes, read) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    return read(document);
  } finally {
    document.destroy();
  }
}

/** @param {mupdf.PDFObject} value @returns {string} */
function spell(value) {
  if (value.isNull()) return '(absent)';
  if (value.isName()) return `/${value.asName()}`;
  return String(value);
}

/**
 * Every widget's four decisive readings.
 *
 * `formFields.mjs` records why these four are separated: `getValue()` is the
 * FIELD's, `/AS` is what a viewer paints, the widget's own `/V` is usually
 * absent, and the `/AP` `/N` keys are this widget's own name for *on*.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>[]}
 */
function states(bytes) {
  return inspected(bytes, (document) =>
    document
      .loadPage(0)
      .getWidgets()
      .map((widget, index) => {
        const object = widget.getObject();
        const parent = object.get('Parent');
        /** @type {string[]} */
        const appearances = [];
        const normal = object.get('AP').get('N');
        if (normal.isDictionary()) normal.forEach((_value, key) => appearances.push(String(key)));
        return {
          index,
          kind: widget.getFieldType(),
          name: widget.getName(),
          getValue: widget.getValue(),
          AS: spell(object.get('AS')),
          fieldV: parent.isNull() ? spell(object.get('V')) : spell(parent.get('V')),
          // `/AP` `/N` IS TWO DIFFERENT THINGS and this column says which. On a
          // button it is a dictionary of one appearance per state, whose
          // non-`Off` key is that widget's own name for *on*. On a text or
          // choice field it is a STREAM — and a stream answers `isDictionary()`
          // as well, so a walk over its keys yields `BBox`, `Matrix`,
          // `Resources`… which would read as an on-state name.
          apNormal: normal.isStream() ? 'stream' : normal.isDictionary() ? 'states' : 'absent',
          on: normal.isStream() ? [] : appearances.filter((key) => key !== 'Off'),
        };
      }),
  );
}

/**
 * Finds one widget by field name, and by POSITION where a name is shared.
 *
 * @param {mupdf.PDFDocument} document
 * @param {string} name
 * @param {number} [nth]
 * @returns {mupdf.PDFWidget}
 */
function widgetNamed(document, name, nth = 0) {
  const found = document
    .loadPage(0)
    .getWidgets()
    .filter((widget) => widget.getName() === name);
  const widget = found[nth];
  if (widget === undefined) throw new Error(`the fixture lost ${name}[${String(nth)}]`);
  return widget;
}

/**
 * How many non-white pixels the page renders.
 *
 * THE OBSERVABLE FOR QUESTION 4, and it is deliberately not a read-back of the
 * string that was written: a value stored in `/V` with no appearance stream
 * behind it satisfies every dictionary reading and shows a person nothing. A
 * count of marked pixels is what a viewer would see.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function inked(bytes) {
  return inspected(bytes, (document) => {
    const pixmap = document
      .loadPage(0)
      .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
    const samples = pixmap.getPixels();
    let marked = 0;
    for (const sample of samples) if (sample < 250) marked += 1;
    return marked;
  });
}

/**
 * Runs a write and reports what it did, catching a throw as a reading.
 *
 * A refusal that arrives as an exception and a refusal that arrives as *nothing
 * happened* are different answers, and a `try` that swallowed both would report
 * them identically.
 *
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => unknown} write
 * @returns {{ threw: string | null, bytes: Uint8Array }}
 */
function attempted(bytes, write) {
  /** @type {string | null} */
  let threw = null;
  const after = edited(bytes, (document) => {
    try {
      write(document);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
  });
  return { threw, bytes: after };
}

/**
 * The values pdf-lib reads back — the second library, so a reading is not
 * MuPDF agreeing with itself.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Record<string, string>>}
 */
async function pdfLibValues(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  /** @type {Record<string, string>} */
  const values = {};
  for (const field of document.getForm().getFields()) {
    const dictionary = field.acroField.dict;
    const value = dictionary.get(dictionary.context.obj('V'));
    values[field.getName()] = value === undefined ? '(absent)' : String(value);
  }
  return values;
}

/** @param {string} label @param {Record<string, unknown>[]} rows */
function report(label, rows) {
  console.log(label);
  for (const row of rows) console.log('   ', JSON.stringify(row));
}

async function main() {
  const built = await fixture();

  // THE CONTROL, before any refusal below is believed. A text write is the one
  // this library certainly performs; if it did not land, every "no change"
  // printed afterwards is meaningless.
  const control = edited(built, (document) => {
    widgetNamed(document, 'applicant.name').setTextValue('CONTROL');
  });
  const controlValue = inspected(control, (document) =>
    widgetNamed(document, 'applicant.name').getValue(),
  );
  if (controlValue !== 'CONTROL') {
    throw new Error(`CONTROL FAILED: a text write read back as ${JSON.stringify(controlValue)}`);
  }

  report('0. as built:', states(built));

  // ── 1. What is toggle() keyed on? ────────────────────────────────────────
  // The two boxes disagree about their own state in different ways, so the two
  // candidate readings predict different outcomes here and nowhere else.
  const staleOnce = edited(built, (document) => widgetNamed(document, 'box.stale').toggle());
  const agreedOnce = edited(built, (document) => widgetNamed(document, 'box.agreed').toggle());
  report('1. box.stale after one toggle (V=/Yes, AS=/Off before):', states(staleOnce).slice(1, 3));
  report('1. box.agreed after one toggle (both off before):      ', states(agreedOnce).slice(1, 3));
  console.log(
    '1b. what toggle() returns:',
    JSON.stringify(
      inspected(built, (document) => ({
        stale: widgetNamed(document, 'box.stale').toggle(),
        agreed: widgetNamed(document, 'box.agreed').toggle(),
      })),
    ),
  );

  // ── 2. Is a toggle its own inverse? ──────────────────────────────────────
  const staleTwice = edited(staleOnce, (document) => widgetNamed(document, 'box.stale').toggle());
  report('2. box.stale after a SECOND toggle:', states(staleTwice).slice(1, 3));

  // ── 3. Can a radio group be pointed at a named widget? ───────────────────
  const secondRadio = edited(built, (document) =>
    widgetNamed(document, 'applicant.post', 1).toggle(),
  );
  report('3. after toggling the SECOND radio (first was on):', states(secondRadio).slice(3, 5));
  const firstRadio = edited(built, (document) =>
    widgetNamed(document, 'applicant.post', 0).toggle(),
  );
  report('3b. after toggling the FIRST radio (it was on):   ', states(firstRadio).slice(3, 5));

  // ── 4. Does the appearance follow the value? ─────────────────────────────
  const longer = edited(built, (document) => {
    widgetNamed(document, 'applicant.name').setTextValue('Grace Brewster Murray Hopper');
  });
  console.log(
    '4. marked pixels, page 0:',
    JSON.stringify({ built: inked(built), afterALongerValue: inked(longer) }),
  );

  // ── 5. What is refused? ──────────────────────────────────────────────────
  const locked = attempted(built, (document) => {
    widgetNamed(document, 'applicant.reference').setTextValue('CHANGED');
  });
  console.log(
    '5a. read-only text field:',
    JSON.stringify({
      threw: locked.threw,
      value: inspected(locked.bytes, (d) => widgetNamed(d, 'applicant.reference').getValue()),
    }),
  );

  const push = attempted(built, (document) => {
    widgetNamed(document, 'applicant.submit').setTextValue('CHANGED');
  });
  console.log(
    '5b. push button, setTextValue:',
    JSON.stringify({
      threw: push.threw,
      value: inspected(push.bytes, (d) => widgetNamed(d, 'applicant.submit').getValue()),
    }),
  );

  const unlisted = attempted(built, (document) => {
    widgetNamed(document, 'applicant.title').setChoiceValue('Professor');
  });
  console.log(
    '5c. a choice value the document does not offer:',
    JSON.stringify({
      threw: unlisted.threw,
      value: inspected(unlisted.bytes, (d) => widgetNamed(d, 'applicant.title').getValue()),
      options: inspected(unlisted.bytes, (d) => widgetNamed(d, 'applicant.title').getOptions()),
    }),
  );

  const textOnChoice = attempted(built, (document) => {
    widgetNamed(document, 'applicant.languages').setTextValue('Welsh');
  });
  console.log(
    '5d. setTextValue on a listbox:',
    JSON.stringify({
      threw: textOnChoice.threw,
      value: inspected(textOnChoice.bytes, (d) => widgetNamed(d, 'applicant.languages').getValue()),
    }),
  );

  const choiceOnText = attempted(built, (document) => {
    widgetNamed(document, 'applicant.name').setChoiceValue('Grace');
  });
  console.log(
    '5e. setChoiceValue on a text field:',
    JSON.stringify({
      threw: choiceOnText.threw,
      value: inspected(choiceOnText.bytes, (d) => widgetNamed(d, 'applicant.name').getValue()),
    }),
  );

  const toggledText = attempted(built, (document) => {
    widgetNamed(document, 'applicant.name').toggle();
  });
  console.log(
    '5f. toggle() on a text field:',
    JSON.stringify({
      threw: toggledText.threw,
      value: inspected(toggledText.bytes, (d) => widgetNamed(d, 'applicant.name').getValue()),
    }),
  );

  // ── 6. Does it survive a save, read by the other library? ────────────────
  const written = edited(built, (document) => {
    widgetNamed(document, 'applicant.name').setTextValue('Grace');
    widgetNamed(document, 'applicant.title').setChoiceValue('Ms');
    widgetNamed(document, 'applicant.languages').setChoiceValue('Welsh');
    widgetNamed(document, 'box.agreed').toggle();
  });
  console.log('6. pdf-lib reads back:', JSON.stringify(await pdfLibValues(written)));
  console.log(
    '   control: a text write lands, which is what makes every "no change" above mean something',
  );
}

await main();
