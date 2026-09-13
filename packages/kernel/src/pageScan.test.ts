import { PDFDocument } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import {
  type Point,
  type Quad,
  applyStraightenScans,
  captureStraightenScans,
  perspectiveMap,
  sheetCorners,
  straightenedPages,
} from './pageScan.js';

/**
 * D9's document scan: a photographed sheet, found and straightened into its page.
 *
 * ## The fixtures are photographs this file draws
 *
 * A sheet of known corners on a darker background, with ink on it, encoded by MuPDF's own
 * JPEG encoder — `pageEnhance.test.ts`' reason: the case is about the correction, not
 * about a fixture builder. Knowing the corners is what lets a case assert where the sheet
 * went rather than that something changed.
 *
 * ## What separates straightening from doing nothing
 *
 * The photograph's CORNERS are background, and the straightened image's corners are
 * paper. A command that re-encoded the image unchanged would keep dark corners, and one
 * that only resized the page would too. So the corners are asserted, beside the size.
 */

const PHOTO_WIDTH = 480;
const PHOTO_HEIGHT = 360;
const BACKGROUND = 50;
const PAPER = 225;
const INK = 70;

/** A sheet turned and in perspective: every side a different length. */
const SHEET: Quad = [
  { x: 100, y: 60 },
  { x: 380, y: 90 },
  { x: 360, y: 320 },
  { x: 80, y: 290 },
];

/** Whether a point lies inside a convex quadrilateral given clockwise in image space. */
function inside(quad: Quad, x: number, y: number): boolean {
  const [a, b, c, d] = quad;
  const edges: readonly (readonly [Point, Point])[] = [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
  ];
  return edges.every(([from, to]) => (to.x - from.x) * (y - from.y) - (to.y - from.y) * (x - from.x) >= 0);
}

/** The sheet's corner at a position, refusing one the quad does not have. */
function sheetCorner(at: number): Point {
  const corner = SHEET[at];
  if (corner === undefined) throw new Error(`the sheet has no corner ${String(at)}`);
  return corner;
}

/** A grey photograph as raw samples, painted by `paint`. */
function photograph(paint: (x: number, y: number) => number): Uint8Array {
  const grey = new Uint8Array(PHOTO_WIDTH * PHOTO_HEIGHT);
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) grey[y * PHOTO_WIDTH + x] = paint(x + 0.5, y + 0.5);
  }
  return grey;
}

/**
 * The sheet on the background, with ink lines running edge to edge across it.
 *
 * THE BANDS ARE ROWS 15 TO 17 OF EVERY THIRTY, and not 0 to 2: the first version put one on
 * y = 60, the sheet's top-left corner, where a band lies between paper and DESK rather than
 * between two areas of paper. No closing should fill that, and the detector rightly reported
 * the corner three rows in — which made this fixture's corner wrong, not the detector.
 */
const sheetOnDesk = (x: number, y: number): number => {
  if (!inside(SHEET, x, y)) return BACKGROUND;
  const row = Math.floor(y) % 30;
  return row >= 15 && row < 18 ? INK : PAPER;
};

/** The same samples as a JPEG, through MuPDF's encoder. */
function jpegOf(grey: Uint8Array): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, PHOTO_WIDTH, PHOTO_HEIGHT], false);
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) pixels[y * stride + x] = grey[y * PHOTO_WIDTH + x] ?? 0;
  }
  const jpeg = new Uint8Array(pixmap.asJPEG(95, false));
  pixmap.destroy();
  return jpeg;
}

/** A document whose pages each draw the given photographs full-page. */
async function photographed(pages: readonly (readonly Uint8Array[])[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const photos of pages) {
    const page = document.addPage([612, 459]);
    for (const photo of photos) {
      page.drawImage(await document.embedJpg(photo), { x: 0, y: 0, width: 612, height: 459 });
    }
  }
  return document.save();
}

/** The one image on a page of saved bytes, decoded, and the page's displayed size. */
function pageOf(bytes: Uint8Array, page = 0): { image: mupdf.Pixmap; width: number; height: number } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
  const loaded = document.loadPage(page);
  const [x0, y0, x1, y1] = loaded.getBounds();
  const images: mupdf.PDFObject[] = [];
  loaded
    .getObject()
    .getInheritable('Resources')
    .get('XObject')
    .forEach((value) => {
      if (String(value.get('Subtype')) === '/Image') images.push(value);
    });
  const object = images[0];
  if (object === undefined) throw new Error('the page carries no image');
  return { image: new mupdf.Image(object.readRawStream()).toPixmap(), width: x1 - x0, height: y1 - y0 };
}

/** One grey sample of a decoded image. */
function sample(image: mupdf.Pixmap, x: number, y: number): number {
  const grey = image.getNumberOfComponents() === 1 ? image : image.convertToColorSpace(mupdf.ColorSpace.DeviceGray, true);
  return grey.getPixels()[y * grey.getStride() + x] ?? 0;
}

/**
 * The brightest sample within `radius` of a point.
 *
 * A WINDOW, NOT A PIXEL, because a single sample can land on a line of ink — the first
 * version's did, at a corner of the straightened sheet, and read 73 where paper is 225.
 * Paper is somewhere in every window at the sheet's corners; desk is everywhere in the
 * photograph's, so the window still separates straightening from doing nothing.
 */
function brightest(image: mupdf.Pixmap, x: number, y: number, radius = 3): number {
  let best = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = Math.min(image.getWidth() - 1, Math.max(0, x + dx));
      const sy = Math.min(image.getHeight() - 1, Math.max(0, y + dy));
      best = Math.max(best, sample(image, sx, sy));
    }
  }
  return best;
}

describe('sheetCorners', () => {
  it('finds a turned sheet in perspective to within a pixel and a half of each corner', () => {
    const found = sheetCorners(photograph(sheetOnDesk), PHOTO_WIDTH, PHOTO_HEIGHT);
    expect(found).not.toBeNull();
    for (const [at, corner] of (found ?? []).entries()) {
      const expected = sheetCorner(at);
      expect(Math.hypot(corner.x - expected.x, corner.y - expected.y), `corner ${String(at)}`).toBeLessThan(1.5);
    }
  });

  it('CONTROLS: nothing to find on a uniform image, and a photograph already cropped to its page is left alone', () => {
    expect(sheetCorners(photograph(() => 128), PHOTO_WIDTH, PHOTO_HEIGHT)).toBeNull();
    // PAPER TO THE EDGES, with specks of ink: the light region covers nearly all of it,
    // which is a page that needs no straightening — resampling it would only blur it.
    const cropped = photograph((x, y) => (Math.floor(x) % 50 === 0 && Math.floor(y) % 50 === 0 ? INK : PAPER));
    expect(sheetCorners(cropped, PHOTO_WIDTH, PHOTO_HEIGHT)).toBeNull();
  });
});

describe('perspectiveMap', () => {
  it('lands each corner of the output rectangle exactly on the sheet’s corner', () => {
    const map = perspectiveMap(SHEET, 280, 230);
    if (map === null) throw new Error('the map was refused for a sheet that has one');
    const outputs: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 280, y: 0 },
      { x: 280, y: 230 },
      { x: 0, y: 230 },
    ];
    for (const [at, output] of outputs.entries()) {
      const landed = map(output.x, output.y);
      const expected = sheetCorner(at);
      expect(landed.x).toBeCloseTo(expected.x, 6);
      expect(landed.y).toBeCloseTo(expected.y, 6);
    }
    // AND THE MIDDLE IS INSIDE THE SHEET — a map that matched the corners by folding the
    // plane would not keep its interior there.
    const middle = map(140, 115);
    expect(inside(SHEET, middle.x, middle.y)).toBe(true);
  });

  it('CONTROL: refuses a degenerate quad rather than answering a map that divides by zero', () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(perspectiveMap(line, 10, 10)).toBeNull();
  });
});

describe('straightenScans', () => {
  it('straightens the sheet into the page, and the result survives the save', async () => {
    const session = await mupdfWriter.open(await photographed([[jpegOf(photograph(sheetOnDesk))]]));
    try {
      expect(await straightenedPages(session, { kind: 'straightenScans', pages: [0] })).toStrictEqual([
        { page: 0, outcome: 'straightened' },
      ]);
      const after = pageOf(await mupdfWriter.serialise(session));

      // THE SHEET'S SIZE: its opposite sides are about 282 and 231 pixels long.
      expect(Math.abs(after.image.getWidth() - 282)).toBeLessThanOrEqual(3);
      expect(Math.abs(after.image.getHeight() - 231)).toBeLessThanOrEqual(3);
      // THE PAGE'S SHAPE IS THE SHEET'S, keeping the longer side.
      expect(after.width).toBeCloseTo(612, 0);
      expect(Math.abs(after.height - (612 * after.image.getHeight()) / after.image.getWidth())).toBeLessThan(1);

      // THE SEPARATING ASSERTION: every corner of the new image is PAPER, where every
      // corner of the photograph was desk.
      const w = after.image.getWidth();
      const h = after.image.getHeight();
      for (const [x, y] of [
        [4, 8],
        [w - 5, 8],
        [w - 5, h - 5],
        [4, h - 5],
      ] as const) {
        expect(brightest(after.image, x, y), `(${String(x)}, ${String(y)})`).toBeGreaterThan(180);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the photograph’s own corners are desk, so the case above could fail', async () => {
    const before = pageOf(await photographed([[jpegOf(photograph(sheetOnDesk))]]));
    // THE SAME WINDOW the case above reads, so the two are one measurement of two images.
    expect(brightest(before.image, 4, 8)).toBeLessThan(90);
    expect(brightest(before.image, PHOTO_WIDTH - 5, PHOTO_HEIGHT - 5)).toBeLessThan(90);
  });

  it('answers why a page was not straightened, and changes nothing on it', async () => {
    const plain = jpegOf(photograph(() => 128));
    const bytes = await photographed([[plain], [jpegOf(photograph(sheetOnDesk)), plain]]);
    const session = await mupdfWriter.open(bytes);
    try {
      expect(await straightenedPages(session, { kind: 'straightenScans', pages: [0, 1] })).toStrictEqual([
        { page: 0, outcome: 'no-sheet' },
        { page: 1, outcome: 'not-one-image' },
      ]);
      const after = pageOf(await mupdfWriter.serialise(session));
      // UNCHANGED: the page keeps its size and its image its pixels.
      expect(after.width).toBeCloseTo(612, 0);
      expect(after.height).toBeCloseTo(459, 0);
      expect(after.image.getWidth()).toBe(PHOTO_WIDTH);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page the document does not have, and writes nothing first', async () => {
    const bytes = await photographed([[jpegOf(photograph(sheetOnDesk))]]);
    const session = await mupdfWriter.open(bytes);
    try {
      await expect(straightenedPages(session, { kind: 'straightenScans', pages: [0, 3] })).rejects.toThrow(
        /Page 3 is outside this document, which has 1 page/u,
      );
      expect(pageOf(await mupdfWriter.serialise(session)).image.getWidth()).toBe(PHOTO_WIDTH);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the apply is the same write, and capture refuses with its reason', async () => {
    const session = await mupdfWriter.open(await photographed([[jpegOf(photograph(sheetOnDesk))]]));
    try {
      await applyStraightenScans(session, { kind: 'straightenScans', pages: [0] });
      expect(pageOf(await mupdfWriter.serialise(session)).image.getWidth()).not.toBe(PHOTO_WIDTH);
      const captured = await captureStraightenScans(session, { kind: 'straightenScans', pages: [0] });
      expect(!captured.captured && captured.reason).toMatch(/document-scaled/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
