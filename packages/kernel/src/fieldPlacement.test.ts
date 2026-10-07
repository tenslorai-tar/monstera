import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFPage, degrees } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { asDocVersion } from '@monstera/shared';

import { type PageFrame, placeOnPage, rotationOf } from './fieldPlacement.js';
import { applyDuplicateFormField } from './formFieldEdit.js';
import { readFormFields } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * A field copied onto a page of another size lands at the same PLACE, not the same numbers.
 *
 * ## The control
 *
 * Every integration case first asserts the numbers a copy used to be given, the source's own, are OUTSIDE or visibly
 * displaced on the target page, so a copy placed by raw numbers fails: the fixture separates the two behaviours.
 */

const A4: PageFrame = { x: 0, y: 0, width: 595.28, height: 841.89, rotation: 0 };
const LETTER: PageFrame = { x: 0, y: 0, width: 612, height: 792, rotation: 0 };
const SMALL: PageFrame = { x: 0, y: 0, width: 300, height: 400, rotation: 0 };

/** Where the rectangle's centre sits, as a fraction across and down the page seen from its top left. */
function centreOf(rect: { x0: number; y0: number; x1: number; y1: number }, frame: PageFrame): { across: number; down: number } {
  return {
    across: ((rect.x0 + rect.x1) / 2 - frame.x) / frame.width,
    down: 1 - ((rect.y0 + rect.y1) / 2 - frame.y) / frame.height,
  };
}

const FIELD = { x0: 400, y0: 700, x1: 520, y1: 724 };

describe('placeOnPage', () => {
  it('keeps the size in points and the centre at the same fraction from A4 to Letter', () => {
    const placed = placeOnPage(FIELD, A4, LETTER);
    expect(placed.x1 - placed.x0).toBeCloseTo(120, 6);
    expect(placed.y1 - placed.y0).toBeCloseTo(24, 6);
    const was = centreOf(FIELD, A4);
    const now = centreOf(placed, LETTER);
    expect(now.across).toBeCloseTo(was.across, 6);
    expect(now.down).toBeCloseTo(was.down, 6);
    expect(placed, 'CONTROL: it is not where the same numbers would be').not.toStrictEqual(FIELD);
  });

  it('puts the copy on a smaller page inside it, where the same numbers were past its edge', () => {
    expect(FIELD.x0, 'CONTROL: the same numbers are past the small page\'s right edge').toBeGreaterThan(SMALL.width);
    expect(FIELD.y1, 'CONTROL: and past its top').toBeGreaterThan(SMALL.height);
    const placed = placeOnPage(FIELD, A4, SMALL);
    expect(placed.x0).toBeGreaterThanOrEqual(0);
    expect(placed.y0).toBeGreaterThanOrEqual(0);
    expect(placed.x1).toBeLessThanOrEqual(SMALL.width);
    expect(placed.y1).toBeLessThanOrEqual(SMALL.height);
    expect(placed.x1 - placed.x0, 'a field that fits keeps its size').toBeCloseTo(120, 6);
  });

  it('cuts a field larger than the page to the page and never refuses where it lands', () => {
    const wide = placeOnPage({ x0: 10, y0: 10, x1: 590, y1: 40 }, A4, SMALL);
    expect(wide.x0).toBeCloseTo(0, 6);
    expect(wide.x1).toBeCloseTo(300, 6);
  });

  it('reads the fraction in the page as it is SEEN, so a turned page and an upright one agree', () => {
    const turned: PageFrame = { x: 0, y: 0, width: 612, height: 792, rotation: 90 };
    const placed = placeOnPage(FIELD, A4, turned);
    // Seen from the top left of a page turned a quarter clockwise, the visible width is the box's height.
    const was = centreOf(FIELD, A4);
    const across = ((placed.y0 + placed.y1) / 2) / turned.height;
    const down = ((placed.x0 + placed.x1) / 2) / turned.width;
    expect(across).toBeCloseTo(was.across, 6);
    expect(down).toBeCloseTo(was.down, 6);
    expect(placed.x1 - placed.x0, 'the field keeps its look, so its sides swap with the turn').toBeCloseTo(24, 6);
    expect(placed.y1 - placed.y0).toBeCloseTo(120, 6);
  });

  it('honours the crop box origin: the fraction is of the box a viewer shows', () => {
    const offset: PageFrame = { x: 50, y: 60, width: 300, height: 400, rotation: 0 };
    const placed = placeOnPage({ x0: 100, y0: 100, x1: 130, y1: 120 }, SMALL, offset);
    expect(placed.x0).toBeGreaterThanOrEqual(50);
    expect(placed.y0).toBeGreaterThanOrEqual(60);
    const was = centreOf({ x0: 100, y0: 100, x1: 130, y1: 120 }, SMALL);
    const now = centreOf(placed, offset);
    expect(now.across).toBeCloseTo(was.across, 6);
    expect(now.down).toBeCloseTo(was.down, 6);
  });

  it('answers the rectangle as it is for a page with no area, and rounds a rotation the file wrote oddly', () => {
    expect(placeOnPage(FIELD, A4, { ...SMALL, width: 0 })).toStrictEqual(FIELD);
    expect([rotationOf(-90), rotationOf(450), rotationOf(45), rotationOf(180), rotationOf(Number.NaN)]).toStrictEqual([270, 90, 90, 180, 0]);
  });
});

/** A document of an A4 page holding a text field, then a Letter page, a small page and a page turned a quarter. */
async function mixedPages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const first = document.addPage([A4.width, A4.height]);
  document.addPage([LETTER.width, LETTER.height]);
  document.addPage([SMALL.width, SMALL.height]);
  const turned = document.addPage([LETTER.width, LETTER.height]);
  turned.setRotation(degrees(90));
  const field = document.getForm().createTextField('note');
  field.addToPage(first, { x: FIELD.x0, y: FIELD.y0, width: FIELD.x1 - FIELD.x0, height: FIELD.y1 - FIELD.y0 });
  return document.save({ updateFieldAppearances: false });
}

async function rectsOfCopies(bytes: Uint8Array): Promise<Map<number, { x0: number; y0: number; x1: number; y1: number }>> {
  const document = await PDFDocument.load(bytes);
  const found = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  document.getPages().forEach((page: PDFPage, at: number) => {
    for (const annot of page.node.Annots()?.asArray() ?? []) {
      const dict = document.context.lookup(annot, PDFDict);
      const rect = dict.lookup(PDFName.of('Rect'), PDFArray).asArray().map((entry) => document.context.lookup(entry, PDFNumber).asNumber());
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
      found.set(at, { x0, y0, x1, y1 });
    }
  });
  return found;
}

describe('copying a field across pages of different sizes', () => {
  it('lands each copy at the same place on a Letter page, a smaller page and a turned page, and survives a save and an open', async () => {
    const original = await mixedPages();
    const session = await mupdfWriter.open(original);
    let handle;
    try {
      const { fields } = await readFormFields(session);
      const found = fields.find((each) => each.name === 'note');
      if (found === undefined) throw new Error('no field');
      handle = { page: found.page, index: found.index, name: 'note' };
    } finally {
      await mupdfWriter.close(session);
    }
    const copied = await applyDuplicateFormField(original, { kind: 'duplicateFormField', field: handle, pages: [1, 2, 3], version: asDocVersion(1) });
    const reopened = await (async () => {
      const again = await mupdfWriter.open(copied);
      try {
        return await mupdfWriter.serialise(again);
      } finally {
        await mupdfWriter.close(again);
      }
    })();
    for (const bytes of [copied, reopened]) {
      const rects = await rectsOfCopies(bytes);
      const was = centreOf(FIELD, A4);
      const letter = rects.get(1);
      const small = rects.get(2);
      const turned = rects.get(3);
      if (letter === undefined || small === undefined || turned === undefined) throw new Error('a copy is missing');
      expect(centreOf(letter, LETTER).across).toBeCloseTo(was.across, 4);
      expect(centreOf(letter, LETTER).down).toBeCloseTo(was.down, 4);
      expect(small.x1, 'on the small page it is inside').toBeLessThanOrEqual(SMALL.width + 1e-6);
      expect(small.y1).toBeLessThanOrEqual(SMALL.height + 1e-6);
      expect(small.x0).toBeGreaterThanOrEqual(0);
      // The turned page: its visible width is the box's height.
      expect(((turned.y0 + turned.y1) / 2) / LETTER.height).toBeCloseTo(was.across, 4);
      expect(((turned.x0 + turned.x1) / 2) / LETTER.width).toBeCloseTo(was.down, 4);
    }
    // The page also opens in the engine with the copies on it, so the numbers are a field a reader can see.
    const opened = mupdf.Document.openDocument(copied, 'application/pdf');
    if (!(opened instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    expect(opened.loadPage(2).getWidgets().length).toBe(1);
  });
});
