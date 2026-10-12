import { PDFDocument as LibDocument, PDFName, type PDFRef, PDFString } from '@cantoo/pdf-lib';
import { asDocVersion } from '@monstera/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyCreateFormField } from './formFieldCreate.js';
import { applyEditFormFields } from './formFieldEdit.js';
import { readFieldProperties } from './formFieldRead.js';
import { applyFillFormField, applyFlattenFormFields, readFormFields } from './formFields.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * A form with thousands of fields is never refused for its size (A1.11): it is listed whole, and every command a person
 * runs on one field — fill, change, add, flatten — runs on the last field of it as on the first field of a small one.
 *
 * ## The control
 *
 * The same form read with a bound below its size is answered with the fields that fit AND `truncated`, never a refusal:
 * so the whole list below is the bound being high enough, not a reader that cannot stop. (The bound itself, 33,200 fields
 * across the host's wire, is `engineChannels.test.ts`' and `proof:hostfileanswers`'.)
 */

const PAGES = 10;
const PER_PAGE = 200;
const VERSION = asDocVersion(1);
const LAST = { page: PAGES - 1, index: PER_PAGE - 1, name: `f${String(PAGES - 1)}_${String(PER_PAGE - 1)}` } as const;

/**
 * `PAGES` pages of `PER_PAGE` small text fields each, in a grid, as merged field-and-widget dictionaries written directly:
 * pdf-lib's `createTextField` checks each new name against every field already made, which took 12 s of a 15 s run for
 * this fixture (measured 2026-10-12), and the commands under test draw what they change.
 */
async function manyFields(): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const { context } = document;
  const fields: PDFRef[] = [];
  for (let page = 0; page < PAGES; page += 1) {
    const added = document.addPage([600, 800]);
    const annots: PDFRef[] = [];
    for (let index = 0; index < PER_PAGE; index += 1) {
      const x = 20 + (index % 10) * 56;
      const y = 760 - Math.floor(index / 10) * 37;
      const widget = context.register(
        context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          FT: 'Tx',
          T: PDFString.of(`f${String(page)}_${String(index)}`),
          Rect: [x, y, x + 52, y + 30],
          DA: PDFString.of('/Helv 0 Tf 0 g'),
          F: 4,
          P: added.ref,
        }),
      );
      annots.push(widget);
      fields.push(widget);
    }
    added.node.set(PDFName.of('Annots'), context.obj(annots));
  }
  const helvetica = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  document.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: fields, DA: PDFString.of('/Helv 0 Tf 0 g'), DR: { Font: { Helv: helvetica } } }));
  return document.save();
}

describe(`a form of ${String(PAGES * PER_PAGE)} fields is never refused for its size (A1.11)`, () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    bytes = await manyFields();
  });

  it('lists every field, and CONTROL: a lower bound answers the fields that fit and says it stopped', async () => {
    const session = await mupdfWriter.open(bytes);
    try {
      const whole = await readFormFields(session);
      expect(whole.truncated).toBe(false);
      expect(whole.fields).toHaveLength(PAGES * PER_PAGE);
      expect(whole.fields.at(-1)?.name).toBe(LAST.name);
      const part = await readFormFields(session, 500);
      expect(part.truncated).toBe(true);
      expect(part.fields).toHaveLength(500);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('fills, changes and adds beside the last field, and flattens the whole form', async () => {
    const changed = await applyEditFormFields(bytes, { kind: 'editFormFields', edits: [{ field: LAST, set: { fontSize: 9, required: true } }], version: VERSION });
    const added = await applyCreateFormField(changed, {
      kind: 'createFormField',
      page: LAST.page,
      fields: [{ rect: { x0: 20, y0: 20, x1: 40, y1: 40 }, name: 'one_more', field: { type: 'checkbox' } }],
    });
    const session = await mupdfWriter.open(added);
    try {
      await applyFillFormField(session, { kind: 'fillFormField', page: LAST.page, index: LAST.index, version: VERSION, value: { set: 'text', text: 'the last one' } });
      const { fields } = await readFormFields(session);
      expect(fields).toHaveLength(PAGES * PER_PAGE + 1);
      expect(fields.find((field) => field.name === LAST.name)?.values).toStrictEqual(['the last one']);
      const [read] = await readFieldProperties(session, [LAST]);
      expect(read?.fontSize).toBe(9);
      expect(read?.required).toBe(true);
      await applyFlattenFormFields(session, { kind: 'flattenFormFields', fields: 'all', version: VERSION });
      const flat = await mupdfWriter.serialise(session);
      const again = await mupdfWriter.open(flat);
      try {
        await withDocument(again, (document) => {
          const page = document.loadPage(LAST.page);
          expect(page.getWidgets()).toHaveLength(0);
          expect(page.toStructuredText('preserve-whitespace').asText()).toContain('the last one');
        });
      } finally {
        await mupdfWriter.close(again);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
