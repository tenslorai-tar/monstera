import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, CreatedField } from '@monstera/contract';

import { applyCreateFormField } from './formFieldCreate.js';
import { applyFillFormField } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * What a person sees of a field the moment it is drawn, and after the document is saved and opened again.
 *
 * ## The mechanism these prove
 *
 * A field was created with a border of 0 and no colours, so pdf-lib wrote an appearance that paints nothing: the field
 * was in the document, listed in the Forms panel, and invisible on the page. Each case reads PIXELS of the page MuPDF
 * renders (a different library from the writer), inside the rectangle the field was drawn in.
 *
 * ## The control
 *
 * {@link oldWay} builds a field exactly as the command used to: a border of 0 and no colours. Its ink is asserted to
 * be zero, so a proof that passed for any field whatever would fail here, and the instrument is shown able to see
 * both a visible and an invisible field.
 */
const PAGE = { width: 400, height: 600 } as const;

const BOX = { x0: 100, y0: 300, x1: 220, y1: 324 } as const;
const SQUARE = { x0: 100, y0: 300, x1: 120, y1: 320 } as const;
const LIST = { x0: 100, y0: 300, x1: 220, y1: 380 } as const;

async function blankPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([PAGE.width, PAGE.height]);
  return document.save();
}

/** Dark pixels of page 0 inside a PDF-space box, and the same read of just its four corner pixels. */
function readInk(
  bytes: Uint8Array,
  box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): { readonly inside: number; readonly corners: number } {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pixmap = opened.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const pixels = pixmap.getPixels();
  const width = pixmap.getWidth();
  const dark = (x: number, y: number): boolean => {
    const at = (y * width + x) * 3;
    return (pixels[at] ?? 255) + (pixels[at + 1] ?? 255) + (pixels[at + 2] ?? 255) < 600;
  };
  const top = Math.floor(PAGE.height - box.y1);
  const bottom = Math.ceil(PAGE.height - box.y0);
  const left = Math.floor(box.x0);
  const right = Math.ceil(box.x1);
  let inside = 0;
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) if (dark(x, y)) inside += 1;
  const corners = [
    [left, top],
    [right - 1, top],
    [left, bottom - 1],
    [right - 1, bottom - 1],
  ].filter(([x = 0, y = 0]) => dark(x, y)).length;
  pixmap.destroy();
  return { inside, corners };
}

function creating(
  name: string,
  field: CreatedField,
  rect: { x0: number; y0: number; x1: number; y1: number },
): CommandOfKind<'createFormField'> {
  return { kind: 'createFormField', page: 0, fields: [{ rect, name, field }] };
}

/** The field exactly as the command made it before: no border, no colours. */
async function oldWay(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.getForm().createTextField('old').addToPage(page, { x: 100, y: 300, width: 120, height: 24, borderWidth: 0, font });
  return document.save();
}

async function throughMupdf(bytes: Uint8Array): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a new form field is visible', () => {
  it('CONTROL: a field made the old way, with no border and no colours, draws nothing', async () => {
    expect(readInk(await oldWay(), BOX).inside).toBe(0);
  });

  const kinds: readonly (readonly [string, CreatedField, { x0: number; y0: number; x1: number; y1: number }])[] = [
    ['a text field', { type: 'text' }, BOX],
    ['a tick box', { type: 'checkbox' }, SQUARE],
    ['a radio button', { type: 'radio', option: 'a' }, SQUARE],
    ['a dropdown', { type: 'dropdown', options: ['x', 'y'] }, BOX],
    ['a list box', { type: 'listbox', options: ['x', 'y', 'z'] }, LIST],
  ];

  for (const [words, field, rect] of kinds) {
    it(`${words} draws a border the moment it is created, and after a save and an open`, async () => {
      const created = await applyCreateFormField(await blankPage(), creating('f', field, rect));
      expect(readInk(created, rect).inside, 'ink when created').toBeGreaterThan(40);
      const reopened = await throughMupdf(created);
      expect(readInk(reopened, rect).inside, 'ink after a save and an open').toBeGreaterThan(40);
    });
  }

  it('a list box is a BOX: its left edge is a dark column over the whole of its height', async () => {
    const created = await applyCreateFormField(await blankPage(), creating('f', { type: 'listbox', options: ['3', '4'] }, LIST));
    const opened = mupdf.Document.openDocument(created, 'application/pdf');
    const pixmap = opened.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
    const pixels = pixmap.getPixels();
    const width = pixmap.getWidth();
    let dark = 0;
    for (let y = PAGE.height - LIST.y1 + 2; y < PAGE.height - LIST.y0 - 2; y += 1) {
      for (let x = LIST.x0 - 1; x <= LIST.x0 + 1; x += 1) {
        if ((pixels[(y * width + x) * 3] ?? 255) < 160) {
          dark += 1;
          break;
        }
      }
    }
    expect(dark).toBeGreaterThanOrEqual(LIST.y1 - LIST.y0 - 6);
    pixmap.destroy();
  });

  it('a radio button is a circle and a tick box is a square: only the square reaches the corners of its box', async () => {
    const radio = await applyCreateFormField(await blankPage(), creating('r', { type: 'radio', option: 'a' }, SQUARE));
    const box = await applyCreateFormField(await blankPage(), creating('c', { type: 'checkbox' }, SQUARE));
    expect(readInk(radio, SQUARE).corners).toBe(0);
    expect(readInk(box, SQUARE).corners).toBeGreaterThan(0);
  });

  it('the rectangle is still the one that was drawn: the border does not move the box', async () => {
    const created = await applyCreateFormField(await blankPage(), creating('f', { type: 'text' }, BOX));
    const document = await PDFDocument.load(created);
    const [widget] = document.getForm().getTextField('f').acroField.getWidgets();
    const rect = widget?.getRectangle();
    expect([rect?.x, rect?.y, rect?.width, rect?.height]).toStrictEqual([100, 300, 120, 24]);
  });

  it('a value filled afterwards keeps the border: MuPDF regenerates the appearance from the same colours', async () => {
    const created = await applyCreateFormField(await blankPage(), creating('f', { type: 'text' }, BOX));
    const session = await mupdfWriter.open(created);
    try {
      await applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: 'Hello' } } as never);
      const filled = await mupdfWriter.serialise(session);
      const edge = readInk(filled, { x0: 100, y0: 300, x1: 102, y1: 324 });
      expect(edge.inside).toBeGreaterThan(20);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
