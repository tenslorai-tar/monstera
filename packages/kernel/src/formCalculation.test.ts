import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind, FieldFill } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { calculationScript, formatScripts } from './fieldActions.js';
import { applyFillFormField, captureFillFormField, invertFillFormField, readFormFields } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Filling a form whose fields work each other out (ADR-0226 Decisions 5 and 6), through the real MuPDF, saved, and read
 * back by pdf-lib, a second reader that runs nothing of this module's.
 *
 * The form: `price` and `qty` are typed, `total` is `AFSimple_Calculate("PRD", ["price", "qty"])` and `sum` is
 * `SUM(["total", "extra"])`, listed in `/CO` with `sum` FIRST, so a calculator that ignored the form's order would work
 * `sum` from the old total. `total` arrives holding a stale `99`, which only an exact undo puts back.
 */
async function form(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();
  const at = (y: number) => ({ x: 50, y, width: 200, height: 20, font });
  const action = (js: string) => document.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of(js) });
  const money = formatScripts({ kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus' });

  const price = fields.createTextField('price');
  price.addToPage(page, at(560));
  price.acroField.dict.set(PDFName.of('AA'), document.context.obj({ F: action(money.format), K: action(money.keystroke) }));
  fields.createTextField('qty').addToPage(page, at(530));
  fields.createTextField('extra').addToPage(page, at(500));
  const total = fields.createTextField('total');
  total.addToPage(page, at(470));
  total.setText('99');
  total.acroField.dict.set(PDFName.of('AA'), document.context.obj({ C: action(calculationScript({ operation: 'product', fields: ['price', 'qty'] })) }));
  const sum = fields.createTextField('sum');
  sum.addToPage(page, at(440));
  sum.acroField.dict.set(PDFName.of('AA'), document.context.obj({ C: action(calculationScript({ operation: 'sum', fields: ['total', 'extra'] })) }));
  // THE ORDER IS THE FORM'S: `sum` before `total`, so `sum` reads the total as it stood before this pass.
  document.catalog.getOrCreateAcroForm().dict.set(PDFName.of('CO'), document.context.obj([sum.acroField.ref, total.acroField.ref]));

  const several = fields.createOptionList('several');
  several.addOptions(['a', 'b', 'c']);
  several.enableMultiselect();
  several.addToPage(page, { x: 50, y: 330, width: 200, height: 60, font });
  const one = fields.createOptionList('one');
  one.addOptions(['a', 'b']);
  one.addToPage(page, { x: 50, y: 250, width: 200, height: 60, font });
  const typed = fields.createDropdown('typed');
  typed.addOptions(['Mr', 'Ms']);
  typed.enableEditing();
  typed.addToPage(page, { x: 50, y: 200, width: 120, height: 20, font });
  const fixed = fields.createDropdown('fixed');
  fixed.addOptions(['Mr', 'Ms']);
  fixed.addToPage(page, { x: 50, y: 170, width: 120, height: 20, font });
  return document.save();
}

async function indexOf(session: Awaited<ReturnType<typeof mupdfWriter.open>>, name: string): Promise<number> {
  const { fields } = await readFormFields(session);
  const found = fields.find((field) => field.name === name);
  if (found === undefined) throw new Error(`no field ${name}`);
  return found.index;
}

function fillOf(index: number, value: FieldFill): CommandOfKind<'fillFormField'> {
  return { kind: 'fillFormField', page: 0, index, value, version: asDocVersion(1) };
}

/** What pdf-lib reads each text field as, from the saved bytes. */
async function texts(bytes: Uint8Array): Promise<Record<string, string | undefined>> {
  const form = (await PDFDocument.load(bytes)).getForm();
  const read = (name: string) => form.getTextField(name).getText();
  return { price: read('price'), qty: read('qty'), total: read('total'), sum: read('sum') };
}

describe('a fill works the form out in the same command', () => {
  it('works each calculation of ours out, in the form’s order, and pdf-lib reads the results from the saved file', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      await applyFillFormField(session, fillOf(await indexOf(session, 'price'), { set: 'text', text: '2.5' }));
      await applyFillFormField(session, fillOf(await indexOf(session, 'qty'), { set: 'text', text: '4' }));
      const saved = await mupdfWriter.serialise(session);
      // `sum` WORKED FIRST in each pass, so after the second fill it holds the total the first fill left: 0 (2.5 × 0).
      // A calculator that ignored `/CO` and worked `total` first would answer 10 here.
      expect(await texts(saved)).toStrictEqual({ price: '2.5', qty: '4', total: '10', sum: '0' });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('an undo puts every calculated field back exactly, a stale total included, in the same step', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      const command = fillOf(await indexOf(session, 'qty'), { set: 'text', text: '3' });
      const capture = await captureFillFormField(session, command);
      if (!capture.captured) throw new Error(capture.reason);
      expect(capture.prior.calculated).toStrictEqual([
        { name: 'sum', text: '' },
        { name: 'total', text: '99' },
      ]);
      await applyFillFormField(session, command);
      expect((await texts(await mupdfWriter.serialise(session)))['total']).toBe('0');
      await invertFillFormField(session, capture.prior);
      // CONTROL: working the form out again from the restored value would answer 0, never the stale 99.
      expect(await texts(await mupdfWriter.serialise(session))).toMatchObject({ qty: '', total: '99' });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a formatted field stores what was typed and SHOWS it formatted, as a reader does', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      await applyFillFormField(session, fillOf(await indexOf(session, 'price'), { set: 'text', text: '1234.5' }));
      const saved = await mupdfWriter.serialise(session);
      expect((await texts(saved))['price']).toBe('1234.5');
      // THE APPEARANCE a reader draws when it runs no script: MuPDF's own stream, read from the saved file.
      const document = mupdf.PDFDocument.openDocument(saved, 'application/pdf') as mupdf.PDFDocument;
      const widget = document.loadPage(0).getWidgets().find((each) => each.getName() === 'price');
      const drawn = widget?.getObject().get('AP', 'N').readStream().asString() ?? '';
      expect(drawn).toContain('1,234.50');
      expect(drawn).not.toContain('1234.5)');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('a dropdown that takes typing', () => {
  it('holds a typed value it does not list, and pdf-lib reads it; a dropdown that does not take typing refuses it', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      await applyFillFormField(session, fillOf(await indexOf(session, 'typed'), { set: 'choice', option: 'Dr' }));
      const saved = await PDFDocument.load(await mupdfWriter.serialise(session));
      expect(saved.getForm().getDropdown('typed').getSelected()).toStrictEqual(['Dr']);
      // CONTROL: the same value into the dropdown whose /Ff has no Edit bit.
      await expect(applyFillFormField(session, fillOf(await indexOf(session, 'fixed'), { set: 'choice', option: 'Dr' }))).rejects.toThrow(/does not offer/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('a list that takes several values', () => {
  it('is filled with several, undone to none, and pdf-lib reads both from the saved file', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      const command = fillOf(await indexOf(session, 'several'), { set: 'choices', options: ['c', 'b'] });
      const capture = await captureFillFormField(session, command);
      if (!capture.captured) throw new Error(capture.reason);
      await applyFillFormField(session, command);
      const filled = await PDFDocument.load(await mupdfWriter.serialise(session));
      // THE DOCUMENT'S ORDER, whatever order they were picked in.
      expect(filled.getForm().getOptionList('several').getSelected()).toStrictEqual(['b', 'c']);
      expect((await readFormFields(session)).fields.find((field) => field.name === 'several')?.values).toStrictEqual(['b', 'c']);
      await invertFillFormField(session, capture.prior);
      expect((await PDFDocument.load(await mupdfWriter.serialise(session))).getForm().getOptionList('several').getSelected()).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('is refused for a list that takes one, and for an option the list does not offer', async () => {
    const session = await mupdfWriter.open(await form());
    try {
      await expect(applyFillFormField(session, fillOf(await indexOf(session, 'one'), { set: 'choices', options: ['a', 'b'] }))).rejects.toThrow(/takes one/u);
      await expect(applyFillFormField(session, fillOf(await indexOf(session, 'several'), { set: 'choices', options: ['z'] }))).rejects.toThrow(/does not offer/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
