import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { type CommandOfKind, type FieldFill, type FormFieldProperties, KEEPS_THE_FIELD_WALK } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyDuplicateFormField, applyEditFormFields } from './formFieldEdit.js';
import { applyFillFormField, applyResetForm } from './formFields.js';
import { buildFormTestPdf } from './formTestForm.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * `KEEPS_THE_FIELD_WALK`, proven against the engine: an edit leaves every page's widget walk as it was — the same widgets,
 * of the same kinds, at the same places — so a field named by its place at the version an edit was sent at names the
 * same field at the version it produced. The renderer's command lane relies on it to send a nudge composed before the
 * previous edit landed (the owner's W6).
 *
 * Read by MuPDF, whose walk the handles index, after the edit's own writer (pdf-lib) rewrote the document. The CONTROL is
 * a duplicate, which adds widgets, read the same way: the reading must see a walk that changed.
 */

const VERSION = asDocVersion(1);

interface Place {
  readonly page: number;
  readonly index: number;
  readonly type: string;
  readonly name: string;
}

/** Every page's widgets in walk order, read by MuPDF. */
async function placesOf(bytes: Uint8Array): Promise<Place[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const places: Place[] = [];
      for (let page = 0; page < document.countPages(); page += 1) {
        document
          .loadPage(page)
          .getWidgets()
          .forEach((widget, index) => places.push({ page, index, type: widget.getFieldType(), name: widget.getName() }));
      }
      return places;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** What a carried handle relies on: each place's page, index and kind. */
async function walkOf(bytes: Uint8Array): Promise<string[]> {
  return (await placesOf(bytes)).map((place) => `${String(place.page)}:${String(place.index)}:${place.type}`);
}

describe('the commands that keep the field walk', () => {
  it('names exactly the edit, the fill and the reset', () => {
    expect([...KEEPS_THE_FIELD_WALK]).toStrictEqual(['editFormFields', 'fillFormField', 'resetForm']);
  });

  // THE OWNER'S F7: a reset writes values and redraws, as a fill does, so it is in the set above; this is the reading
  // that says so, MuPDF's walk after a reset of every field, against the walk before.
  it('a reset of every field leaves the walk as it was', async () => {
    // THE TEST FORM HAS NO PUSH BUTTON, so one whose action is Reset form with no /Fields (every field) is added first.
    const form = await PDFDocument.load(await buildFormTestPdf());
    const reset = form.getForm().createButton('walk.reset');
    reset.addToPage('Reset', form.getPage(0), { x: 20, y: 20, width: 80, height: 20 });
    reset.acroField.getWidgets()[0]?.dict.set(PDFName.of('A'), form.context.obj({ S: 'ResetForm' }));
    const bytes = await form.save();
    const before = await walkOf(bytes);
    const button = (await placesOf(bytes)).find((place) => place.name === 'walk.reset');
    if (button === undefined) throw new Error('the added push button is not in the walk');
    const session = await mupdfWriter.open(bytes);
    try {
      await applyResetForm(session, { kind: 'resetForm', page: button.page, index: button.index, version: VERSION });
      expect(await walkOf(await mupdfWriter.serialise(session))).toStrictEqual(before);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  // THE OWNER'S O6a: a second press on a form 3 to 5 s after a fill was refused as out of date, because the lane follows
  // only a command that keeps the walk. A fill of every kind, read back by MuPDF's walk after MuPDF's own writer saved it.
  it('a fill of every kind — text, choice, several choices, a button on and off — leaves the walk as it was', async () => {
    const bytes = await buildFormTestPdf();
    const before = await walkOf(bytes);
    const places = await placesOf(bytes);
    const first = (type: string): Place => {
      const found = places.find((place) => place.type === type);
      if (found === undefined) throw new Error(`the form has no ${type}`);
      return found;
    };
    const session = await mupdfWriter.open(bytes);
    try {
      const options = await withDocument(session, (document) => {
        const combo = first('combobox');
        const list = first('listbox');
        const optionsOf = (place: Place): string[] =>
          document.loadPage(place.page).getWidgets()[place.index]?.getOptions().map(String) ?? [];
        return { combo: optionsOf(combo), list: optionsOf(list) };
      });
      const fills: [Place, FieldFill][] = [
        [first('text'), { set: 'text', text: 'Filled by the walk case' }],
        [first('checkbox'), { set: 'button', on: true }],
        [first('checkbox'), { set: 'button', on: false }],
        [first('radiobutton'), { set: 'button', on: true }],
        [first('combobox'), { set: 'choice', option: options.combo[0] ?? '' }],
        [first('listbox'), { set: 'choice', option: options.list[0] ?? '' }],
      ];
      for (const [place, value] of fills) {
        await applyFillFormField(session, { kind: 'fillFormField', page: place.page, index: place.index, value, version: VERSION });
        expect(await walkOf(await mupdfWriter.serialise(session)), `after ${JSON.stringify(value)}`).toStrictEqual(before);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('an edit of every kind of field — moved, recoloured, renamed, restyled — leaves the walk as it was', async () => {
    const bytes = await buildFormTestPdf();
    const before = await walkOf(bytes);
    expect(before.length, 'the form has a walk to keep').toBeGreaterThan(30);
    const places = await placesOf(bytes);
    const first = (type: string): { page: number; index: number; name: string } => {
      const found = places.find((place) => place.type === type);
      if (found === undefined) throw new Error(`the form has no ${type}`);
      return { page: found.page, index: found.index, name: found.name };
    };
    const sets: [ReturnType<typeof first>, FormFieldProperties][] = [
      [first('text'), { rect: { x0: 300, y0: 300, x1: 400, y1: 320 }, borderColour: [0, 0, 1], borderStyle: 'dashed' }],
      [first('text'), { name: 'renamed_by_the_walk_case' }],
      [first('checkbox'), { fillColour: [1, 1, 0], checkStyle: 'cross' }],
      [first('radiobutton'), { rect: { x0: 50, y0: 50, x1: 66, y1: 66 } }],
      [first('combobox'), { fontSize: 14, readOnly: true }],
      [first('listbox'), { borderWidth: 3 }],
    ];
    let edited = bytes;
    for (const [field, set] of sets) {
      const command: CommandOfKind<'editFormFields'> = { kind: 'editFormFields', edits: [{ field, set }], version: VERSION };
      edited = await applyEditFormFields(edited, command);
      expect(await walkOf(edited), `after ${JSON.stringify(set)}`).toStrictEqual(before);
    }
  });

  it('CONTROL: a duplicate, which adds a widget, is seen to change the walk', async () => {
    const bytes = await buildFormTestPdf();
    const field = (await placesOf(bytes)).find((place) => place.type === 'text');
    if (field === undefined) throw new Error('the form has no text field');
    const duplicated = await applyDuplicateFormField(bytes, {
      kind: 'duplicateFormField',
      field: { page: field.page, index: field.index, name: field.name },
      to: { kind: 'pages', pages: [field.page === 0 ? 1 : 0] },
      version: VERSION,
    });
    expect(await walkOf(duplicated)).not.toStrictEqual(await walkOf(bytes));
  });
});
