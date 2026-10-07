import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, FormFieldHandle, FormFieldProperties } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { calculationScript } from './fieldActions.js';
import { applyEditFormFields } from './formFieldEdit.js';
import { readFormFields } from './formFields.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * A field renamed into another group (`a.b` to `c.b`) is moved under the group its new name spells, and every reader
 * that opens the result agrees.
 *
 * ## The control
 *
 * Before the move the fixture holds `a.b` and no group `c`, so a case that passed because the name already read as the
 * new one would fail at the first assertion; and the refusals leave the tree as it was, compared by name list.
 */

const VERSION = asDocVersion(1);

/** The partial names of every node under `/Fields`, as paths: groups and fields alike, so an empty group would show. */
async function treeOf(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes);
  const found: string[] = [];
  const walk = (list: PDFArray | undefined, prefix: string): void => {
    for (let at = 0; list !== undefined && at < list.size(); at += 1) {
      const node = list.lookupMaybe(at, PDFDict);
      const name = node?.lookup(PDFName.of('T'));
      if (node === undefined || !(name instanceof PDFString || name instanceof PDFHexString)) continue;
      const path = prefix === '' ? name.decodeText() : `${prefix}.${name.decodeText()}`;
      found.push(path);
      walk(node.lookupMaybe(PDFName.of('Kids'), PDFArray), path);
    }
  };
  walk(document.getForm().acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray), '');
  return found.sort();
}

async function groupedForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 300]);
  const form = document.getForm();
  const place = (name: string, at: number, kind: 'text' | 'check' = 'text'): void => {
    if (kind === 'check') form.createCheckBox(name).addToPage(page, { x: 20, y: 20 + at * 30, width: 16, height: 16 });
    else form.createTextField(name).addToPage(page, { x: 20, y: 20 + at * 30, width: 100, height: 20 });
  };
  place('a.b', 1);
  place('a.c', 2);
  place('d.e', 3, 'check');
  place('x', 4);
  place('total', 5);
  const total = form.getTextField('total');
  const actions = document.context.obj({
    C: document.context.obj({
      S: PDFName.of('JavaScript'),
      JS: PDFString.of(calculationScript({ operation: 'sum', fields: ['a.b', 'a.c'] })),
    }),
  });
  total.acroField.dict.set(PDFName.of('AA'), actions);
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

async function namesIn(bytes: Uint8Array): Promise<string[]> {
  const { fields } = await withSession(bytes, (session) => readFormFields(session));
  return fields.map((field) => field.name).sort();
}

function renaming(handle: FormFieldHandle, name: string, more: FormFieldProperties = {}): CommandOfKind<'editFormFields'> {
  return { kind: 'editFormFields', edits: [{ field: handle, set: { name, ...more } }], version: VERSION };
}

/** A save through MuPDF and an open: what Save and reopen do to the bytes. */
async function throughMupdf(bytes: Uint8Array): Promise<Uint8Array> {
  return withSession(bytes, (session) => mupdfWriter.serialise(session));
}

describe('renaming a field into another group', () => {
  it('moves a.b under a new group c, leaves a with its other field, and every reader agrees after a save and an open', async () => {
    const original = await groupedForm();
    expect(await treeOf(original), 'CONTROL: before the move the form has no group c and a holds b').toStrictEqual(['a', 'a.b', 'a.c', 'd', 'd.e', 'total', 'x']);
    const handle = await handleOf(original, 'a.b');
    const moved = await applyEditFormFields(original, renaming(handle, 'c.b'));
    for (const bytes of [moved, await throughMupdf(moved)]) {
      expect(await treeOf(bytes)).toStrictEqual(['a', 'a.c', 'c', 'c.b', 'd', 'd.e', 'total', 'x']);
      expect(await namesIn(bytes)).toStrictEqual(['a.c', 'c.b', 'd.e', 'total', 'x']);
    }
  });

  it('moves into a group the document already has, and out to the top level', async () => {
    const original = await groupedForm();
    const joined = await applyEditFormFields(original, renaming(await handleOf(original, 'a.b'), 'd.b'));
    expect(await treeOf(joined)).toStrictEqual(['a', 'a.c', 'd', 'd.b', 'd.e', 'total', 'x']);
    const top = await applyEditFormFields(joined, renaming(await handleOf(joined, 'a.c'), 'loose'));
    expect(await treeOf(top), 'a group the move empties is taken out with it').toStrictEqual(['d', 'd.b', 'd.e', 'loose', 'total', 'x']);
    expect(await namesIn(await throughMupdf(top))).toStrictEqual(['d.b', 'd.e', 'loose', 'total', 'x']);
  });

  it('keeps what the field took from the group it left: its type and its settings', async () => {
    const document = await PDFDocument.load(await groupedForm());
    const field = document.getForm().getTextField('a.b');
    const group = field.acroField.dict.lookup(PDFName.of('Parent'), PDFDict);
    // The type and the default appearance live on the group and not on the field, as a form written by another program has them.
    group.set(PDFName.of('FT'), PDFName.of('Tx'));
    group.set(PDFName.of('DA'), PDFString.of('/Helv 11 Tf 0 g'));
    field.acroField.dict.delete(PDFName.of('FT'));
    field.acroField.dict.delete(PDFName.of('DA'));
    const original = await document.save({ updateFieldAppearances: false });
    const before = (await withSession(original, (session) => readFormFields(session))).fields.find((each) => each.name === 'a.b');
    expect(before?.kind, 'CONTROL: the field reads as text through its group').toBe('text');
    const moved = await applyEditFormFields(original, renaming(await handleOf(original, 'a.b'), 'z.b'));
    const after = (await withSession(await throughMupdf(moved), (session) => readFormFields(session))).fields.find((each) => each.name === 'z.b');
    expect(after?.kind).toBe('text');
    const reloaded = await PDFDocument.load(moved);
    const dict = reloaded.getForm().getTextField('z.b').acroField.dict;
    expect(dict.has(PDFName.of('FT'))).toBe(true);
    expect(dict.has(PDFName.of('DA'))).toBe(true);
  });

  it('keeps a calculation of ours naming the field, so a rename does not leave it adding up nothing', async () => {
    const original = await groupedForm();
    const moved = await applyEditFormFields(original, renaming(await handleOf(original, 'a.b'), 'c.b'));
    const document = await PDFDocument.load(moved);
    const action = document.getForm().getTextField('total').acroField.dict.lookup(PDFName.of('AA'), PDFDict).lookup(PDFName.of('C'), PDFDict);
    const script = action.lookup(PDFName.of('JS'), PDFString, PDFHexString).decodeText();
    expect(script).toContain('"c.b"');
    expect(script).not.toContain('"a.b"');
    expect(script, 'the field it did not rename is still named').toContain('"a.c"');
  });

  it('refuses a name that runs through another field, or is another field\'s, by name and leaves the tree as it was', async () => {
    const original = await groupedForm();
    const handle = await handleOf(original, 'a.b');
    await expect(applyEditFormFields(original, renaming(handle, 'x.y'))).rejects.toMatchObject({ reason: 'name-taken' });
    await expect(applyEditFormFields(original, renaming(handle, 'a.c'))).rejects.toMatchObject({ reason: 'name-taken' });
    await expect(applyEditFormFields(original, renaming(handle, 'd'))).rejects.toMatchObject({ reason: 'name-taken' });
    await expect(applyEditFormFields(original, renaming(handle, 'c..b'))).rejects.toMatchObject({ reason: 'name-parent' });
    expect(await treeOf(original)).toStrictEqual(['a', 'a.b', 'a.c', 'd', 'd.e', 'total', 'x']);
  });

  it('a rename inside the same group is still a rename of its last part, and moves nothing', async () => {
    const original = await groupedForm();
    const renamed = await applyEditFormFields(original, renaming(await handleOf(original, 'a.b'), 'a.beta'));
    expect(await treeOf(renamed)).toStrictEqual(['a', 'a.beta', 'a.c', 'd', 'd.e', 'total', 'x']);
  });
});
