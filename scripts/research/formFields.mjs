/**
 * What MuPDF says about the six AcroForm field types, and what survives a fill.
 *
 * Stage 4's foundation row asks for *render and fill all AcroForm field types —
 * text, checkbox, radio, dropdown, listbox, signature*, and six types is six
 * behaviours: a checkbox's `/AS` and a listbox's `/Opt` are different problems,
 * and a fixture carrying one proves nothing about the other five.
 *
 * `docs/ARCHITECTURE.md`:385 already assigns *"Form fields: fill"* to MuPDF, so
 * the writer is settled and none of this is a B4. What is NOT settled is what
 * the reader and the command can say, and three questions decide that before a
 * line of it is designed:
 *
 *   1. **How is a field NAMED?** `commandDeclarations.test.ts` records the
 *      anticipated second `targets` member as *a form field named by index*,
 *      and [ADR-0041](../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 *      measured that the annotation walk FILTERS widgets — so an annotation
 *      handle deliberately cannot name one. Whether a field has a name of its
 *      own that is stable and unique decides between naming by that and naming
 *      by a position in a second walk.
 *   2. **What does each type read and write as?** `getValue` answers a string
 *      for all six; what that string IS differs, and a checkbox's is the one
 *      most likely to surprise.
 *   3. **What does a RADIO GROUP do?** Several widgets share one field, so a
 *      write to one is a write to its siblings — which is a fact about the
 *      payload's shape, not an implementation detail.
 *
 * Run:
 *
 *   node scripts/research/formFields.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * Every reading here is a walk over a document, and a walk that found nothing
 * prints the same clean output as a document with no fields. So the same reader
 * is pointed at a document built to carry **none**, and the script refuses to
 * report if that one comes back carrying any.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * A page carrying one field of each type pdf-lib can build.
 *
 * **Signature is absent and that is the reading**, not an omission: pdf-lib's
 * form API has no signature field, so the fixture below adds one by hand — a
 * `/FT /Sig` widget — which is also what a document arriving from elsewhere
 * looks like.
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

  const checkbox = form.createCheckBox('applicant.agrees');
  checkbox.check();
  checkbox.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  // A RADIO GROUP IS ONE FIELD WITH TWO WIDGETS, which is the whole of question
  // 3 and the reason this fixture has two options rather than one.
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

  // A SIGNATURE FIELD, BY HAND. pdf-lib's form API has none, and the row names
  // signature as one of its six — so a mapping written without this reading
  // would have a guess in one of its six branches. Built the way a document
  // arriving from elsewhere carries one: `/FT /Sig` on a widget in `/Annots`
  // and in `/AcroForm` `/Fields`.
  const context = document.context;
  const signature = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('applicant.signature'),
    Rect: context.obj([20, 260, 220, 300]),
    F: 4,
  });
  const signatureRef = context.register(signature);
  page.node.addAnnot(signatureRef);
  const fields = document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray);
  fields.push(signatureRef);

  return document.save();
}

/** A document with a page and no fields at all — the control's subject. @returns {Promise<Uint8Array>} */
async function bare() {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return document.save();
}

/**
 * Opens with MuPDF and hands the document over, always destroying it.
 *
 * @template T
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => T} read
 * @returns {T}
 */
function withMupdf(bytes, read) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    return read(document);
  } finally {
    document.destroy();
  }
}

/**
 * What MuPDF's own widget walk says about page 0.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>[]}
 */
function widgets(bytes) {
  return withMupdf(bytes, (document) =>
    document
      .loadPage(0)
      .getWidgets()
      .map((widget, index) => ({
        index,
        type: widget.getFieldType(),
        name: widget.getName(),
        value: widget.getValue(),
        options: widget.getOptions(),
        readOnly: widget.isReadOnly(),
        // The subtype the ANNOTATION walk would have reported, so the two
        // numbering schemes can be compared rather than assumed to agree.
        annotationType: widget.getType(),
      })),
  );
}

/**
 * How many entries each walk returns for the same page.
 *
 * ADR-0041 measured `getAnnotations()` answering 3 where `/Annots` held 4. This
 * asks the question the other way round, because the naming decision turns on
 * it: if the widget walk is its own index space, a field handle is a position
 * in THAT walk and not in the annotation one.
 *
 * @param {Uint8Array} bytes
 * @returns {{ annotations: number, widgets: number, annots: number }}
 */
function walkSizes(bytes) {
  return withMupdf(bytes, (document) => {
    const page = document.loadPage(0);
    const array = document.findPage(0).get('Annots');
    return {
      annotations: page.getAnnotations().length,
      widgets: page.getWidgets().length,
      annots: array.isNull() ? 0 : array.length,
    };
  });
}

/**
 * Writes to each field, saves, and reads back — with the SAME library, which is
 * stated as a limit rather than hidden.
 *
 * pdf-lib's reader is the second opinion this project's other probes reach for,
 * and it cannot see a value MuPDF stored in an appearance stream. What matters
 * for the row is whether the FIELD's value survives, and that is a dictionary
 * entry both libraries read — so the second reading below is pdf-lib's.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function filled(bytes) {
  return withMupdf(bytes, (document) => {
    const page = document.loadPage(0);
    // ONE WIDGET PER FIELD, and the radio group is why: two of the six share a
    // field, so a loop that toggles every widget toggles that group twice and
    // the reading is *nothing changed* — which is also what a broken toggle
    // produces. The first spelling of this function did exactly that.
    const seen = new Set();
    for (const widget of page.getWidgets()) {
      const name = widget.getName();
      if (seen.has(name)) continue;
      seen.add(name);

      if (widget.isText()) widget.setTextValue('Grace');
      else if (widget.isCheckbox() || widget.isRadioButton()) widget.toggle();
      else if (widget.isChoice()) {
        // AN OPTION THAT IS NOT THE ONE ALREADY SET. `getOptions()[1]` was the
        // first spelling and it named the listbox's CURRENT value, so that
        // reading could not tell a write from a no-op — item 4's *never build a
        // fixture the bug also handles correctly*, inside a probe.
        const options = widget.getOptions();
        const other = options.find((option) => option !== widget.getValue());
        widget.setChoiceValue(other ?? '');
      }
    }
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  });
}

/**
 * A checkbox's two dictionary entries, read with MuPDF's object API.
 *
 * `getValue()` answers a string for every type, and for a checkbox that string
 * is the reading most likely to mislead: the format stores the field's value in
 * `/V` and the widget's displayed state in `/AS`, and they are different
 * questions on a field with several widgets.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, string>}
 */
/**
 * Every button widget's four state readings at once.
 *
 * The four are separated deliberately: `getValue()` is the FIELD's value, `/AS`
 * is what a viewer paints, `/V` on the widget's own dictionary is usually
 * absent because the value lives on the field, and the `/AP` `/N` keys are this
 * widget's own name for *on*. A reading that collapsed them could not have
 * shown that pdf-lib's `check()` moves one and not the other.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>[]}
 */
function buttonStates(bytes) {
  return withMupdf(bytes, (document) =>
    document
      .loadPage(0)
      .getWidgets()
      .filter((widget) => widget.isCheckbox() || widget.isRadioButton())
      .map((widget, index) => {
        const object = widget.getObject();
        const spell = (/** @type {mupdf.PDFObject} */ value) =>
          value.isNull() ? '(absent)' : value.isName() ? `/${value.asName()}` : String(value);
        // THE FIELD'S value, which for a widget that is its own field is on the
        // same dictionary and for one in a group is on its /Parent.
        const parent = object.get('Parent');
        /** @type {string[]} */
        const appearances = [];
        const normal = object.get('AP').get('N');
        if (normal.isDictionary()) normal.forEach((_value, key) => appearances.push(String(key)));
        return {
          index,
          kind: widget.getFieldType(),
          getValue: widget.getValue(),
          AS: spell(object.get('AS')),
          ownV: spell(object.get('V')),
          parentV: parent.isNull() ? '(no parent)' : spell(parent.get('V')),
          appearanceStates: appearances,
        };
      }),
  );
}

/**
 * @param {Uint8Array} bytes
 * @returns {Record<string, string>}
 */
function checkboxState(bytes) {
  return withMupdf(bytes, (document) => {
    const widget = document
      .loadPage(0)
      .getWidgets()
      .find((candidate) => candidate.isCheckbox());
    if (widget === undefined) throw new Error('the fixture lost its checkbox');
    const object = widget.getObject();
    const spell = (/** @type {mupdf.PDFObject} */ value) =>
      value.isNull() ? '(absent)' : value.isName() ? `/${value.asName()}` : String(value);
    return {
      value: widget.getValue(),
      V: spell(object.get('V')),
      AS: spell(object.get('AS')),
    };
  });
}

/**
 * What pdf-lib says the field values are — the second library.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Record<string, string>>}
 */
async function pdfLibValues(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  /** @type {Record<string, string>} */
  const values = {};
  for (const field of document.getForm().getFields()) {
    const name = field.getName();
    const value = field.acroField.dict.get(field.acroField.dict.context.obj('V'));
    values[name] = value === undefined ? '(absent)' : String(value);
  }
  return values;
}

async function main() {
  const document = await fixture();

  // THE CONTROL, before any reading is believed.
  const empty = widgets(await bare());
  if (empty.length !== 0) {
    throw new Error(`CONTROL FAILED: the walk found ${String(empty.length)} widgets on a page with none`);
  }

  console.log('1. walk sizes, as built:  ', JSON.stringify(walkSizes(document)));
  console.log('2. widgets, as built:');
  for (const widget of widgets(document)) console.log('   ', JSON.stringify(widget));

  const after = filled(document);
  console.log('3. widgets, after a write to each:');
  for (const widget of widgets(after)) console.log('   ', JSON.stringify(widget));

  console.log('4. the same values, read with pdf-lib:', JSON.stringify(await pdfLibValues(after)));
  console.log('4b. the checkbox, before:', JSON.stringify(checkboxState(document)));
  console.log('4b. the checkbox, after: ', JSON.stringify(checkboxState(after)));
  console.log('4c. every button widget, before:');
  for (const state of buttonStates(document)) console.log('   ', JSON.stringify(state));
  console.log('4c. every button widget, after:');
  for (const state of buttonStates(after)) console.log('   ', JSON.stringify(state));
  console.log('5. walk sizes, after:    ', JSON.stringify(walkSizes(after)));
  console.log('   control: a page with no fields reports 0 widgets');
}

await main();
