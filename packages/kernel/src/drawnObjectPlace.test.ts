import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFArray, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DrawnObjectRefusedError, applyPlaceDrawnObject, placementIn, wrappedContent } from './drawnObjectPlace.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { type DrawnObject, drawnObjects, joinedContent, multiply, showOperators } from './textOperators.js';

/**
 * ADR-0240: a picture or a shape moved where it is drawn, on the page shape of the owner's E1 — Chromium's print of
 * Type 3 headings beside text, with a photo and a logo path added. PDFium's route lost 17 of 85 text objects on such a
 * page (`proof:drawnobjects` holds that control against PDFium itself); here MuPDF reads the page back after the move.
 */

const CHROMIUM = fileURLToPath(new URL('../../testing/fixtures/text-edit/chromium-type3.pdf', import.meta.url));

/** The print with a 120 by 90 photo at (300, 400) and a red triangle, the logo, drawn after its text. */
async function magazine(): Promise<Uint8Array> {
  const document = await PDFDocument.load(readFileSync(CHROMIUM), { updateMetadata: false });
  const page = document.getPage(0);
  const photo = document.context.stream(Uint8Array.of(10, 200, 30, 90), {
    Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  page.node.setXObject(PDFName.of('MonPhoto'), document.context.register(photo));
  const drawn = document.context.register(
    document.context.flateStream('q 120 0 0 90 300 400 cm /MonPhoto Do Q\nq 1 0 0 rg 300 300 m 350 350 l 400 300 l h f Q'),
  );
  const contents = page.node.get(PDFName.of('Contents'));
  page.node.set(PDFName.of('Contents'), document.context.obj([...(contents instanceof PDFArray ? contents.asArray() : [contents]), drawn]));
  return document.save({ useObjectStreams: false });
}

/** The page as MuPDF holds it: its content joined, what it draws, and its words. */
async function readPage(bytes: Uint8Array): Promise<{ drawn: readonly DrawnObject[]; shows: number; words: string }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const leaf = document.findPage(0);
      const content = joinedContent(pageContentStreams(leaf));
      return {
        drawn: drawnObjects(content, (name) => (name === 'MonPhoto' ? 'image' : undefined)),
        shows: showOperators(content).length,
        words: document.loadPage(0).toStructuredText().asText(),
      };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Applies a placement to the page and answers the saved bytes. */
async function placed(bytes: Uint8Array, command: CommandOfKind<'placeDrawnObject'>): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyPlaceDrawnObject(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const PHOTO = { left: 300, bottom: 400, right: 420, top: 490 };
const LOGO = { left: 300, bottom: 300, right: 400, top: 350 };

const move = (over: Partial<CommandOfKind<'placeDrawnObject'>>): CommandOfKind<'placeDrawnObject'> => ({
  kind: 'placeDrawnObject',
  page: 0,
  index: 0,
  object: 'image',
  ordinal: 0,
  box: PHOTO,
  moveBy: { x: 0, y: 0 },
  scaleBy: { x: 1, y: 1 },
  version: asDocVersion(1),
  ...over,
});

describe('placeDrawnObject (ADR-0240, the owner’s E1)', () => {
  it('MOVES THE PHOTO and only the photo: every word and every other object read back as they were', async () => {
    const before = await readPage(await magazine());
    const after = await readPage(await placed(await magazine(), move({ moveBy: { x: 20, y: -10 } })));
    const photo = after.drawn.find((object) => object.kind === 'image');
    // THE PHOTO'S CORNER at (320, 390): the matrix it is now drawn under places its unit square there.
    expect(photo?.ctm.slice(4).map((value) => Math.round(value * 1000) / 1000)).toStrictEqual([320, 390]);
    // THE TEXT, byte for byte where the page holds it, and every object of every kind in the same order.
    expect(after.words).toBe(before.words);
    expect(after.shows).toBe(before.shows);
    expect(after.drawn.map((object) => object.kind)).toStrictEqual(before.drawn.map((object) => object.kind));
    // CONTROL: the logo did not move.
    expect(after.drawn.find((object) => object.kind === 'path')?.points).toStrictEqual(before.drawn.find((object) => object.kind === 'path')?.points);
  });

  it('RESIZES THE LOGO about its box’s bottom-left corner, as placePageObject does', async () => {
    const after = await readPage(await placed(await magazine(), move({ object: 'path', box: LOGO, scaleBy: { x: 2, y: 2 } })));
    const logo = after.drawn.find((object) => object.kind === 'path');
    const xs = logo?.points.map(([x]) => Math.round(x)) ?? [];
    const ys = logo?.points.map(([, y]) => Math.round(y)) ?? [];
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toStrictEqual([300, 300, 500, 400]);
  });

  it('REFUSES an object that is not where the listing put it — CONTROL: the same command at the listed box is applied', async () => {
    const elsewhere = move({ box: { left: 10, bottom: 10, right: 130, top: 100 }, moveBy: { x: 5, y: 5 } });
    await expect(placed(await magazine(), elsewhere)).rejects.toBeInstanceOf(DrawnObjectRefusedError);
    await expect(placed(await magazine(), move({ ordinal: 3 }))).rejects.toThrow('holds no image 3');
    await expect(placed(await magazine(), move({ moveBy: { x: 5, y: 5 } }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it('a path that also SETS THE CLIP is refused, since its Q would end the clip for what follows', () => {
    const content = new TextEncoder().encode('q 10 10 50 50 re W f Q');
    const [clipping] = drawnObjects(content, () => undefined);
    expect(clipping?.clips).toBe(true);
    // CONTROL: the same rectangle filled without W does not clip.
    expect(drawnObjects(new TextEncoder().encode('q 10 10 50 50 re f Q'), () => undefined)[0]?.clips).toBe(false);
  });
});

describe('the placement matrix and the wrap', () => {
  it('moves an object drawn under a scaled CTM by the page-space amount, not the scaled one', () => {
    // An object drawn under `2 0 0 2 0 0`: a page move of (10, 0) is (5, 0) in its own space.
    const ctm = [2, 0, 0, 2, 0, 0] as const;
    const matrix = placementIn(ctm, { box: { left: 0, bottom: 0, right: 10, top: 10 }, moveBy: { x: 10, y: 0 }, scaleBy: { x: 1, y: 1 } });
    if (matrix === null) throw new Error('no matrix');
    // THE POINT (1, 1) of the object, on the page at (2, 2) before, is at (12, 2) after.
    const [a, b, c, d, e, f] = multiply(matrix, ctm);
    expect([1 * a + 1 * c + e, 1 * b + 1 * d + f]).toStrictEqual([12, 2]);
  });

  it('wraps exactly the object’s instructions and copies every other byte', () => {
    const content = new TextEncoder().encode('BT (a) Tj ET /Im1 Do 0 0 m 1 1 l S');
    const [image] = drawnObjects(content, () => 'image');
    if (image === undefined) throw new Error('no image');
    const out = new TextDecoder().decode(wrappedContent(content, image, [1, 0, 0, 1, 5, 6]));
    expect(out).toBe('BT (a) Tj ET q 1 0 0 1 5 6 cm\n/Im1 Do\nQ 0 0 m 1 1 l S');
  });
});
