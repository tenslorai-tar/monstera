import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFOptionList, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, FieldChoice, FormFieldHandle, FormFieldProperties, FormFieldRead } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { applyEditFormFields } from './formFieldEdit.js';
import { readFieldProperties } from './formFieldRead.js';
import { applyFillFormField, readFormFields } from './formFields.js';
import { buildFormTestPdf } from './formTestForm.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * A choice field whose document lists each choice's value and the text shown apart (`/Opt` pairs) keeps BOTH through
 * an edit, a save and an open.
 *
 * ## The control
 *
 * The field's own `setOptions` takes strings, writes the value twice and so drops every text a document listed apart.
 * {@link withTheOldWrite} runs exactly that and the reading shows the texts gone, so the cases below can fail: a reader
 * that answered the value for both would pass them against a writer that dropped the texts.
 */

const VERSION = asDocVersion(1);

const PAIRS: readonly FieldChoice[] = [
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];

/** A page with one list box, one dropdown and one list of plain strings, the first two listing a value and a text apart. */
async function pairedForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 300]);
  const form = document.getForm();
  const list = form.createOptionList('colours');
  list.addToPage(page, { x: 20, y: 20, width: 120, height: 100 });
  const dropdown = form.createDropdown('size');
  dropdown.addToPage(page, { x: 160, y: 20, width: 100, height: 20 });
  const plain = form.createOptionList('plain');
  plain.addToPage(page, { x: 160, y: 60, width: 100, height: 60 });
  const pairs = (): PDFArray =>
    document.context.obj(
      PAIRS.map((choice) =>
        typeof choice === 'string' ? choice : [PDFHexString.fromText(choice.value), PDFHexString.fromText(choice.label)],
      ),
    );
  list.acroField.dict.set(PDFName.of('Opt'), pairs());
  dropdown.acroField.dict.set(PDFName.of('Opt'), pairs());
  plain.acroField.dict.set(PDFName.of('Opt'), document.context.obj([PDFString.of('one'), PDFString.of('two')]));
  return document.save({ updateFieldAppearances: false });
}

async function withSession<T>(bytes: Uint8Array, use: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await use(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

async function handleOf(bytes: Uint8Array, name: string): Promise<FormFieldHandle> {
  const { fields } = await withSession(bytes, (session) => readFormFields(session));
  const found = fields.find((field) => field.name === name);
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

/** What a save through MuPDF and an open do to the bytes. */
async function throughMupdf(bytes: Uint8Array): Promise<Uint8Array> {
  return withSession(bytes, (session) => mupdfWriter.serialise(session));
}

/** The `/Opt` entries as another library reads them: the value and the text, from the file itself. */
async function listedBy(bytes: Uint8Array, name: string): Promise<{ readonly value: string; readonly text: string }[]> {
  const document = await PDFDocument.load(bytes);
  const field = document.getForm().getOptionList(name);
  return field.acroField.getOptions().map((option) => ({
    value: option.value.decodeText(),
    text: option.display.decodeText(),
  }));
}

/** The write this change replaced: the field's own `setOptions`, which takes the values alone. */
async function withTheOldWrite(bytes: Uint8Array, name: string, values: readonly string[]): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  const field = document.getForm().getField(name);
  if (!(field instanceof PDFOptionList)) throw new Error(`${name} is not a list`);
  field.setOptions([...values]);
  return document.save({ updateFieldAppearances: false });
}

/** The display texts and the stored values MuPDF reports for the first widget of `name`, from a reopened document. */
function mupdfSees(bytes: Uint8Array, name: string): { readonly values: string[]; readonly texts: string[] } {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (!(opened instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  const widget = opened.loadPage(0).getWidgets().find((each) => each.getName() === name);
  if (widget === undefined) throw new Error(`MuPDF found no ${name}`);
  return { values: widget.getOptions(true), texts: widget.getOptions(false) };
}

describe('a choice field that lists a value and its text apart', () => {
  it('CONTROL: the field\'s own write drops every text, so the reading below can tell a kept one from a lost one', async () => {
    const original = await pairedForm();
    expect(await listedBy(original, 'colours'), 'the fixture starts with the texts apart').toStrictEqual([
      { value: 'r', text: 'Red' },
      { value: 'g', text: 'Green' },
      { value: 'b', text: 'Blue' },
    ]);
    const dropped = await withTheOldWrite(original, 'colours', ['r', 'g', 'b']);
    expect(await listedBy(dropped, 'colours')).toStrictEqual([
      { value: 'r', text: 'r' },
      { value: 'g', text: 'g' },
      { value: 'b', text: 'b' },
    ]);
  });

  it('shows the text and the value apart, and a list with none apart as plain strings', async () => {
    const original = await pairedForm();
    expect((await read(original, await handleOf(original, 'colours'))).options).toStrictEqual(PAIRS);
    expect((await read(original, await handleOf(original, 'size'))).options).toStrictEqual(PAIRS);
    expect((await read(original, await handleOf(original, 'plain'))).options, 'a list with no texts apart is unchanged').toStrictEqual([
      'one',
      'two',
    ]);
  });

  it('edits the texts and the values of a list box and keeps both through a save and an open', async () => {
    const original = await pairedForm();
    const handle = await handleOf(original, 'colours');
    const wanted: readonly FieldChoice[] = [
      { value: 'r', label: 'Crimson' },
      { value: 'gr', label: 'Green' },
      'plain',
      { value: 'b', label: 'Blue' },
    ];
    const edited = await applyEditFormFields(original, editing(handle, { options: wanted }));
    for (const bytes of [edited, await throughMupdf(edited)]) {
      expect((await read(bytes, handle)).options).toStrictEqual(wanted);
      expect(await listedBy(bytes, 'colours')).toStrictEqual([
        { value: 'r', text: 'Crimson' },
        { value: 'gr', text: 'Green' },
        { value: 'plain', text: 'plain' },
        { value: 'b', text: 'Blue' },
      ]);
    }
    expect(mupdfSees(edited, 'colours')).toStrictEqual({
      values: ['r', 'gr', 'plain', 'b'],
      texts: ['Crimson', 'Green', 'plain', 'Blue'],
    });
  });

  it('draws the text a person reads in the list box, not the value', async () => {
    const original = await pairedForm();
    const handle = await handleOf(original, 'colours');
    const edited = await applyEditFormFields(original, editing(handle, { options: [{ value: 'v1', label: 'Crimson' }, 'plain'] }));
    const opened = mupdf.Document.openDocument(edited, 'application/pdf');
    if (!(opened instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    const widget = opened.loadPage(0).getWidgets().find((each) => each.getName() === 'colours');
    if (widget === undefined) throw new Error('no widget');
    // The appearance stream's own text operators: a widget is not page text, so the page's text reader cannot see it.
    const stream = widget.getObject().get('AP', 'N').readStream().asString();
    const shown = (word: string): string => `<${Buffer.from(word, 'latin1').toString('hex').toUpperCase()}> Tj`;
    expect(stream).toContain(shown('Crimson'));
    expect(stream).not.toContain(shown('v1'));
  });

  it('edits a dropdown the same way, and leaves a plain list\'s values as they were typed', async () => {
    const original = await pairedForm();
    const dropdown = await handleOf(original, 'size');
    const plain = await handleOf(original, 'plain');
    const edited = await applyEditFormFields(original, {
      kind: 'editFormFields',
      edits: [
        { field: dropdown, set: { options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] } },
      ],
      version: VERSION,
    } as unknown as CommandOfKind<'editFormFields'>);
    expect((await read(edited, dropdown)).options).toStrictEqual([
      { value: 's', label: 'Small' },
      { value: 'l', label: 'Large' },
    ]);
    const second = await applyEditFormFields(edited, editing(plain, { options: ['one', 'two', 'three'] }));
    expect((await read(second, plain)).options).toStrictEqual(['one', 'two', 'three']);
  });

  it('fills a choice by the text a person reads and stores the VALUE, and reads a value another program stored as its text', async () => {
    const original = await pairedForm();
    const handle = await handleOf(original, 'colours');
    const session = await mupdfWriter.open(original);
    try {
      await applyFillFormField(session, {
        kind: 'fillFormField',
        page: handle.page,
        index: handle.index,
        value: { set: 'choice', option: 'Green' },
        version: VERSION,
      });
      const filled = await mupdfWriter.serialise(session);
      const document = await PDFDocument.load(filled);
      const field = document.getForm().getOptionList('colours');
      expect(String(field.acroField.dict.get(PDFName.of('V'))), 'the file keeps the value, as another program would read it').toBe('(g)');
      const { fields } = await withSession(filled, (reopened) => readFormFields(reopened));
      expect(fields.find((each) => each.name === 'colours')?.values, 'and the list reads it as the text').toStrictEqual(['Green']);
    } finally {
      await mupdfWriter.close(session);
    }
    // CONTROL: a plain list keeps storing exactly what it was given, so the mapping changes nothing where nothing is apart.
    const plain = await handleOf(original, 'plain');
    const second = await mupdfWriter.open(original);
    try {
      await applyFillFormField(second, {
        kind: 'fillFormField',
        page: plain.page,
        index: plain.index,
        value: { set: 'choice', option: 'two' },
        version: VERSION,
      });
      const document = await PDFDocument.load(await mupdfWriter.serialise(second));
      expect(String(document.getForm().getOptionList('plain').acroField.dict.get(PDFName.of('V')))).toBe('(two)');
    } finally {
      await mupdfWriter.close(second);
    }
  });

  it('refuses a text apart from the value for a radio group, by name, and changes nothing', async () => {
    const original = await buildFormTestPdf();
    const handle = await handleOf(original, 'plan');
    const before = await read(original, handle);
    await expect(
      applyEditFormFields(original, editing(handle, { options: [{ value: 'a', label: 'Alpha' }, 'b', 'c'] })),
    ).rejects.toMatchObject({ reason: 'options-radio-labels' });
    expect((await read(original, handle)).options).toStrictEqual(before.options);
  });

  it('refuses two choices that store the same value, whatever their texts', async () => {
    const original = await pairedForm();
    const handle = await handleOf(original, 'colours');
    await expect(
      applyEditFormFields(
        original,
        editing(handle, {
          options: [
            { value: 'x', label: 'One' },
            { value: 'x', label: 'Two' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ reason: 'options-duplicate' });
  });
});
