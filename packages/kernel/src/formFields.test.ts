import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { readFormFields } from './formFields.js';
import { mupdfWriter } from './mupdfWriter.js';
import { readAnnotations } from './pageAnnotations.js';

/**
 * Reading a document's AcroForm fields.
 *
 * ## SIX TYPES IS SIX BEHAVIOURS, and one fixture carries all of them
 *
 * A checkbox's `/AS` and a listbox's `/Opt` are different problems, so a
 * fixture with one field proves nothing about the other five. This one carries
 * a text field, a checkbox, a **radio group of two widgets**, a dropdown, a
 * listbox and a signature — seven widgets, six fields.
 *
 * The signature is built by hand because `@cantoo/pdf-lib`'s form API has none,
 * which is also what a document arriving from elsewhere looks like.
 *
 * ## The checkbox's case is a control on the reading, and the fixture is why
 *
 * `@cantoo/pdf-lib`'s `check()` writes the field's `/V` and leaves the widget's
 * `/AS` at `/Off` — measured 2026-09-07 — so this fixture carries a box whose
 * data says ticked and whose appearance state says otherwise. That is not a
 * flaw in the fixture; it is a document this build's own dependency produces,
 * and it is the one shape that separates the two possible readings.
 *
 * A reader keyed on `/AS`, which is what a viewer paints, answers **false** for
 * that box and reddens the first case. A reader keyed on the field's value
 * against the widget's own on-state answers true, and answers a radio group
 * correctly as well. The unticked case is the other half: without it a reader
 * that always answered `true` would pass.
 */

/** A fixture carrying one field of each type. `ticked` decides the checkbox. */
async function form({ ticked = true }: { readonly ticked?: boolean } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();

  const text = fields.createTextField('applicant.name');
  text.setText('Ada');
  text.addToPage(page, { x: 20, y: 540, width: 200, height: 20, font });

  const checkbox = fields.createCheckBox('applicant.agrees');
  if (ticked) checkbox.check();
  else checkbox.uncheck();
  checkbox.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  // TWO WIDGETS, ONE FIELD. Every case about naming rests on this: a radio
  // group is where `getName()` stops identifying a widget.
  const radio = fields.createRadioGroup('applicant.post');
  radio.addOptionToPage('first', page, { x: 20, y: 460, width: 16, height: 16 });
  radio.addOptionToPage('second', page, { x: 60, y: 460, width: 16, height: 16 });
  radio.select('first');

  const dropdown = fields.createDropdown('applicant.title');
  dropdown.addOptions(['Dr', 'Mr', 'Ms']);
  dropdown.select('Dr');
  dropdown.addToPage(page, { x: 20, y: 420, width: 100, height: 20, font });

  const listbox = fields.createOptionList('applicant.languages');
  listbox.addOptions(['English', 'Dutch', 'Welsh']);
  listbox.select('Dutch');
  listbox.addToPage(page, { x: 20, y: 340, width: 100, height: 60, font });

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
  document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray)
    .push(signatureRef);

  return document.save();
}

/** A page with a square on it and no fields at all. */
async function marked(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  page.drawRectangle({ x: 20, y: 30, width: 80, height: 30 });
  return document.save();
}

async function onSession<T>(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Every field the reader lists, as `{kind, name, value, on}` quadruples. */
async function listed(
  bytes: Uint8Array,
): Promise<{ kind: string; name: string; value: string; on: boolean | null }[]> {
  const answer = await onSession(bytes, (session) => readFormFields(session));
  return answer.fields.map(({ kind, name, value, on }) => ({ kind, name, value, on }));
}

describe('readFormFields', () => {
  it('NAMES ALL SIX TYPES, and a radio group is two widgets of one field', async () => {
    expect(await listed(await form())).toStrictEqual([
      { kind: 'text', name: 'applicant.name', value: 'Ada', on: null },
      { kind: 'checkbox', name: 'applicant.agrees', value: '', on: true },
      // BOTH ANSWER THE SAME NAME, which is why the index is what points.
      { kind: 'radio', name: 'applicant.post', value: '', on: true },
      { kind: 'radio', name: 'applicant.post', value: '', on: false },
      { kind: 'dropdown', name: 'applicant.title', value: 'Dr', on: null },
      { kind: 'listbox', name: 'applicant.languages', value: 'Dutch', on: null },
      { kind: 'signature', name: 'applicant.signature', value: '', on: null },
    ]);
  });

  it('READS AN UNTICKED BOX AS UNTICKED, which is the other half of the pair', async () => {
    // The case above asserts `on: true` for a box whose `/AS` says `/Off`, so a
    // reader keyed on the appearance state fails there. This is its partner: a
    // reader that answered `true` unconditionally would pass that one, and this
    // is what separates the reading from a constant.
    const unticked = (await listed(await form({ ticked: false })))[1];
    expect(unticked).toStrictEqual({
      kind: 'checkbox',
      name: 'applicant.agrees',
      value: '',
      on: false,
    });
  });

  it('READS A RADIO FROM ITS OWN /AS, so the group does not report two selections', async () => {
    // The reading the field's value ALONE would get wrong: both widgets of a
    // group answer the same `getValue()`, so a reader that stopped there would
    // report the whole group as selected. What separates them is each widget's
    // own on-state key — measured as `["0","Off"]` and `["1","Off"]` against a
    // field value of `0`.
    const radios = (await listed(await form())).filter((field) => field.kind === 'radio');
    expect(radios.map((field) => field.on)).toStrictEqual([true, false]);
  });

  it('CARRIES A CHOICE FIELD S OPTIONS, in the document s order', async () => {
    const answer = await onSession(await form(), (session) => readFormFields(session));
    expect(answer.fields.map((field) => [...field.options])).toStrictEqual([
      [],
      [],
      // A RADIO'S OPTIONS ARE ITS LABELS, and its value is an export value —
      // measured as "0" against labels ["first","second"], different
      // vocabularies corresponding by index. Recorded here so a surface that
      // matched one against the other meets this case rather than a document.
      ['first', 'second'],
      ['first', 'second'],
      ['Dr', 'Mr', 'Ms'],
      ['English', 'Dutch', 'Welsh'],
      [],
    ]);
  });

  it('PLACES EACH FIELD, in PDF user space', async () => {
    const answer = await onSession(await form(), (session) => readFormFields(session));
    // THE FIRST ONE ONLY, because the rectangle's conversion is
    // `pageAnnotations.test.ts`' subject against three page shapes and asserting
    // seven of them here would be that file's coverage restated in numbers read
    // from whichever run produced them first.
    // HALF A POINT WIDER THAN THE BOX pdf-lib WAS ASKED FOR, on every side, and
    // that is the border rather than a rounding error: `pageAnnotations.ts`
    // records the same expansion for `setRect` and its measurement, so this is
    // the documented behaviour arriving through a widget.
    expect(answer.fields[0]?.rect).toStrictEqual({ x0: 19.5, y0: 539.5, x1: 220.5, y1: 560.5 });
    expect(answer.fields.every((field) => field.rect !== null)).toBe(true);
  });

  it('IS A DIFFERENT WALK FROM THE ANNOTATIONS, sharing no entries', async () => {
    // ADR-0041 measured the annotation walk filtering widgets. This is the same
    // fact from the other side, and it is what settles a field being named by a
    // position in THIS walk: the two index spaces are disjoint, so an
    // annotation handle can never name a field.
    const bytes = await form();
    const fields = await onSession(bytes, (session) => readFormFields(session));
    const annotations = await onSession(bytes, (session) => readAnnotations(session));

    expect(fields.fields).toHaveLength(7);
    expect(annotations.annotations).toStrictEqual([]);
  });

  it('CONTROL: a page with a mark and no fields lists no fields', async () => {
    // The positive control's partner. Without it, every reading above is
    // satisfied by a walk that returns whatever is in `/Annots` — and the
    // square this fixture draws is content rather than an annotation, so the
    // case below is what says the two readers are not the same list.
    const bytes = await marked();
    expect(await listed(bytes)).toStrictEqual([]);
    // AND THE OTHER WALK IS ALSO EMPTY, so this fixture cannot be used to claim
    // the field walk merely filtered something out.
    const annotations = await onSession(bytes, (session) => readAnnotations(session));
    expect(annotations.annotations).toStrictEqual([]);
  });

  it('CONTROL: the reader finds something on the fixture, so an empty answer means absence', async () => {
    // 4b. Every reading here is a walk, and every broken walk prints the same
    // clean nothing. This is the line that separates *no fields* from *no
    // reader*, and it names one it must find rather than counting.
    const answer = await onSession(await form(), (session) => readFormFields(session));
    expect(answer.fields.map((field) => field.name)).toContain('applicant.signature');
    expect(answer.truncated).toBe(false);
  });
});
