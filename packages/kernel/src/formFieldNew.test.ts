import { PDFDocument } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { applyCreateFormField } from './formFieldCreate.js';
import { readFormFields } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * What a NEW field is, read back by the real MuPDF and drawn by it (A2.2, A2.4, K5): the owner saw a new tick box drawn
 * already ticked and a new radio already filled. A new one must be off, drawn with its border, and show no mark.
 */
async function blank(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([400, 400]);
  return document.save();
}

/** One command per field, because only the plain kinds may share a command (`createFormField`'s two shapes). */
async function created(fields: readonly CommandOfKind<'createFormField'>['fields'][number][]): Promise<Uint8Array> {
  let bytes = await blank();
  for (const field of fields) bytes = await applyCreateFormField(bytes, { kind: 'createFormField', page: 0, fields: [field] });
  return bytes;
}

/** The darkest pixels inside a rectangle of the page as MuPDF draws it at 4x, the border's inset left out. */
function inkInside(bytes: Uint8Array, rect: { x0: number; y0: number; x1: number; y1: number }, round = false): number {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf') as mupdf.PDFDocument;
  const page = document.loadPage(0);
  const scale = 4;
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
  const width = pixmap.getWidth();
  const pixels = pixmap.getPixels();
  // A POINT AND A HALF IN from every edge: the 1 pt border is four pixels wide at this scale and stays outside the count.
  const inset = 6;
  // A RADIO IS A CIRCLE: its outline crosses the corners of a square inset, so a round one is counted inside the circle.
  const cx = ((rect.x0 + rect.x1) / 2) * scale;
  const cy = (400 - (rect.y0 + rect.y1) / 2) * scale;
  const radius = ((rect.x1 - rect.x0) / 2) * scale - inset;
  let dark = 0;
  for (let y = Math.round((400 - rect.y1) * scale) + inset; y < Math.round((400 - rect.y0) * scale) - inset; y += 1) {
    for (let x = Math.round(rect.x0 * scale) + inset; x < Math.round(rect.x1 * scale) - inset; x += 1) {
      if (round && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
      if ((pixels[y * width + x] ?? 255) < 128) dark += 1;
    }
  }
  return dark;
}

describe('a new button, signature field and date field (ADR-0226 Decision 13)', () => {
  const button = { x0: 40, y0: 300, x1: 120, y1: 324 };
  const signature = { x0: 40, y0: 200, x1: 220, y1: 240 };
  const date = { x0: 40, y0: 100, x1: 140, y1: 120 };

  it('are the kinds they were made as, read by MuPDF and by pdf-lib, and the date one carries its format', async () => {
    const bytes = await created([
      { rect: button, name: 'Button1', field: { type: 'button', label: 'Send' } },
      { rect: signature, name: 'Signature1', field: { type: 'signature' } },
      { rect: date, name: 'Date1', field: { type: 'date', pattern: 'dd/mm/yyyy' } },
    ]);
    const session = await mupdfWriter.open(bytes);
    try {
      const { fields } = await readFormFields(session);
      expect(fields.map((field) => [field.name, field.kind])).toStrictEqual([
        ['Button1', 'button'],
        ['Signature1', 'signature'],
        ['Date1', 'text'],
      ]);
      expect(fields[2]?.format).toStrictEqual({ kind: 'date', pattern: 'dd/mm/yyyy' });
      expect(fields[0]?.format).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
    const second = (await PDFDocument.load(bytes)).getForm();
    expect(second.getButton('Button1').getName()).toBe('Button1');
    expect(second.getSignature('Signature1').getName()).toBe('Signature1');
    expect(second.getTextField('Date1').getText()).toBeUndefined();
  });

  it('the button is drawn with its words, as MuPDF renders the page', async () => {
    const bytes = await created([{ rect: button, name: 'Button1', field: { type: 'button', label: 'Send' } }]);
    expect(inkInside(bytes, button)).toBeGreaterThan(0);
  });

  it('CONTROL: a button with no words is drawn with nothing inside, so the count above is the words', async () => {
    const bytes = await created([{ rect: button, name: 'Button1', field: { type: 'button', label: ' ' } }]);
    expect(inkInside(bytes, button)).toBe(0);
  });

  // MUPDF DRAWS ITS OWN PICTURE OF AN UNSIGNED SIGNATURE FIELD and ignores the stored one: `pdf-appearance.c` 1.28.0
  // treats an appearance it did not make on an unsigned `/Sig` widget as a local synthesis ("They are often blank and we
  // want the 'sign' arrow to be visible"). So MuPDF's raster cannot see the border; PDF.js, which this application draws
  // pages with, takes the stored appearance like any widget's. The stored stream is read here through MuPDF's object
  // reader, which is the second reader of what pdf-lib wrote.
  it('the signature field stores a white box with a stroked border, sized to its rectangle', async () => {
    const bytes = await created([{ rect: signature, name: 'Signature1', field: { type: 'signature' } }]);
    const appearance = storedAppearance(bytes);
    // Half a point in from each side: every created field is inset by half its border, `insetForBorder`'s reason.
    expect(appearance.box).toStrictEqual([0, 0, 179, 39]);
    expect(appearance.drawing).toMatch(/ 1 1 1 rg 0 0 179 39 re f /u);
    expect(appearance.drawing).toMatch(/ re S /u);
  });

  it('CONTROL: a text field’s stored appearance strokes no border, so the match above is the signature’s own', async () => {
    const bytes = await created([{ rect: signature, name: 'Text1', field: { type: 'text' } }]);
    expect(storedAppearance(bytes).drawing).not.toMatch(/ re S /u);
  });
});

/** The first widget's stored normal appearance, read by MuPDF's object reader: its box and its drawing. */
function storedAppearance(bytes: Uint8Array): { box: number[]; drawing: string } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf') as mupdf.PDFDocument;
  const widget = document.loadPage(0).getWidgets()[0];
  if (widget === undefined) throw new Error('The page holds no widget, so there is no appearance to read.');
  const normal = widget.getObject().get('AP').get('N');
  const bbox = normal.get('BBox');
  const box = [0, 1, 2, 3].map((index) => bbox.get(index).asNumber());
  return { box, drawing: ` ${normal.readStream().asString()} ` };
}

describe('a new tick box and a new radio', () => {
  const box = { x0: 50, y0: 300, x1: 62, y1: 312 };
  const radio = { x0: 100, y0: 300, x1: 112, y1: 312 };

  it('are off, as MuPDF reads them, and show no mark inside their border', async () => {
    const bytes = await created([
      { rect: box, name: 'Check Box1', field: { type: 'checkbox' } },
      { rect: radio, name: 'Group1', field: { type: 'radio', option: 'Choice1' } },
    ]);
    const session = await mupdfWriter.open(bytes);
    try {
      const { fields } = await readFormFields(session);
      expect(fields.map((field) => [field.name, field.on])).toStrictEqual([
        ['Check Box1', false],
        ['Group1', false],
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
    expect(inkInside(bytes, box)).toBe(0);
    expect(inkInside(bytes, radio, true)).toBe(0);
  });

  it('CONTROL: a ticked box and a chosen radio do show a mark, so the count can see one', async () => {
    const bytes = await created([
      { rect: box, name: 'Check Box1', field: { type: 'checkbox' } },
      { rect: radio, name: 'Group1', field: { type: 'radio', option: 'Choice1' } },
    ]);
    const document = await PDFDocument.load(bytes);
    document.getForm().getCheckBox('Check Box1').check();
    document.getForm().getRadioGroup('Group1').select('Choice1');
    const ticked = await document.save();
    expect(inkInside(ticked, box)).toBeGreaterThan(0);
    expect(inkInside(ticked, radio, true)).toBeGreaterThan(0);
  });
});
