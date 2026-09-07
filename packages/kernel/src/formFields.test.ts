import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, FieldFill } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import type { MupdfSession } from './engineSeam.js';
import {
  applyDeleteFormFields,
  applyFillFormField,
  captureDeleteFormFields,
  captureFillFormField,
  invertFillFormField,
  type ListedField,
  readFormFields,
} from './formFields.js';
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

/**
 * A form carrying the shapes a FILL has to refuse, which the six-type one does
 * not: a read-only field, a push button, and a radio group split across pages.
 *
 * Separate from {@link form} rather than added to it, because every reading
 * case above names field positions and adding to that fixture would move them —
 * which is a change to what those cases assert, made silently, by a commit
 * about something else.
 */
async function fillable(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const first = document.addPage([400, 600]);
  const second = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();

  const text = fields.createTextField('applicant.name');
  text.setText('Ada');
  text.addToPage(first, { x: 20, y: 540, width: 200, height: 20, font });

  const locked = fields.createTextField('applicant.reference');
  locked.setText('LOCKED');
  locked.enableReadOnly();
  locked.addToPage(first, { x: 20, y: 500, width: 200, height: 20, font });

  const push = fields.createButton('applicant.submit');
  push.addToPage('Send', first, { x: 20, y: 460, width: 60, height: 20, font });

  const dropdown = fields.createDropdown('applicant.title');
  dropdown.addOptions(['Dr', 'Mr', 'Ms']);
  dropdown.select('Dr');
  dropdown.addToPage(first, { x: 20, y: 420, width: 100, height: 20, font });

  // A GROUP WHOSE SELECTED WIDGET IS ON ANOTHER PAGE. The capture cannot tell
  // *nothing is selected* from *the selection is elsewhere* while looking at one
  // page's walk, and an inverse built from the wrong answer deselects a group
  // that was not deselected.
  const split = fields.createRadioGroup('applicant.split');
  split.addOptionToPage('here', first, { x: 20, y: 380, width: 16, height: 16 });
  split.addOptionToPage('there', second, { x: 20, y: 380, width: 16, height: 16 });
  split.select('there');

  // THE MERGED SHAPE, BY HAND, and it is the hard one. `@cantoo/pdf-lib` always
  // writes a field dictionary with a `/Kids` array holding a separate widget;
  // the format also lets a field with exactly one widget be ONE dictionary —
  // `/FT` and `/T` beside `/Subtype /Widget` — which is what a great many real
  // forms carry. Appended LAST so every index the cases above name is unmoved.
  const context = document.context;
  const merged = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Tx'),
    T: PDFString.of('merged'),
    Rect: context.obj([20, 200, 220, 220]),
    F: 4,
  });
  const mergedRef = context.register(merged);
  first.node.addAnnot(mergedRef);
  document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray)
    .push(mergedRef);

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

  it('READS A PUSH BUTTON AS HAVING NO STATE, which is not the same as being off', async () => {
    // It answered `on: false` until 2026-09-07 — *a box that is unticked*
    // rather than *a control that has no tick* — and it got there through the
    // `/AP` `/N` hazard: a push button's is a STREAM, which answers
    // `isDictionary()`, whose first key is `BBox`. A panel reading `false` here
    // would offer to tick a Send button.
    const button = (await listed(await fillable()))[2];
    expect(button).toStrictEqual({
      kind: 'button',
      name: 'applicant.submit',
      value: '',
      on: null,
    });
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

/** A fill naming one widget, at a version nothing here compares. */
function filling(page: number, index: number, value: FieldFill): CommandOfKind<'fillFormField'> {
  // THE VERSION IS THE BUS'S QUESTION, not this file's: `#refuseIfStale` runs
  // before a spec is reached, so an apply called directly never sees it.
  return { kind: 'fillFormField', page, index, value, version: asDocVersion(1) };
}

/**
 * Applies a fill and answers what the reader says afterwards.
 *
 * The reading goes through `readFormFields` rather than through MuPDF directly,
 * which is the point: `on` is the field's value against the widget's own
 * on-state key, so a fill that moved only `/AS` — which is what one toggle does
 * to a stale box — is visible here rather than hidden behind a getter that
 * agrees with whatever was set.
 */
async function afterFill(
  bytes: Uint8Array,
  command: CommandOfKind<'fillFormField'>,
): Promise<readonly ListedField[]> {
  return onSession(bytes, async (session) => {
    await applyFillFormField(session, command);
    return (await readFormFields(session)).fields;
  });
}

/** What pdf-lib says the field values are — the second library. */
async function byPdfLib(bytes: Uint8Array): Promise<Record<string, string>> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const values: Record<string, string> = {};
  for (const field of document.getForm().getFields()) {
    const dictionary = field.acroField.dict;
    const held = dictionary.get(dictionary.context.obj('V'));
    values[field.getName()] = held === undefined ? '(absent)' : String(held);
  }
  return values;
}

describe('applyFillFormField', () => {
  it('FILLS A TEXT FIELD, and the OTHER library reads the value back', async () => {
    const bytes = await onSession(await form(), async (session) => {
      await applyFillFormField(session, filling(0, 0, { set: 'text', text: 'Grace' }));
      return mupdfWriter.serialise(session);
    });
    // pdf-lib, not MuPDF: a getter answering what a setter was just given is
    // the library agreeing with itself, which says nothing about the document.
    expect((await byPdfLib(bytes))['applicant.name']).toBe('(Grace)');
  });

  it('CHOOSES AN OPTION on a dropdown and on a listbox', async () => {
    const dropdown = await afterFill(await form(), filling(0, 4, { set: 'choice', option: 'Ms' }));
    expect(dropdown[4]?.value).toBe('Ms');
    const listbox = await afterFill(await form(), filling(0, 5, { set: 'choice', option: 'Welsh' }));
    expect(listbox[5]?.value).toBe('Welsh');
  });

  it('CLEARS A CHOICE with the empty option, which is a value and not an absence', async () => {
    // Measured 2026-09-07: a dropdown built with no selection reads `""`, and
    // `setChoiceValue('')` clears one that has a selection. So the empty string
    // passes the membership test deliberately — it is how a choice is cleared,
    // and an inverse restoring an untouched field has to be able to say it.
    const cleared = await afterFill(await form(), filling(0, 4, { set: 'choice', option: '' }));
    expect(cleared[4]?.value).toBe('');
  });

  it('TICKS A BOX WHOSE APPEARANCE IS STALE, which takes two toggles', async () => {
    // THE CASE THE ONE-TOGGLE IMPLEMENTATION FAILS. The fixture's box has
    // `/V /Yes` and `/AS /Off` — pdf-lib's `check()` leaves it that way — and
    // MuPDF's `toggle()` is keyed on `/AS`. So asking for OFF and toggling once
    // gives on/on, which is the opposite of what was asked. Reading back
    // between toggles is what closes it.
    const off = await afterFill(await form(), filling(0, 1, { set: 'button', on: false }));
    expect(off[1]).toMatchObject({ kind: 'checkbox', on: false });

    // And the other direction on the same box, which needs none.
    const on = await afterFill(await form(), filling(0, 1, { set: 'button', on: true }));
    expect(on[1]).toMatchObject({ kind: 'checkbox', on: true });
  });

  it('SELECTS THE SECOND RADIO, and the first goes off with it', async () => {
    // A group is one field with several widgets, so this asserts BOTH: a fill
    // that set the named widget without moving its sibling would leave a
    // document reporting two selections, which the format cannot mean.
    const after = await afterFill(await form(), filling(0, 3, { set: 'button', on: true }));
    expect(after.filter((field) => field.kind === 'radio').map((field) => field.on)).toStrictEqual([
      false,
      true,
    ]);
  });

  it('REFUSES A READ-ONLY FIELD, which MuPDF fills without complaint', async () => {
    // Measured: `setTextValue` lands on a read-only field and reads back
    // "CHANGED". Every rule in `refuseUnfillable` is this build's, and this is
    // the case that says so.
    const bytes = await fillable();
    await expect(
      afterFill(bytes, filling(0, 1, { set: 'text', text: 'CHANGED' })),
    ).rejects.toThrow(/read-only/u);
    // AND THE DOCUMENT IS UNTOUCHED, which the throw alone does not say: a
    // refusal after the write is not a refusal.
    const held = await onSession(bytes, (session) => readFormFields(session));
    expect(held.fields[1]?.value).toBe('LOCKED');
  });

  it('REFUSES A PUSH BUTTON, a signature, and every mismatched pairing', async () => {
    const split = await fillable();
    const six = await form();
    // A push button, which `setTextValue` writes to without complaint.
    await expect(afterFill(split, filling(0, 2, { set: 'text', text: 'x' }))).rejects.toThrow(
      /cannot fill a button field/u,
    );
    // A signature, which has no fill this build performs.
    await expect(afterFill(six, filling(0, 6, { set: 'text', text: 'x' }))).rejects.toThrow(
      /cannot fill a signature field/u,
    );
    // An on-state aimed at a text field — `toggle()` there does nothing at all,
    // silently, so a build that passed it through would report success.
    await expect(afterFill(six, filling(0, 0, { set: 'button', on: true }))).rejects.toThrow(
      /An on-state cannot fill a text field/u,
    );
    // A text value aimed at a checkbox.
    await expect(afterFill(six, filling(0, 1, { set: 'text', text: 'Yes' }))).rejects.toThrow(
      /A text value cannot fill a checkbox field/u,
    );
    // An option the document does not offer, which MuPDF stores happily.
    await expect(
      afterFill(six, filling(0, 4, { set: 'choice', option: 'Professor' })),
    ).rejects.toThrow(/does not offer the option/u);
  });

  it('REFUSES AN INDEX THIS PAGE HAS NO WIDGET FOR, naming the walk it counted', async () => {
    // The message matters as much as the refusal: the annotation walk shares no
    // entries with this one, so a reader sent to the wrong list by a generic
    // sentence would look for a field where none can be.
    await expect(afterFill(await form(), filling(0, 99, { set: 'text', text: 'x' }))).rejects.toThrow(
      /widget walk that document\.formFields answers with/u,
    );
  });
});

describe('captureFillFormField and invertFillFormField', () => {
  it('RESTORES A TEXT FIELD to what it held', async () => {
    const held = await onSession(await form(), async (session) => {
      const command = filling(0, 0, { set: 'text', text: 'Grace' });
      const captured = await captureFillFormField(session, command);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      await applyFillFormField(session, command);
      const changed = (await readFormFields(session)).fields[0]?.value;
      await invertFillFormField(session, captured.prior);
      return { changed, restored: (await readFormFields(session)).fields[0]?.value };
    });
    // BOTH HALVES. Without the middle reading, an inverse that did nothing and
    // an apply that did nothing produce the same final value.
    expect(held).toStrictEqual({ changed: 'Grace', restored: 'Ada' });
  });

  it('RESTORES THE RADIO THAT WAS ON, which is a DIFFERENT widget from the one filled', async () => {
    // The finding this whole shape exists for: toggling the second radio moves
    // the field to it and turns the first off, so the inverse of *select the
    // second* is *select the first*. An inverse spelt *unset what was set*
    // would leave the group deselected — a document the user never had.
    const held = await onSession(await form(), async (session) => {
      const command = filling(0, 3, { set: 'button', on: true });
      const captured = await captureFillFormField(session, command);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      await applyFillFormField(session, command);
      const changed = (await readFormFields(session)).fields.map((field) => field.on);
      await invertFillFormField(session, captured.prior);
      return {
        prior: captured.prior,
        changed,
        restored: (await readFormFields(session)).fields.map((field) => field.on),
      };
    });

    // THE PRIOR NAMES WIDGET 2, not the widget 3 the command named. That is the
    // assertion; the round trip below would also pass for a prior that happened
    // to work by coincidence on a two-option group.
    expect(held.prior).toStrictEqual({
      page: 0,
      index: 2,
      value: { set: 'button', on: true },
    });
    expect(held.changed).toStrictEqual([null, true, false, true, null, null, null]);
    expect(held.restored).toStrictEqual([null, true, true, false, null, null, null]);
  });

  it('RESTORES A CHECKBOX, including the stale appearance it started with', async () => {
    const held = await onSession(await form(), async (session) => {
      const command = filling(0, 1, { set: 'button', on: false });
      const captured = await captureFillFormField(session, command);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      await applyFillFormField(session, command);
      const changed = (await readFormFields(session)).fields[1]?.on;
      await invertFillFormField(session, captured.prior);
      return { changed, restored: (await readFormFields(session)).fields[1]?.on };
    });
    expect(held).toStrictEqual({ changed: false, restored: true });
  });

  it('REFUSES TO CAPTURE a choice field holding a value the document does not offer', async () => {
    // A hostile — or merely careless — document can carry one, because MuPDF
    // stores an unlisted value without complaint. Recording it as a prior would
    // produce an inverse this build's own apply rejects: an undo that throws,
    // at the moment a person presses undo.
    const strange = await onSession(await form(), async (session) => {
      const document = await PDFDocument.load(await mupdfWriter.serialise(session), {
        updateMetadata: false,
      });
      const dropdown = document.getForm().getDropdown('applicant.title');
      dropdown.addOptions(['Professor']);
      dropdown.select('Professor');
      // AND THEN THE OPTION IS TAKEN AWAY, leaving the value behind — which is
      // the state the refusal is about and which nothing else here produces.
      dropdown.setOptions(['Dr', 'Mr', 'Ms']);
      return document.save();
    });

    const captured = await onSession(strange, (session) =>
      captureFillFormField(session, filling(0, 4, { set: 'choice', option: 'Mr' })),
    );
    expect(captured.captured).toBe(false);
    expect(captured.captured ? '' : captured.reason).toMatch(/not among the options/u);
  });

  it('FINDS THE SELECTED RADIO ON ANOTHER PAGE, rather than reading absence', async () => {
    // A group's widgets may sit on different pages, and then *nothing is lit
    // here* and *the selection is elsewhere* are the same reading from one
    // page's walk — with opposite inverses. The field's `/Kids` count is what
    // separates them, so the search widens only for a field that reaches past
    // this page.
    const captured = await onSession(await fillable(), (session) =>
      captureFillFormField(session, filling(0, 4, { set: 'button', on: true })),
    );
    expect(captured).toStrictEqual({
      captured: true,
      // PAGE 1, INDEX 0 — the sibling. A capture that stopped at this page
      // would have recorded `{ page: 0, index: 4, on: false }`, whose inverse
      // deselects a group that was never deselected.
      prior: { page: 1, index: 0, value: { set: 'button', on: true } },
    });
  });

  it('AND RESTORES IT, so the widened search is not just a different wrong answer', async () => {
    const held = await onSession(await fillable(), async (session) => {
      const command = filling(0, 4, { set: 'button', on: true });
      const captured = await captureFillFormField(session, command);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      await applyFillFormField(session, command);
      const changed = (await readFormFields(session)).fields.map((field) => field.on);
      await invertFillFormField(session, captured.prior);
      return { changed, restored: (await readFormFields(session)).fields.map((one) => one.on) };
    });
    // The group moves to page 0's widget and back to page 1's. The two arrays
    // differ at exactly the two radio positions, which is what says the write
    // reached a sibling on another page in both directions.
    // THE MERGED TEXT FIELD SITS BETWEEN THE TWO RADIOS in the walk — page 0's
    // widgets, then page 1's — so the two arrays differ at positions 4 and 6.
    // A pair that differed anywhere else would be a write that reached a
    // neighbour rather than the sibling it named.
    expect(held.changed).toStrictEqual([null, null, null, null, true, null, false]);
    expect(held.restored).toStrictEqual([null, null, null, null, false, null, true]);
  });

  it('CONTROL: the capture refuses BEFORE the log holds an entry, on every rule the apply has', async () => {
    // `captureRemoveAnnotation`'s care, and it is not decoration: a capture that
    // validated nothing would let the bus checkpoint a command that is about to
    // throw, so the document gains a log entry for something that never ran.
    // A throw here — rather than `captured: false` — is the same refusal the
    // apply raises, which is what says the two agree.
    await expect(
      onSession(await fillable(), (session) =>
        captureFillFormField(session, filling(0, 1, { set: 'text', text: 'x' })),
      ),
    ).rejects.toThrow(/read-only/u);
  });

  it('CONTROL: a capture that succeeds names a value the document actually held', async () => {
    // Without this the refusals above are satisfied by a capture that refuses
    // everything, which is the reassuring answer for a file whose subject is
    // refusal.
    const captured = await onSession(await form(), (session) =>
      captureFillFormField(session, filling(0, 5, { set: 'choice', option: 'Welsh' })),
    );
    expect(captured).toStrictEqual({
      captured: true,
      prior: { page: 0, index: 5, value: { set: 'choice', option: 'Dutch' } },
    });
  });

  it('CONTROL: the walk finds the fields these cases act on, so a refusal is not blindness', async () => {
    // 4b, for this describe rather than the reader's: every case above locates
    // a widget by index, and a walk that came back short would refuse for the
    // wrong reason while printing the same red.
    const answer = await onSession(await fillable(), (session) => readFormFields(session));
    expect(answer.fields.map((field) => field.name)).toStrictEqual([
      'applicant.name',
      'applicant.reference',
      'applicant.submit',
      'applicant.title',
      'applicant.split',
      'merged',
      'applicant.split',
    ]);
  });
});

/** A deletion naming rows of one page's walk, at a version nothing here compares. */
function deleting(page: number, indices: readonly number[]): CommandOfKind<'deleteFormFields'> {
  return { kind: 'deleteFormFields', page, indices, version: asDocVersion(1) };
}

/**
 * What pdf-lib says the FIELDS are — the second library, and the load-bearing
 * reading of this describe.
 *
 * MuPDF's own walk is over widgets, so a field left in `/AcroForm` with no
 * widget is invisible to it: asking MuPDF whether a delete worked is asking the
 * library that performed it, through the one view that cannot see what it left.
 * pdf-lib lists the tree, which is what every other reader sees.
 */
async function fieldNamesByPdfLib(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document
    .getForm()
    .getFields()
    .map((field) => field.getName());
}

/** Applies a deletion and answers both readings of the result. */
async function afterDelete(
  bytes: Uint8Array,
  command: CommandOfKind<'deleteFormFields'>,
): Promise<{ widgets: string[]; fields: string[] }> {
  return onSession(bytes, async (session) => {
    await applyDeleteFormFields(session, command);
    const listed = await readFormFields(session);
    return {
      widgets: listed.fields.map((field) => field.name),
      fields: await fieldNamesByPdfLib(await mupdfWriter.serialise(session)),
    };
  });
}

describe('applyDeleteFormFields', () => {
  it('REMOVES THE FIELD FROM BOTH STRUCTURES, not only from the page walk', async () => {
    // THE WHOLE ROW IN ONE CASE. `deleteAnnotation` alone leaves the field in
    // `/AcroForm` with an empty `/Kids`, which pdf-lib still lists by name —
    // measured — so a document ends in two states: this build says the field is
    // gone and every other reader says it is there and unfillable. Asserting
    // the widget walk alone would pass for exactly that defect.
    const after = await afterDelete(await form(), deleting(0, [0]));
    expect(after.widgets).not.toContain('applicant.name');
    expect(after.fields).not.toContain('applicant.name');
    // AND THE REST SURVIVE, which is the half a delete-everything also passes.
    expect(after.fields).toContain('applicant.agrees');
  });

  it('DELETES SEVERAL AT ONCE, in an order that does not move the survivors', async () => {
    // The indices are positions in one walk and removing a widget shifts every
    // position after it. Deleting low-to-high removes the wrong things; this
    // names two whose positions straddle others, so an ascending pass would
    // take a listbox and a signature instead.
    const after = await afterDelete(await form(), deleting(0, [1, 4]));
    expect(after.widgets).toStrictEqual([
      'applicant.name',
      'applicant.post',
      'applicant.post',
      'applicant.languages',
      'applicant.signature',
    ]);
  });

  it('TAKES ONE WIDGET OF A RADIO GROUP and leaves the field, because it still has one', async () => {
    // Measured: a group's `/Kids` goes 2 to 1 and the field is not empty, so
    // nothing is pruned. A prune keyed on *this field lost a widget* rather
    // than on *this field has none left* would delete the whole group here.
    const after = await afterDelete(await form(), deleting(0, [2]));
    expect(after.widgets.filter((name) => name === 'applicant.post')).toHaveLength(1);
    expect(after.fields).toContain('applicant.post');
  });

  it('TAKES BOTH WIDGETS OF A GROUP and then the field goes too', async () => {
    const after = await afterDelete(await form(), deleting(0, [2, 3]));
    expect(after.widgets).not.toContain('applicant.post');
    expect(after.fields).not.toContain('applicant.post');
  });

  it('DELETES A MERGED FIELD, which is the shape pdf-lib never writes', async () => {
    // THE HARD SHAPE (audit item 2). A field and its one widget in a single
    // dictionary is what a great many real forms carry, and measured it leaves
    // `/Fields` on its own — so this case says the delete reaches a shape the
    // rest of this file cannot produce, and it does NOT redden when the pruning
    // is removed, because the pruning is not what deletes it.
    //
    // The first spelling of this case pointed at index 3 of `fillable()`, which
    // is a pdf-lib DROPDOWN and therefore split. It went red under the pruning
    // mutation, which is how the mislabelling surfaced: a case named for the
    // hard shape that reddens for the easy one's reason is testing the easy one.
    const after = await afterDelete(await fillable(), deleting(0, [5]));
    expect(after.widgets).not.toContain('merged');
    expect(after.fields).not.toContain('merged');
    expect(after.fields).toContain('applicant.title');
  });

  it('REFUSES AN INDEX THIS PAGE HAS NO WIDGET FOR, before deleting anything', async () => {
    // A refusal on the fourth of five, after three have gone, is a document
    // nobody asked for and no undo entry describes correctly.
    const bytes = await form();
    await expect(afterDelete(bytes, deleting(0, [0, 99]))).rejects.toThrow(
      /widget walk that document\.formFields answers with/u,
    );
    const held = await onSession(bytes, (session) => readFormFields(session));
    expect(held.fields.map((field) => field.name)).toContain('applicant.name');
  });

  it('CONTROL: it leaves a document with no fields named alone', async () => {
    // Without this, every case above is satisfied by a delete that empties the
    // form — *the name is gone* is true of a document that lost everything, and
    // that is this describe's reassuring answer.
    const after = await afterDelete(await form(), deleting(0, [6]));
    expect(after.fields).toStrictEqual([
      'applicant.name',
      'applicant.agrees',
      'applicant.post',
      'applicant.title',
      'applicant.languages',
    ]);
  });

  it('CONTROL: the capture refuses with a reason, and validates every index first', async () => {
    const refused = await onSession(await form(), (session) =>
      captureDeleteFormFields(session, deleting(0, [0])),
    );
    expect(refused.captured).toBe(false);
    expect(refused.captured ? '' : refused.reason).toMatch(/whole object graph/u);

    // AND IT VALIDATES, which the refusal above cannot show: a capture that
    // refused without looking would answer identically for a handle naming
    // nothing, and the bus would checkpoint a command about to throw.
    await expect(
      onSession(await form(), (session) =>
        captureDeleteFormFields(session, deleting(0, [0, 99])),
      ),
    ).rejects.toThrow(/outside this page/u);
  });

  it('CONTROL: the walk finds the fields this describe deletes from, in the order it names', async () => {
    // 4b again, and it earns its place twice: every case above names an INDEX,
    // so a fixture whose order moved would delete the wrong field while every
    // assertion about names still passed. This is the list those indices mean.
    const answer = await onSession(await fillable(), (session) => readFormFields(session));
    expect(answer.fields.map((field) => field.name)).toStrictEqual([
      'applicant.name',
      'applicant.reference',
      'applicant.submit',
      'applicant.title',
      'applicant.split',
      'merged',
      'applicant.split',
    ]);
  });
});
