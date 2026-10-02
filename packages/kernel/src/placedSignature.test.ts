import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from '@cantoo/pdf-lib';
import { type AnnotationRect, type KeepableSignature, placedMarkOf } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import {
  applyPlaceAnnotation,
  applyPlaceSignatureMark,
  applyPlaceSignaturePicture,
  capturePlaceSignature,
  readAnnotations,
} from './pageAnnotations.js';

/**
 * A plain signature, placed with no certificate (ADR-0133): the kernel half of the wired pair. The command must put
 * the mark ON THE PAGE — ink inside the box it names, upright as the page is seen — keep it through a resize, list it
 * as this build's mark, and survive a save and a reopen. The pixels are the observable, through MuPDF's own page
 * transform, for `documentSign.test.ts`' reason: a case computing the box with the writer's arithmetic would agree
 * with any mistake in it.
 */

const STAMP = { author: 'Priya Raman', created: '2026-10-02T09:00:00.000Z' } as const;
const BOX: AnnotationRect = { x0: 100, y0: 100, x1: 300, y1: 180 };

async function blankPage(turn = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([400, 600]).setRotation(degrees(turn));
  return await document.save();
}

async function onSession<T>(bytes: Uint8Array, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Page 0 rendered with its annotations, and MuPDF's own page transform. */
function rendered(bytes: Uint8Array): { readonly width: number; readonly samples: Uint8Array; readonly transform: readonly number[] } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
    return { width: pixmap.getWidth(), samples: Uint8Array.from(pixmap.getPixels()), transform: [...page.getTransform()] };
  } finally {
    document.destroy();
  }
}

/** A user-space rectangle's box in rendered pixels. */
function seen(transform: readonly number[], rect: AnnotationRect): [number, number, number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
  const corners = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y1],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f] as const);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Dark samples inside a pixel box, and how many distinct columns hold one. */
function inkIn(
  page: ReturnType<typeof rendered>,
  [left, top, right, bottom]: readonly [number, number, number, number],
): { readonly samples: number; readonly columns: number } {
  let samples = 0;
  const columns = new Set<number>();
  for (let y = Math.ceil(top); y < Math.floor(bottom); y += 1) {
    for (let x = Math.ceil(left); x < Math.floor(right); x += 1) {
      if ((page.samples[y * page.width + x] ?? 255) < 128) {
        samples += 1;
        columns.add(x);
      }
    }
  }
  return { samples, columns: columns.size };
}

const typed = { kind: 'typed', text: 'Grace Hopper', font: 'times-italic' } as const;
const drawn: KeepableSignature = {
  kind: 'drawn',
  strokes: [
    [
      [0.05, 0.1],
      [0.5, 0.3],
      [0.95, 0.05],
    ],
  ],
};

let picture: Uint8Array;
beforeAll(() => {
  // A BLACK PNG, made by the engine rather than committed (B10). Not square, so a stretched drawing reads differently.
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], false);
  pixmap.clear(0);
  picture = pixmap.asPNG();
});

/** Places one look on `bytes` and answers the saved document. */
async function placed(
  bytes: Uint8Array,
  look: 'typed' | 'drawn' | 'picture' | KeepableSignature,
  rect: AnnotationRect = BOX,
): Promise<Uint8Array> {
  return await onSession(bytes, async (session) => {
    if (look === 'picture') {
      await applyPlaceSignaturePicture(session, {
        kind: 'placeSignaturePicture',
        page: 0,
        rect,
        bytes: picture,
        mediaType: 'image/png',
        stamp: STAMP,
      });
    } else {
      const mark = look === 'typed' ? typed : look === 'drawn' ? drawn : look;
      // IN THE PLACED FORM, as main mints it: the one fitting a drawing crosses through.
      await applyPlaceSignatureMark(session, { kind: 'placeSignatureMark', page: 0, rect, mark: placedMarkOf(mark), stamp: STAMP });
    }
    return await mupdfWriter.serialise(session);
  });
}

/**
 * Reads the saved first annotation's `/AP /N` back and requires it to be the drawing this build wrote for `look`, under
 * the stamp name that keeps MuPDF from naming it `/Draft`. An ink count cannot tell the two apart: MuPDF's resynthesised
 * stamp is dark in grey too.
 */
async function expectWrittenAppearance(saved: Uint8Array, look: 'typed' | 'drawn' | 'picture'): Promise<void> {
  const document = await PDFDocument.load(saved);
  const annot = document.getPages()[0]?.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  expect(annot?.lookup(PDFName.of('Name'))).toBe(PDFName.of('Signature'));
  const stream = annot?.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  if (!(stream instanceof PDFRawStream)) throw new Error('no appearance stream was written');
  const content = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const expected = { typed: /\/F0 [\d.]+ Tf/u, drawn: /[\d.]+ [\d.]+ l\n/u, picture: /\/Im0 Do/u }[look];
  expect(content).toMatch(expected);
  expect(content).not.toMatch(/Draft/u);
}

describe('a placed signature', () => {
  it.each(['typed', 'drawn', 'picture'] as const)(
    'THE OBSERVABLE: a %s signature renders INK inside its box, after a save and a reopen',
    async (look) => {
      const blank = await blankPage();
      // THE CONTROL: the same box on the page before placing is blank, so the ink below is the signature's.
      const before = rendered(blank);
      expect(inkIn(before, seen(before.transform, BOX)).samples).toBe(0);

      // SAVED, then REOPENED in a fresh session and saved again: what is rendered is what survives a round trip.
      const saved = await placed(blank, look);
      const reopened = await onSession(saved, async (session) => await mupdfWriter.serialise(session));
      const page = rendered(reopened);
      expect(inkIn(page, seen(page.transform, BOX)).samples, 'ink inside the placed box').toBeGreaterThan(50);
      // AND NOTHING OUTSIDE IT: the mark is fitted into its box rather than drawn at the page's origin.
      const total = inkIn(page, [0, 0, page.width, page.samples.length / page.width]).samples;
      expect(total - inkIn(page, seen(page.transform, BOX)).samples).toBe(0);
    },
    60_000,
  );

  it.each(['typed', 'drawn', 'picture'] as const)(
    'MuPDF KEEPS THE WRITTEN APPEARANCE of a %s signature, through a save — it does not resynthesise a /Draft stamp',
    async (look) => {
      // THE CASE THE INK COUNT ALONE COULD NOT BE: MuPDF names a new stamp /Draft and redraws a standard stamp whose
      // object is dirty, as the word *Draft* in red — dark in grey, so a pixel count passed for it — and a picture as
      // itself stretched over the box. So the saved stream is read back and must be the drawing's.
      await expectWrittenAppearance(await placed(await blankPage(), look), look);
    },
  );

  it('a drawing at the KEPT bound, thinned to the placed one, still draws inside its box', async () => {
    // 64 strokes of 1,024 points: the drawing DDDDDDD-1 measured at ten times the host's frame. Each stroke a zigzag
    // across the pad, so a thinning that dropped a stroke or its ends would leave columns of the box empty. Four times
    // as wide as it is tall, so the ink is fitted to the box's WIDTH (200 × 80) and every column is the drawing's.
    const zigzags = (perStroke: number): KeepableSignature => ({
      kind: 'drawn',
      strokes: Array.from({ length: 64 }, (_, row) =>
        Array.from({ length: perStroke }, (_, at) => [at / (perStroke - 1), (row + (at % 2)) / 264] as [number, number]),
      ),
    });
    const inked = async (mark: KeepableSignature): Promise<{ samples: number; columns: number }> => {
      const page = rendered(await placed(await blankPage(), mark));
      return inkIn(page, seen(page.transform, BOX));
    };
    // THE CONTROL: the same shape at 48 points a stroke, 3,072 in all — exactly the placed bound, so never thinned.
    const within = await inked(zigzags(48));
    const thinned = await inked(zigzags(1024));
    expect(thinned.samples).toBeGreaterThan(50);
    // THE SAME COLUMNS: a thinning that cut strokes short, or dropped their last points, would end the ink early.
    expect(thinned.columns).toBeGreaterThanOrEqual(within.columns - 2);
  });

  it('a PICTURE keeps its proportions inside the box rather than filling it', async () => {
    // 40 × 20 in a 200 × 80 box: fitted by height to 72 tall and 144 wide, so the ink spans about 0.72 of the box's
    // width. Stretched over the box, as MuPDF's own stamp-image appearance draws, it would span all of it.
    const page = rendered(await placed(await blankPage(), 'picture'));
    const [left, top, right, bottom] = seen(page.transform, BOX);
    const { columns } = inkIn(page, [left, top, right, bottom]);
    expect(columns / (right - left)).toBeGreaterThan(0.6);
    expect(columns / (right - left)).toBeLessThan(0.85);
  });

  it.each([0, 90, 180, 270])('ON A PAGE TURNED %i° the mark is upright as the page is SEEN', async (turn) => {
    // `documentSign.test.ts`' line-over-dot case, for the stamp: upright, the top inked rows are the wide line and the
    // bottom ones the narrow dot. Without the counter-rotation the line is vertical on screen and no row is wide.
    const signed = await placed(await blankPage(turn), {
      kind: 'drawn',
      strokes: [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0.5, 0.3],
          [0.5, 0.3],
        ],
      ],
    });
    const page = rendered(signed);
    const [left, top, right, bottom] = seen(page.transform, BOX);
    const across = right - left;
    const groups: number[][] = [];
    let previous = Number.NEGATIVE_INFINITY;
    for (let row = Math.ceil(top); row < Math.floor(bottom); row += 1) {
      const { columns } = inkIn(page, [left, row, right, row + 1]);
      if (columns === 0) continue;
      if (row !== previous + 1) groups.push([]);
      groups[groups.length - 1]?.push(columns);
      previous = row;
    }
    expect(groups.length, 'a line and, separately, a dot').toBe(2);
    expect(Math.max(...(groups[0] ?? [0])) / across, 'the LINE is on top, as seen').toBeGreaterThan(0.6);
    expect(Math.max(...(groups[1] ?? [across])) / across, 'the DOT is below it').toBeLessThan(0.2);
  });

  it.each(['typed', 'drawn', 'picture'] as const)(
    'a RESIZED %s signature still draws, inside its NEW box: placeAnnotation keeps the written appearance',
    async (look) => {
      // Each look is asked rather than assumed from another's reading: a typed mark names a font resource, a drawn one
      // none, and a picture an image behind a form. The stream is read back too, because ink alone would pass for a
      // stamp MuPDF had redrawn as its own.
      const grown: AnnotationRect = { x0: 50, y0: 300, x1: 350, y1: 420 };
      const resized = await onSession(await placed(await blankPage(), look), async (session) => {
        await applyPlaceAnnotation(session, {
          kind: 'placeAnnotation',
          page: 0,
          placements: [{ index: 0, rect: grown }],
          version: asDocVersion(1),
        });
        return await mupdfWriter.serialise(session);
      });
      const page = rendered(resized);
      expect(inkIn(page, seen(page.transform, grown)).samples, 'ink inside the new box').toBeGreaterThan(50);
      expect(inkIn(page, seen(page.transform, BOX)).samples, 'and none left in the old one').toBe(0);
      await expectWrittenAppearance(resized, look);
    },
    60_000,
  );

  it('is listed as THIS BUILD’S /Stamp, so select, move and delete reach it', async () => {
    const listed = await onSession(await placed(await blankPage(), 'typed'), async (session) => await readAnnotations(session));
    expect(listed.annotations).toHaveLength(1);
    expect(listed.annotations[0]).toMatchObject({ page: 0, index: 0, kind: 'stamp', author: STAMP.author });
  });

  it('REFUSES a box off the page, and text the font cannot encode, BEFORE writing anything', async () => {
    const blank = await blankPage();
    await expect(placed(blank, 'typed', { x0: 900, y0: 900, x1: 1000, y1: 950 })).rejects.toThrow(RangeError);
    const untouched = await onSession(blank, async (session) => {
      await expect(
        applyPlaceSignatureMark(session, {
          kind: 'placeSignatureMark',
          page: 0,
          rect: BOX,
          mark: { kind: 'typed', text: 'Grace ✓', font: 'courier' },
          stamp: STAMP,
        }),
      ).rejects.toMatchObject({ reason: 'unencodable-text' });
      return await readAnnotations(session);
    });
    expect(untouched.annotations).toHaveLength(0);
  });

  it('REFUSES bytes that are not a picture, before writing anything', async () => {
    await onSession(await blankPage(), async (session) => {
      await expect(
        applyPlaceSignaturePicture(session, {
          kind: 'placeSignaturePicture',
          page: 0,
          rect: BOX,
          bytes: Uint8Array.of(1, 2, 3, 4),
          mediaType: 'image/png',
          stamp: STAMP,
        }),
      ).rejects.toThrow();
      expect((await readAnnotations(session)).annotations).toHaveLength(0);
    });
  });
});

describe('capturePlaceSignature', () => {
  it('answers NOT CAPTURED for a page the document has — so the bus takes a checkpoint and undo restores it', async () => {
    await onSession(await blankPage(), async (session) => {
      const answer = await capturePlaceSignature(session, {
        kind: 'placeSignatureMark',
        page: 0,
        rect: BOX,
        mark: typed,
        stamp: STAMP,
      });
      expect(answer.captured).toBe(false);
    });
  });

  it('CONTROL: refuses a page the document does not have, so no checkpoint is taken for a command about to throw', async () => {
    await onSession(await blankPage(), async (session) => {
      await expect(
        capturePlaceSignature(session, { kind: 'placeSignatureMark', page: 4, rect: BOX, mark: typed, stamp: STAMP }),
      ).rejects.toThrow();
    });
  });
});
