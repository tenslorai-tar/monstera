import { PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, FormFieldHandle, FormFieldProperties, FormFieldRead } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { FieldEditRefusedError, applyDuplicateFormField, applyEditFormFields, applySetTabOrder } from './formFieldEdit.js';
import { readFieldProperties } from './formFieldRead.js';
import { readFormFields } from './formFields.js';
import { buildFormTestPdf } from './formTestForm.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Changing a field that exists, read back through a different library from the writer and after a save and an open.
 *
 * ## The control
 *
 * Every property is asserted against the value the untouched field reads as FIRST, so a case that passed because the
 * reader answers the same thing for every field would fail at the control. The instrument is shown to separate a field
 * the command changed from one it did not.
 */

const VERSION = asDocVersion(1);

/** Opens `bytes` in MuPDF, runs `read`, closes. */
async function withSession<T>(bytes: Uint8Array, read: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await read(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** A save through MuPDF and an open of the result: what a person's Save and reopen does to the bytes. */
async function throughMupdf(bytes: Uint8Array): Promise<Uint8Array> {
  return withSession(bytes, (session) => mupdfWriter.serialise(session));
}

/** The handle of the `nth` widget of the field called `name`, from the field list. */
async function handleOf(bytes: Uint8Array, name: string, nth = 0): Promise<FormFieldHandle> {
  const { fields } = await withSession(bytes, (session) => readFormFields(session));
  const found = fields.filter((field) => field.name === name)[nth];
  if (found === undefined) throw new Error(`The fixture has no field ${name}.`);
  return { page: found.page, index: found.index, name };
}

async function read(bytes: Uint8Array, handle: FormFieldHandle): Promise<FormFieldRead> {
  const [one] = await withSession(bytes, (session) => readFieldProperties(session, [handle]));
  if (one === null || one === undefined) throw new Error(`${handle.name} did not read.`);
  return one;
}

function editing(handle: FormFieldHandle, set: FormFieldProperties): CommandOfKind<'editFormFields'> {
  return { kind: 'editFormFields', edits: [{ field: handle, set }], version: VERSION };
}

describe('editing a field that exists', () => {
  it('sets a tooltip, required, read-only and a default value, and they survive a save and an open', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const before = await read(original, handle);
    expect(before.tooltip, 'control: an untouched field has none').toBeNull();
    expect(before.required).toBe(false);
    expect(before.defaultValue).toBeNull();

    const edited = await applyEditFormFields(
      original,
      editing(handle, { tooltip: 'Where we write to', required: true, readOnly: true, defaultValue: 'a@b.example' }),
    );
    for (const bytes of [edited, await throughMupdf(edited)]) {
      const after = await read(bytes, handle);
      expect(after.tooltip).toBe('Where we write to');
      expect(after.required).toBe(true);
      expect(after.readOnly).toBe(true);
      expect(after.defaultValue).toBe('a@b.example');
    }
  });

  it('takes a tooltip and a default value away with null, and keeps every other field exactly as it was', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const other = await handleOf(original, 'phone');
    const set = await applyEditFormFields(original, editing(handle, { tooltip: 'x', defaultValue: 'y' }));
    const cleared = await applyEditFormFields(set, editing(handle, { tooltip: null, defaultValue: null }));
    const after = await read(cleared, handle);
    expect(after.tooltip).toBeNull();
    expect(after.defaultValue).toBeNull();
    expect(await read(cleared, other)).toStrictEqual(await read(original, other));
  });

  it('a change that is not about how a field looks leaves its appearance stream byte for byte', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const edited = await applyEditFormFields(original, editing(handle, { tooltip: 'only a tooltip' }));
    expect(await appearanceOf(edited, handle)).toStrictEqual(await appearanceOf(original, handle));
  });

  it('a change of border colour changes the appearance, so a regenerated look is not the untouched one (control)', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const edited = await applyEditFormFields(original, editing(handle, { borderColour: [1, 0, 0], borderWidth: 3 }));
    expect(await appearanceOf(edited, handle)).not.toStrictEqual(await appearanceOf(original, handle));
    const after = await read(await throughMupdf(edited), handle);
    expect(after.borderColour).toStrictEqual([1, 0, 0]);
    expect(after.borderWidth).toBe(3);
  });

  it('sets and takes away a fill colour', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const filled = await applyEditFormFields(original, editing(handle, { fillColour: [1, 1, 0] }));
    expect((await read(await throughMupdf(filled), handle)).fillColour).toStrictEqual([1, 1, 0]);
    const cleared = await applyEditFormFields(filled, editing(handle, { fillColour: null }));
    expect((await read(await throughMupdf(cleared), handle)).fillColour).toBeNull();
  });

  it('sets the face and the size, each kept apart from the other, and leaves an automatic size automatic', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const before = await read(original, handle);
    expect(before.font, 'control: the face a field starts in').toBe('helvetica');

    const faced = await applyEditFormFields(original, editing(handle, { font: 'times' }));
    const afterFace = await read(await throughMupdf(faced), handle);
    expect(afterFace.font).toBe('times');
    expect(afterFace.fontSize, 'the face alone leaves the size').toBe(before.fontSize);

    const sized = await applyEditFormFields(faced, editing(handle, { fontSize: 14 }));
    const afterSize = await read(await throughMupdf(sized), handle);
    expect(afterSize.fontSize).toBe(14);
    expect(afterSize.font, 'the size alone leaves the face').toBe('times');

    const automatic = await applyEditFormFields(sized, editing(handle, { fontSize: 0 }));
    expect((await read(automatic, handle)).fontSize).toBe(0);
  });

  it('moves and resizes a field: the rectangle read back is the rectangle written', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const rect = { x0: 100, y0: 300, x1: 260, y1: 330 };
    const edited = await applyEditFormFields(original, editing(handle, { rect }));
    const after = await read(await throughMupdf(edited), handle);
    expect(after.rect).not.toBeNull();
    expect(after.rect?.x0).toBeCloseTo(100, 1);
    expect(after.rect?.x1).toBeCloseTo(260, 1);
    expect(after.rect?.y0).toBeCloseTo(300, 1);
    expect(after.rect?.y1).toBeCloseTo(330, 1);
  });

  it('makes a text field multiline and back', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    expect((await read(original, handle)).multiline).toBe(false);
    const on = await applyEditFormFields(original, editing(handle, { multiline: true }));
    expect((await read(await throughMupdf(on), handle)).multiline).toBe(true);
    const off = await applyEditFormFields(on, editing(handle, { multiline: false }));
    expect((await read(await throughMupdf(off), handle)).multiline).toBe(false);
  });

  it('replaces a dropdown\'s choices', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'region');
    const before = await read(original, handle);
    const edited = await applyEditFormFields(original, editing(handle, { options: ['North', 'South'] }));
    const after = await read(await throughMupdf(edited), handle);
    expect(before.options).not.toStrictEqual(['North', 'South']);
    expect(after.options).toStrictEqual(['North', 'South']);
  });

  it('renames a radio group\'s export values in place, keeping which option is on', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'plan');
    const before = await read(original, handle);
    expect(before.options, 'control: the values the group starts with').toStrictEqual(['basic', 'plus', 'pro']);
    const edited = await applyEditFormFields(original, editing(handle, { options: ['one', 'two', 'three'] }));
    expect((await read(await throughMupdf(edited), handle)).options).toStrictEqual(['one', 'two', 'three']);
  });

  it('renames the states of a radio group that has no /Opt, and the option that was on is still on', async () => {
    const document = await PDFDocument.load(await buildFormTestPdf(), { updateMetadata: false });
    const group = document.getForm().getRadioGroup('plan');
    group.select('plus');
    group.acroField.dict.delete(PDFName.of('Opt'));
    const original = await document.save();
    const handle = await handleOf(original, 'plan');
    expect((await read(original, handle)).options, 'control: with no /Opt the values are the states').toStrictEqual(['0', '1', '2']);
    const edited = await applyEditFormFields(original, editing(handle, { options: ['one', 'two', 'three'] }));
    expect((await read(await throughMupdf(edited), handle)).options).toStrictEqual(['one', 'two', 'three']);
    const fields = (await withSession(await throughMupdf(edited), (session) => readFormFields(session))).fields;
    expect(fields.filter((field) => field.name === 'plan').map((field) => field.on)).toStrictEqual([false, true, false]);
  });

  it('refuses a radio group given the wrong number of values, and two options sharing a value', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'plan');
    await expect(applyEditFormFields(original, editing(handle, { options: ['a', 'b'] }))).rejects.toMatchObject({ reason: 'options-count' });
    await expect(applyEditFormFields(original, editing(handle, { options: ['a', 'a', 'b'] }))).rejects.toMatchObject({
      reason: 'options-duplicate',
    });
  });

  it('renames a field, refuses a name another field holds, and refuses a name with an empty part (a move into a group is formFieldMove.test.ts)', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const renamed = await applyEditFormFields(original, editing(handle, { name: 'mail_address' }));
    const after = await read(await throughMupdf(renamed), { ...handle, name: 'mail_address' });
    expect(after.name).toBe('mail_address');
    await expect(applyEditFormFields(original, editing(handle, { name: 'phone' }))).rejects.toMatchObject({ reason: 'name-taken' });
    await expect(applyEditFormFields(original, editing(handle, { name: 'phone.second' }))).rejects.toMatchObject({ reason: 'name-taken' });
    await expect(applyEditFormFields(original, editing(handle, { name: 'a..b' }))).rejects.toMatchObject({ reason: 'name-parent' });
  });

  it('refuses a handle whose field has moved, and edits the same handle when it has not (control)', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    await expect(applyEditFormFields(original, editing({ ...handle, name: 'phone' }, { required: true }))).rejects.toBeInstanceOf(
      FieldEditRefusedError,
    );
    await expect(applyEditFormFields(original, editing({ ...handle, index: 999 }, { required: true }))).rejects.toMatchObject({
      reason: 'not-found',
    });
    await expect(applyEditFormFields(original, editing(handle, { required: true }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it('changes several fields in one command', async () => {
    const original = await buildFormTestPdf();
    const names = ['email', 'phone', 'date_of_birth'] as const;
    const handles = await Promise.all(names.map((name) => handleOf(original, name)));
    const edited = await applyEditFormFields(original, {
      kind: 'editFormFields',
      edits: handles.map((field) => ({ field, set: { required: true, tooltip: 'all three' } })),
      version: VERSION,
    });
    for (const handle of handles) {
      const after = await read(edited, handle);
      expect(after.required).toBe(true);
      expect(after.tooltip).toBe('all three');
    }
    expect((await read(edited, await handleOf(original, 'postcode'))).required, 'a field not named is untouched').toBe(false);
  });

  it('refuses an encrypted document in words, and does not touch it', async () => {
    const original = await buildFormTestPdf();
    const encrypted = await encryptedCopy(original);
    const handle: FormFieldHandle = { page: 0, index: 0, name: 'full_name' };
    await expect(applyEditFormFields(encrypted, editing(handle, { required: true }))).rejects.toMatchObject({ reason: 'encrypted' });
    await expect(applySetTabOrder(encrypted, { kind: 'setTabOrder', pages: [0], order: 'row' })).rejects.toMatchObject({ reason: 'encrypted' });
  });
});

describe('a format and a calculation are written as data and read back', () => {
  it('writes a number format and reads the same format back, and a field with none reads none (control)', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'grand_total');
    expect((await read(original, handle)).format).toBeNull();
    const format = { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'parens', currency: '£', currencyBefore: true } as const;
    const edited = await applyEditFormFields(original, editing(handle, { format }));
    const after = await read(await throughMupdf(edited), handle);
    expect(after.format).toStrictEqual(format);
    expect(after.customFormat).toBe(false);
  });

  it('writes each of the four kinds of format', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'grand_total');
    const formats = [
      { kind: 'percent', decimals: 1, separators: 'dot-comma' },
      { kind: 'date', pattern: 'dd/mm/yyyy' },
      { kind: 'time', pattern: 'h:MM tt' },
    ] as const;
    for (const format of formats) {
      const edited = await applyEditFormFields(original, editing(handle, { format }));
      expect((await read(await throughMupdf(edited), handle)).format).toStrictEqual(format);
    }
  });

  it('takes its own format away with null, and leaves a script it did not write alone', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'grand_total');
    const withFormat = await applyEditFormFields(original, editing(handle, { format: { kind: 'percent', decimals: 0, separators: 'comma-dot' } }));
    const cleared = await applyEditFormFields(withFormat, editing(handle, { format: null }));
    expect((await read(cleared, handle)).format).toBeNull();

    const custom = await withCustomFormatScript(original, 'grand_total', 'event.value = "custom";');
    const read1 = await read(custom, handle);
    expect(read1.format).toBeNull();
    expect(read1.customFormat, 'a script that is not ours is reported as a script').toBe(true);
    const stillThere = await applyEditFormFields(custom, editing(handle, { format: null }));
    expect((await read(stillThere, handle)).customFormat, 'null does not remove a script this application did not write').toBe(true);
  });

  it('writes a calculation and its place in the calculation order, and reorders it', async () => {
    const original = await buildFormTestPdf();
    const total = await handleOf(original, 'grand_total');
    const one = await handleOf(original, 'customer');
    expect((await read(original, total)).calculation).toBeNull();
    const calculation = { operation: 'sum', fields: ['phone', 'customer', 'order_ref'] } as const;
    const first = await applyEditFormFields(original, editing(total, { calculation }));
    const afterFirst = await read(await throughMupdf(first), total);
    expect(afterFirst.calculation).toStrictEqual(calculation);
    expect(afterFirst.calculationPosition).toBe(0);

    const second = await applyEditFormFields(first, editing(one, { calculation: { operation: 'max', fields: ['phone'] } }));
    expect((await read(second, one)).calculationPosition, 'a second calculated field follows the first').toBe(1);
    const moved = await applyEditFormFields(second, editing(one, { calculationPosition: 0 }));
    expect((await read(moved, one)).calculationPosition).toBe(0);
    expect((await read(moved, total)).calculationPosition).toBe(1);

    const removed = await applyEditFormFields(moved, editing(total, { calculation: null }));
    expect((await read(removed, total)).calculation).toBeNull();
    expect((await read(removed, total)).calculationPosition).toBeNull();
  });
});

describe('copying a field onto other pages', () => {
  it('copies a text field onto two pages, each copy a new field with a name of its own, the original untouched', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const before = (await withSession(original, (session) => readFormFields(session))).fields;
    const copied = await applyDuplicateFormField(original, { kind: 'duplicateFormField', field: handle, pages: [1, 2], version: VERSION });
    const after = (await withSession(await throughMupdf(copied), (session) => readFormFields(session))).fields;
    expect(after.length).toBe(before.length + 2);
    const names = after.filter((field) => field.name.startsWith('email')).map((field) => `${String(field.page)}:${field.name}`);
    expect(names).toContain('0:email');
    expect(names).toContain('1:email_p2');
    expect(names).toContain('2:email_p3');
    const copy = await read(copied, { page: 1, index: after.find((field) => field.name === 'email_p2')?.index ?? 0, name: 'email_p2' });
    expect(copy.rect).toStrictEqual((await read(original, handle)).rect);
  });

  it('a copy starts empty and copies a second time under a free name', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'email');
    const once = await applyDuplicateFormField(original, { kind: 'duplicateFormField', field: handle, pages: [1], version: VERSION });
    const twice = await applyDuplicateFormField(once, { kind: 'duplicateFormField', field: handle, pages: [1], version: VERSION });
    const names = (await withSession(twice, (session) => readFormFields(session))).fields.map((field) => field.name);
    expect(names).toContain('email_p2');
    expect(names).toContain('email_p2_2');
  });

  it('refuses a radio option and a copy onto its own page', async () => {
    const original = await buildFormTestPdf();
    const radio = await handleOf(original, 'plan');
    await expect(
      applyDuplicateFormField(original, { kind: 'duplicateFormField', field: radio, pages: [1], version: VERSION }),
    ).rejects.toMatchObject({ reason: 'duplicate-radio' });
    const text = await handleOf(original, 'email');
    await expect(
      applyDuplicateFormField(original, { kind: 'duplicateFormField', field: text, pages: [0], version: VERSION }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('the order the Tab key walks', () => {
  it('sets /Tabs on each named page and no other', async () => {
    const original = await buildFormTestPdf();
    const edited = await applySetTabOrder(original, { kind: 'setTabOrder', pages: [0, 2], order: 'column' });
    expect(await tabsOf(edited)).toStrictEqual(['C', undefined, 'C']);
    expect(await tabsOf(original), 'control: the fixture starts with none').toStrictEqual([undefined, undefined, undefined]);
    const row = await applySetTabOrder(edited, { kind: 'setTabOrder', pages: [1], order: 'structure' });
    expect(await tabsOf(row)).toStrictEqual(['C', 'S', 'C']);
  });
});

async function tabsOf(bytes: Uint8Array): Promise<(string | undefined)[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.node.lookupMaybe(PDFName.of('Tabs'), PDFName)?.decodeText());
}

/** One widget's normal appearance stream, as bytes, through the library that wrote it. */
async function appearanceOf(bytes: Uint8Array, handle: FormFieldHandle): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  const field = document.getForm().getField(handle.name);
  const widget = field.acroField.getWidgets()[0];
  const normal = widget?.dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.lookup(PDFName.of('N'));
  if (!(normal instanceof PDFRawStream)) throw new Error('The field has no appearance stream.');
  return [...normal.getContents()];
}

/** Gives the field a format script this application did not write: the other writer's idea of a format. */
async function withCustomFormatScript(bytes: Uint8Array, name: string, script: string): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const field = document.getForm().getField(name);
  const action = document.context.obj({ S: PDFName.of('JavaScript'), JS: document.context.obj(script) });
  const aa = document.context.obj({ F: action });
  field.acroField.dict.set(PDFName.of('AA'), aa);
  return document.save();
}

/** The document written encrypted, through MuPDF's own writer. */
function encryptedCopy(plain: Uint8Array): Promise<Uint8Array> {
  const opened = mupdf.Document.openDocument(plain, 'application/pdf');
  const pdf = opened.asPDF();
  if (pdf === null) throw new Error('The fixture is not a PDF.');
  const buffer = pdf.saveToBuffer('encrypt=aes-128,user-password=user,owner-password=owner');
  return Promise.resolve(buffer.asUint8Array().slice());
}
