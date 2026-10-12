import { PDFDocument as LibDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { asDocVersion } from '@monstera/shared';

import { applySanitizeDocument } from './documentSanitize.js';
import { applyFillFormField, applyFlattenFormFields } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * A password field's value is never in its appearance: what a flatten burns into the page is what the field shows, masked.
 *
 * MuPDF 1.28.0 draws a text field's appearance from its value and never reads the password flag (`pdf-appearance.c` has no
 * branch on `PDF_TX_FIELD_IS_PASSWORD`; the flag's only uses in the source are `pdfshow` and `murun`), so a PIN drawn by the
 * engine is in the stream as digits and the bake puts those digits on the page. The control fills a field that is NOT a
 * password the same way and must find its digits, so the reading is shown able to see a value in the page's text.
 */

const PIN = '4821';

async function formWith(password: boolean): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([300, 200]);
  const field = document.getForm().createTextField('pin');
  if (password) field.enablePassword();
  field.addToPage(page, { x: 40, y: 100, width: 160, height: 24 });
  return document.save();
}

/** The words a page's own content and its widgets' appearances carry, read with widgets drawn. */
function pageText(bytes: Uint8Array): string {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  const text = opened.loadPage(0).toStructuredText('preserve-whitespace').asText();
  opened.destroy();
  return text;
}

/** The normal appearance stream of the one widget on page 0. */
async function appearanceOf(session: Awaited<ReturnType<typeof mupdfWriter.open>>): Promise<string> {
  return withDocument(session, (document) => {
    const widget = document.loadPage(0).getWidgets()[0];
    if (widget === undefined) throw new Error('the fixture has no widget');
    const normal = widget.getObject().get('AP', 'N');
    return normal.isStream() ? normal.readStream().asString() : '';
  });
}

async function filledAndFlattened(password: boolean): Promise<{ readonly appearance: string; readonly flattened: string }> {
  const session = await mupdfWriter.open(await formWith(password));
  try {
    await applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, value: { set: 'text', text: PIN }, version: asDocVersion(1) });
    const appearance = await appearanceOf(session);
    await applyFlattenFormFields(session, { kind: 'flattenFormFields', fields: 'all', version: asDocVersion(1) });
    return { appearance, flattened: pageText(await mupdfWriter.serialise(session)) };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a password field shows its value masked, in its appearance and once flattened', () => {
  it('CONTROL: an ordinary text field filled the same way has its digits on the flattened page', async () => {
    const { flattened } = await filledAndFlattened(false);
    expect(flattened).toContain(PIN);
  });

  it('a filled password field draws no digit into its appearance', async () => {
    const { appearance } = await filledAndFlattened(true);
    expect(appearance).not.toContain(PIN);
    expect(appearance).toContain('****');
  });

  it('a flattened password field shows the mask, never the digits', async () => {
    const { flattened } = await filledAndFlattened(true);
    expect(flattened).not.toContain(PIN);
    expect(flattened).toContain('****');
  });

  /** A form another writer filled and drew, never touched here: the appearance the file arrives with is the one a bake keeps. */
  async function drawnElsewhere(): Promise<Uint8Array> {
    const document = await LibDocument.create();
    const page = document.addPage([300, 200]);
    const field = document.getForm().createTextField('pin');
    field.enablePassword();
    field.setText(PIN);
    field.addToPage(page, { x: 40, y: 100, width: 160, height: 24 });
    return document.save({ updateFieldAppearances: false });
  }

  /** An appearance holding the value in clear, as some writers draw a password field. */
  async function clearAppearance(): Promise<Uint8Array> {
    const session = await mupdfWriter.open(await drawnElsewhere());
    try {
      await withDocument(session, (document) => {
        const widget = document.loadPage(0).getWidgets()[0];
        if (widget === undefined) throw new Error('the fixture has no widget');
        const stream = document.addStream(`/Tx BMC\nBT /Helv 12 Tf 2 6 Td (${PIN}) Tj ET\nEMC\n`, document.newDictionary());
        const box = document.newArray();
        for (const each of [0, 0, 160, 24]) box.push(each);
        stream.put('BBox', box);
        const font = document.newDictionary();
        font.put('Type', document.newName('Font'));
        font.put('Subtype', document.newName('Type1'));
        font.put('BaseFont', document.newName('Helvetica'));
        const fonts = document.newDictionary();
        fonts.put('Helv', font);
        const resources = document.newDictionary();
        resources.put('Font', fonts);
        stream.put('Resources', resources);
        const appearance = document.newDictionary();
        appearance.put('N', stream);
        widget.getObject().put('AP', appearance);
      });
      return await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
  }

  it('CONTROL: the clear appearance the next three cases start from carries the digits', async () => {
    const session = await mupdfWriter.open(await clearAppearance());
    try {
      expect(await appearanceOf(session)).toContain(`(${PIN})`);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a password field another writer drew in clear is masked once flattened', async () => {
    const session = await mupdfWriter.open(await clearAppearance());
    try {
      await applyFlattenFormFields(session, { kind: 'flattenFormFields', fields: 'all', version: asDocVersion(1) });
      const flattened = pageText(await mupdfWriter.serialise(session));
      expect(flattened).not.toContain(PIN);
      expect(flattened).toContain('****');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a password field flattened with only itself chosen is masked too', async () => {
    const session = await mupdfWriter.open(await clearAppearance());
    try {
      await applyFlattenFormFields(session, { kind: 'flattenFormFields', fields: [{ page: 0, index: 0 }], version: asDocVersion(1) });
      const flattened = pageText(await mupdfWriter.serialise(session));
      expect(flattened).not.toContain(PIN);
      expect(flattened).toContain('****');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a password field the sanitize flatten bakes is masked', async () => {
    const session = await mupdfWriter.open(await clearAppearance());
    try {
      await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['flatten'] });
      const flattened = pageText(await mupdfWriter.serialise(session));
      expect(flattened).not.toContain(PIN);
      expect(flattened).toContain('****');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
