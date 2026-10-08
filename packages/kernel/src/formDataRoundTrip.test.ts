import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import {
  applyImportFormData,
  type ExportedField,
  planFormImport,
  readFormData,
  serialiseFormData,
} from './formData.js';
import { refuseUnfillable } from './formFields.js';
import { buildFormTestPdf, FORM_TEST_ORDER_REF } from './formTestForm.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * The application's own export, imported back, in all three formats.
 *
 * ## The mechanism this proves
 *
 * The export writes EVERY field, a read-only one included (`order_ref`). The import used to plan each value through
 * `refuseUnfillable` and throw on the first lock it met, so the whole file was refused and the person was told only
 * that nothing changed: the application could not read what it had written. The cases below use the 63 field form that
 * mirrors the owner's own test form, whose `order_ref` is the lock that did it.
 *
 * ## A round trip that compares a document with itself proves nothing
 *
 * The form is exported while FILLED and imported into the same form EMPTY, so an import that wrote nothing is a
 * difference. And "no warnings" is not vacuous: the cases after the round trip show the same plan naming a changed
 * lock, a missing field and a value a field refuses, so an empty list means the plan looked.
 */

/** The form with a value in every field a person can fill, and the read-only reference left as it is. */
async function filledForm(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await buildFormTestPdf());
  const form = document.getForm();
  const set = (name: string, value: string): void => {
    form.getTextField(name).setText(value);
  };
  set('full_name', 'Grace Hopper');
  set('email', 'grace@example.org');
  set('phone', '0207 946 0000');
  set('date_of_birth', '09/12/1906');
  set('postcode', 'SW1A2AA');
  set('comments', 'Line one\nLine two < & > "quoted"');
  set('customer', 'Navy');
  set('item_1', 'Compiler');
  set('qty_1', '2');
  set('price_1', '10.50');
  set('total_1', '21.00');
  set('grand_total', '21.00');
  set('accents', 'Zoë Ångström');
  set('max_ten', '0123456789');
  set('linked_name', 'Shared');
  set('date_signed', '01/10/2026');
  form.getRadioGroup('plan').select('plus');
  form.getRadioGroup('delivery').select('courier');
  form.getDropdown('region').select('East');
  form.getDropdown('editable_dropdown').select('Two');
  form.getOptionList('interests').select('Music');
  form.getCheckBox('newsletter').check();
  form.getCheckBox('terms').check();
  form.getCheckBox('grid_3').check();
  form.getCheckBox('grid_10').check();
  return document.save();
}

async function onSession<T>(bytes: Uint8Array, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Every field of a document as an export reads it, sorted so two readings compare. */
async function read(bytes: Uint8Array): Promise<readonly ExportedField[]> {
  const fields = await onSession(bytes, (session) => readFormData(session));
  return [...fields].sort((a, b) => a.name.localeCompare(b.name));
}

describe('the application imports its own export, in every format, with nothing to say', () => {
  it('CONTROL: the export does write the lock, and the rule the import used to apply refuses it', async () => {
    const filled = await filledForm();
    const written = await read(filled);
    expect(written.find((field) => field.name === 'order_ref')?.values).toStrictEqual([FORM_TEST_ORDER_REF]);
    const refused = await onSession(filled, (session) =>
      withDocument(session, (document) => {
        const widget = document.loadPage(1).getWidgets().find((candidate) => candidate.getName() === 'order_ref');
        if (widget === undefined) throw new Error('the fixture lost its read-only field');
        try {
          refuseUnfillable(widget, { set: 'text', text: FORM_TEST_ORDER_REF });
          return undefined;
        } catch (error) {
          return error;
        }
      }),
    );
    expect(String(refused)).toMatch(/read-only/u);
  });

  for (const format of ['json', 'xfdf', 'fdf'] as const) {
    it(`${format.toUpperCase()}: export a filled form, import into an empty one, and every field comes back with no skip`, async () => {
      const filled = await filledForm();
      const empty = await buildFormTestPdf();
      const exported = await onSession(filled, (session) => readFormData(session));
      const file = serialiseFormData(exported, format);

      const before = await read(empty);
      expect(before).not.toStrictEqual(await read(filled));

      const { plan, after } = await onSession(empty, async (session) => {
        const planned = await withDocument(session, (document) => planFormImport(document, file, format));
        await applyImportFormData(session, { kind: 'importFormData', format, bytes: file });
        return { plan: planned, after: await readFormData(session) };
      });

      expect(plan.skipped, 'the app’s own export names nothing it could not fill').toStrictEqual([]);
      expect(plan.fills.length, 'the plan really had values to write').toBeGreaterThan(20);
      expect([...after].sort((a, b) => a.name.localeCompare(b.name))).toStrictEqual(await read(filled));
    });
  }

  it('CONTROL: the same plan names a locked field the file would change, a field the form lacks and a value a field refuses', async () => {
    const empty = await buildFormTestPdf();
    const file = serialiseFormData(
      [
        { name: 'order_ref', values: ['ORD-9999'], asName: false },
        { name: 'no.such.field', values: ['x'], asName: false },
        { name: 'region', values: ['Atlantis'], asName: false },
        { name: 'full_name', values: ['Still filled'], asName: false },
      ],
      'json',
    );
    const { plan, after } = await onSession(empty, async (session) => {
      const planned = await withDocument(session, (document) => planFormImport(document, file, 'json'));
      await applyImportFormData(session, { kind: 'importFormData', format: 'json', bytes: file });
      return { plan: planned, after: await readFormData(session) };
    });
    expect([...plan.skipped].sort((a, b) => a.name.localeCompare(b.name))).toStrictEqual([
      { name: 'no.such.field', reason: 'not-in-document' },
      { name: 'order_ref', reason: 'read-only' },
      { name: 'region', reason: 'option-not-offered' },
    ]);
    // THE DOCUMENT'S OWN VALUE IS KEPT, and the field beside the skipped ones is filled: one field did not cost the file.
    expect(after.find((field) => field.name === 'order_ref')?.values).toStrictEqual([FORM_TEST_ORDER_REF]);
    expect(after.find((field) => field.name === 'full_name')?.values).toStrictEqual(['Still filled']);
  });
});
