import { PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { calculationScript, formatScripts } from './fieldActions.js';
import { type ListedField, readFormFields } from './formFields.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * The rules the field list carries for filling (ADR-0226 Decision 4), read through the real MuPDF from a form pdf-lib
 * writes, and read through `fieldRules.ts`, the one reader the Properties read takes too.
 *
 * EACH RULE IS SET ON ONE FIELD ONLY, and every case asserts the rule is off on the others: a reader that answered a
 * rule for every field, or for none, fails one half or the other.
 */
async function form(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();
  const at = (y: number) => ({ x: 50, y, width: 200, height: 20, font });

  const required = fields.createTextField('required');
  required.addToPage(page, at(560));
  required.enableRequired();

  const limited = fields.createTextField('limited');
  limited.addToPage(page, at(530));
  limited.setMaxLength(10);

  const comb = fields.createTextField('comb');
  comb.addToPage(page, at(500));
  comb.setMaxLength(6);
  comb.enableCombing();

  const secret = fields.createTextField('secret');
  secret.addToPage(page, at(470));
  secret.enablePassword();

  const several = fields.createOptionList('several');
  several.addOptions(['a', 'b', 'c']);
  several.enableMultiselect();
  several.addToPage(page, { x: 50, y: 380, width: 200, height: 60, font });

  const typed = fields.createDropdown('typed');
  typed.addOptions(['x', 'y']);
  typed.enableEditing();
  typed.addToPage(page, at(340));

  const price = fields.createTextField('price');
  price.addToPage(page, at(300));
  const total = fields.createTextField('total');
  total.addToPage(page, at(270));

  // A FORMAT AND A CALCULATION AS ADR-0193 WRITES THEM, through the one module that holds their grammar.
  const scripts = formatScripts({ kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus' });
  const action = (js: string) => document.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of(js) });
  price.acroField.dict.set(PDFName.of('AA'), document.context.obj({ F: action(scripts.format), K: action(scripts.keystroke) }));
  total.acroField.dict.set(PDFName.of('AA'), document.context.obj({ C: action(calculationScript({ operation: 'sum', fields: ['price'] })) }));
  // A SCRIPT THAT IS NOT OURS: calculated, and read as no format of ours.
  const custom = fields.createTextField('custom');
  custom.addToPage(page, at(240));
  custom.acroField.dict.set(PDFName.of('AA'), document.context.obj({ C: action('event.value = 42;') }));
  custom.acroField.dict.set(PDFName.of('Q'), PDFNumber.of(0));
  // A KEYSTROKE FILTER THAT IS NOT A STANDARD PARTNER, beside a standard format: only the keystroke is not run.
  const filtered = fields.createTextField('filtered');
  filtered.addToPage(page, at(210));
  filtered.acroField.dict.set(PDFName.of('AA'), document.context.obj({ F: action(scripts.format), K: action('if (event.change > 5) event.rc = false;') }));
  // A BUTTON WHOSE PRESS RUNS A SCRIPT, chained behind a reset, and one that only resets: the reset is no script.
  const press = fields.createButton('press');
  press.addToPage('Go', page, at(180));
  const reset = document.context.obj({ S: PDFName.of('ResetForm') });
  reset.set(PDFName.of('Next'), action('app.alert("hi");'));
  press.acroField.getWidgets()[0]?.dict.set(PDFName.of('A'), reset);
  // A CALCULATION ON THE FIELD and a focus script on its WIDGET'S own /AA: read nearest-first from the widget, the
  // widget's /AA hid the field's, and the field read as not calculated.
  const both = fields.createTextField('both');
  both.addToPage(page, at(120));
  both.acroField.dict.set(PDFName.of('AA'), document.context.obj({ C: action('event.value = 7;') }));
  both.acroField.getWidgets()[0]?.dict.set(PDFName.of('AA'), document.context.obj({ Fo: action('app.beep(0);') }));
  const clear = fields.createButton('clear');
  clear.addToPage('Clear', page, at(150));
  clear.acroField.getWidgets()[0]?.dict.set(PDFName.of('A'), document.context.obj({ S: PDFName.of('ResetForm') }));
  return document.save();
}

async function listed(): Promise<ReadonlyMap<string, ListedField>> {
  const session = await mupdfWriter.open(await form());
  const { fields } = await readFormFields(session);
  return new Map(fields.map((field) => [field.name, field]));
}

describe('the field list carries what filling needs', () => {
  it('reads each rule on the field that has it and on no other', async () => {
    const byName = await listed();
    const only = (rule: keyof ListedField, name: string, value: unknown, off: unknown): void => {
      for (const [other, field] of byName) expect(field[rule], `${rule} on ${other}`).toStrictEqual(other === name ? value : off);
    };
    only('required', 'required', true, false);
    only('comb', 'comb', true, false);
    only('masked', 'secret', true, false);
    only('multiSelect', 'several', true, false);
    only('editable', 'typed', true, false);
    expect(byName.get('limited')?.maxLength).toBe(10);
    expect(byName.get('comb')?.maxLength).toBe(6);
    expect(byName.get('required')?.maxLength).toBeNull();
  });

  it('reads a format of ours as data, and a calculation of ours or a script as calculated', async () => {
    const byName = await listed();
    expect(byName.get('price')?.format).toMatchObject({ kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus' });
    expect(byName.get('total')?.calculated).toBe(true);
    expect(byName.get('custom')?.calculated).toBe(true);
    expect(byName.get('custom')?.format).toBeNull();
    expect(byName.get('price')?.calculated).toBe(false);
  });

  it('names the scripts a field carries that are never run, and no standard call (the owner’s decision of 2026-10-18)', async () => {
    const byName = await listed();
    const scripts = Object.fromEntries([...byName].map(([name, field]) => [name, field.scripts ?? []]));
    expect(scripts).toStrictEqual({
      required: [],
      limited: [],
      comb: [],
      secret: [],
      several: [],
      typed: [],
      // CONTROLS: a standard format with its keystroke partner, and AFSimple_Calculate, are data that works.
      price: [],
      total: [],
      custom: ['calculation'],
      filtered: ['keystroke'],
      // A SCRIPT CHAINED BEHIND A RESET is still run by a reader that runs scripts; a reset alone is not one.
      press: ['action'],
      both: ['calculation', 'action'],
      clear: [],
    });
    // THE FIELD'S VALUE SCRIPTS read from the field, whatever its widget's own /AA holds.
    expect(byName.get('both')?.calculated).toBe(true);
  });
});
