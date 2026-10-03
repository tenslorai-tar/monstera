import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { describe, expect, it } from 'vitest';

import { MAX_SCAN_SIDE, type ScanRaster, SCAN_DPI, inkOf, signatureFromScan, transparentCut } from './signatureScan.js';

/**
 * A scanned signature PDF made into a picture (G3d): its first page drawn in the compose host, cut to the ink, the
 * paper made transparent.
 *
 * The fixtures are what a scan of a signature carries besides the signature, each one a way the cut could be dragged
 * off the ink: paper that is not white, a scanner's dark edge, a printed line across the page, and a fleck of dust in
 * a corner. Each case says what the cut would be if the rule it names were absent.
 */

/** A grey raster of `width` × `height`, every pixel `paper`, one component. */
function greyRaster(width: number, height: number, paper: number): ScanRaster & { readonly samples: Uint8Array } {
  return { samples: new Uint8Array(width * height).fill(paper), width, height, stride: width, components: 1 };
}

/** Paints a rectangle of a grey raster. */
function paint(raster: ScanRaster & { readonly samples: Uint8Array }, x0: number, y0: number, x1: number, y1: number, value: number): void {
  for (let y = y0; y < y1; y += 1) raster.samples.fill(value, y * raster.stride + x0, y * raster.stride + x1);
}

describe('inkOf: where the signature is on a drawn page', () => {
  it('cuts to the ink with a margin, on paper that is not white', () => {
    // PAPER AT 180, which a threshold fixed at three quarters of white (191) would read as ink — the whole page.
    const raster = greyRaster(400, 300, 180);
    paint(raster, 100, 120, 300, 160, 60);
    const cut = inkOf(raster);
    expect(cut).not.toBeNull();
    expect(cut?.paper).toBe(180);
    // 200 wide, so the margin is ceil(8) + 2 = 10 on every side.
    expect(cut).toMatchObject({ x0: 90, y0: 110, x1: 310, y1: 170 });
  });

  it('reads WHITE colour paper as paper, so a scan clipped to white is cut to its ink', () => {
    // RGB, and every paper sample 255: white's luminance is the top of the range, and a value one past it is a byte of
    // 0 — the paper read as ink in every row, every row set aside, and the scan answered as blank.
    const width = 300;
    const height = 200;
    const samples = new Uint8Array(width * height * 3).fill(255);
    for (let y = 80; y < 120; y += 1) samples.fill(30, (y * width + 100) * 3, (y * width + 200) * 3);
    expect(inkOf({ samples, width, height, stride: width * 3, components: 3 })).toMatchObject({
      x0: 94,
      y0: 74,
      x1: 206,
      y1: 126,
      paper: 255,
    });
  });

  it('answers null for a page with no ink, and for grain alone', () => {
    expect(inkOf(greyRaster(200, 100, 230))).toBeNull();
    const grain = greyRaster(200, 100, 230);
    paint(grain, 10, 10, 15, 15, 0);
    // 25 dark pixels: dust, not a signature.
    expect(inkOf(grain)).toBeNull();
  });

  it('sets aside a scanner’s dark edge and a line printed across the page', () => {
    const raster = greyRaster(400, 300, 230);
    paint(raster, 0, 0, 12, 300, 20);
    paint(raster, 0, 250, 400, 253, 20);
    paint(raster, 150, 100, 250, 140, 40);
    // WITHOUT THE RULE the edge is ink in every row and the cut starts at column 0, and the line pulls it to row 253.
    expect(inkOf(raster)).toMatchObject({ x0: 144, y0: 94, x1: 256, y1: 146 });
  });

  it('starts the cut past a fleck of dust in a corner', () => {
    const raster = greyRaster(400, 300, 230);
    paint(raster, 100, 100, 300, 160, 40);
    paint(raster, 390, 5, 393, 8, 0);
    // WITHOUT THE RULE the nine pixels at (390, 5) stretch the cut to the corner.
    expect(inkOf(raster)).toMatchObject({ x0: 90, y0: 90, x1: 310, y1: 170 });
  });

  it('starts the cut past a fleck LARGER than a fraction of the ink, because what decides is how far it is', () => {
    // 36 PIXELS of dust under 12,000 of signature: 0.3% of the ink, which a rule by share of the ink keeps.
    const raster = greyRaster(400, 400, 230);
    paint(raster, 100, 100, 300, 160, 40);
    paint(raster, 340, 360, 346, 366, 0);
    expect(inkOf(raster)).toMatchObject({ x0: 90, y0: 90, x1: 310, y1: 170 });
  });

  it('CONTROL: keeps a small piece NEAR the signature — the dot of an i — and the cut grows to hold it', () => {
    const raster = greyRaster(400, 300, 230);
    paint(raster, 100, 100, 300, 160, 40);
    // SIX PIXELS SQUARE, 20 above the stroke: a dot the size of a pen's, well within the reach of a 200-wide signature.
    paint(raster, 150, 74, 156, 80, 40);
    expect(inkOf(raster)).toMatchObject({ x0: 90, y0: 64, x1: 310, y1: 170 });
  });

  it('does not FOLLOW a trail of specks away from the signature, each near the last and not near it', () => {
    const raster = greyRaster(800, 300, 230);
    paint(raster, 100, 100, 300, 160, 40);
    // FOUR-PIXEL SQUARES every 25 pixels from the stroke's end: more than grain, and each 21 from the one before —
    // inside the 30-pixel reach of a 200-wide signature — while only the first is within reach of the signature.
    for (let x = 320; x < 780; x += 25) paint(raster, x, 128, x + 4, 132, 40);
    // THE FIRST ONE JOINS (20 from the stroke), and the cut stops there rather than at the trail's end: ink from 100 to
    // 324, so a margin of ceil(224 × 0.04) + 2 = 11.
    expect(inkOf(raster)).toMatchObject({ x0: 89, y0: 89, x1: 335, y1: 171 });
  });

  it('reads a grainy page with a piece for every speck, and still finds the signature', () => {
    // EVERY THIRD PIXEL OF EVERY THIRD ROW dark: over a hundred thousand pieces, which a spread of their areas into one
    // call's arguments overflows the stack on — and a third of each such row, so no row reads as a printed line.
    const raster = greyRaster(1000, 1000, 230);
    for (let y = 0; y < 1000; y += 3) for (let x = 0; x < 1000; x += 3) raster.samples[y * 1000 + x] = 120;
    paint(raster, 300, 400, 700, 480, 20);
    const cut = inkOf(raster);
    // THE SIGNATURE'S BOX AND ITS MARGIN, one row taller at each end: grain on rows 399 and 480 TOUCHES the stroke, so
    // it is the stroke's piece. Grain anywhere else joins nothing.
    expect(cut).toMatchObject({ x0: 282, y0: 381, x1: 718, y1: 499 });
  });

  it('draws a printed line only where a stroke CROSSES it, so a stroke that touches it leaves no stub', () => {
    const raster = greyRaster(400, 300, 230);
    // A LINE across the page at rows 150 and 151; one upright crossing it, one ending on it from above.
    paint(raster, 0, 150, 400, 152, 30);
    paint(raster, 100, 100, 110, 200, 40);
    paint(raster, 290, 100, 300, 150, 40);
    paint(raster, 100, 100, 300, 108, 40);
    const cut = inkOf(raster);
    if (cut === null) throw new Error('no cut');
    const keep = (x: number, y: number): number => cut.keep[y * 400 + x] ?? -1;
    // THE CROSSING is drawn through, so the upright is whole.
    expect(keep(105, 150)).toBe(1);
    // THE TOUCH leaves nothing of the line — beside the stroke, under it, and in the line's soft edge below.
    expect(keep(292, 150)).toBe(0);
    expect(keep(302, 151)).toBe(0);
    expect(keep(295, 153)).toBe(0);
    // CONTROL: the touching stroke's own ink, a row above the line, is drawn: the band clears fringe and never ink.
    expect(keep(295, 149)).toBe(1);
  });

  it('draws only the signature: a printed line through its box and dust inside it are clear', () => {
    const raster = greyRaster(400, 300, 230);
    // A STROKE, a line printed across the page through its middle, and a fleck inside the box but far from the ink.
    paint(raster, 100, 100, 110, 200, 40);
    paint(raster, 290, 100, 300, 200, 40);
    paint(raster, 100, 100, 300, 108, 40);
    paint(raster, 0, 150, 400, 152, 30);
    paint(raster, 200, 180, 202, 182, 30);
    const cut = inkOf(raster);
    if (cut === null) throw new Error('no cut');
    const out = transparentCut(raster, cut);
    const width = cut.x1 - cut.x0;
    const alphaAt = (x: number, y: number): number => out[((y - cut.y0) * width + (x - cut.x0)) * 4 + 3] ?? -1;
    // THE STROKE IS DRAWN — ink at 40 on paper at 230 is four fifths covered — and the line between the two uprights
    // and the fleck are clear.
    expect(alphaAt(105, 120)).toBeGreaterThan(180);
    expect(alphaAt(200, 150)).toBe(0);
    expect(alphaAt(201, 181)).toBe(0);
    // CONTROL: the same pixels without the mask are ink, so a clear one above is the mask and not the paper.
    expect(transparentCut(raster, { ...cut, keep: new Uint8Array(400 * 300).fill(1) })[
      ((150 - cut.y0) * width + (200 - cut.x0)) * 4 + 3
    ]).toBeGreaterThan(200);
  });
});

describe('transparentCut: the paper made transparent, the ink kept', () => {
  it('makes the paper clear and keeps a stroke opaque in its own colour, premultiplied', () => {
    const raster: ScanRaster = {
      // Two pixels, RGB: the paper, and a dark blue stroke on it.
      samples: Uint8Array.from([200, 200, 200, 20, 30, 120]),
      width: 2,
      height: 1,
      stride: 6,
      components: 3,
    };
    const out = transparentCut(raster, { x0: 0, y0: 0, x1: 2, y1: 1, paper: 200, keep: Uint8Array.of(1, 1) });
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    const [r = 0, g = 0, b = 0, a = 0] = out.slice(4, 8);
    expect(a).toBeGreaterThan(220);
    // BLUE STAYS BLUE: a stroke read as grey coverage alone would come out black.
    expect(b).toBeGreaterThan(r + 40);
    expect(b).toBeGreaterThan(g + 40);
  });
});

/** A one-page PDF of `width` × `height` points, drawn by `draw`. */
async function scanned(width: number, height: number, draw: (page: ReturnType<PDFDocument['addPage']>) => void): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  draw(pdf.addPage([width, height]));
  return pdf.save();
}

/** The PNG's pixels, as MuPDF decodes them: premultiplied RGBA. */
function decoded(png: Uint8Array): { readonly samples: Uint8ClampedArray; readonly width: number; readonly height: number } {
  const pixmap = new mupdf.Image(png).toPixmap();
  try {
    expect(pixmap.getNumberOfComponents()).toBe(4);
    return { samples: pixmap.getPixels(), width: pixmap.getWidth(), height: pixmap.getHeight() };
  } finally {
    pixmap.destroy();
  }
}

describe('signatureFromScan: a scanned signature PDF as a picture', () => {
  /** The page every case draws on: 400 × 300 points, grey paper. */
  const page = (draw: (page: ReturnType<PDFDocument['addPage']>) => void = () => undefined): Promise<Uint8Array> =>
    scanned(400, 300, (sheet) => {
      sheet.drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: rgb(0.85, 0.85, 0.85) });
      draw(sheet);
    });

  it('draws the first page at 300 dpi and cuts to the signature, the paper transparent', async () => {
    const bytes = await page((sheet) => {
      sheet.drawLine({ start: { x: 100, y: 120 }, end: { x: 300, y: 180 }, thickness: 4, color: rgb(0.1, 0.1, 0.5) });
      sheet.drawLine({ start: { x: 100, y: 180 }, end: { x: 300, y: 120 }, thickness: 4, color: rgb(0.1, 0.1, 0.5) });
      // A FLECK in the top right corner, which the cut must not reach.
      sheet.drawRectangle({ x: 385, y: 285, width: 1, height: 1, color: rgb(0, 0, 0) });
    });
    const answer = signatureFromScan(bytes);
    if (answer.kind !== 'drawn') throw new Error(`expected a picture, got ${answer.kind}`);

    const scale = SCAN_DPI / 72;
    // THE INK SPANS 200 × 60 POINTS, plus its line caps and a margin of 4% of the longer side: wider than 200 points
    // and far short of the 285-point reach the fleck would give it.
    expect(answer.width).toBeGreaterThan(200 * scale);
    expect(answer.width).toBeLessThan(240 * scale);
    expect(answer.height).toBeGreaterThan(60 * scale);
    expect(answer.height).toBeLessThan(90 * scale);

    const { samples, width, height } = decoded(answer.png);
    expect([width, height]).toEqual([answer.width, answer.height]);
    // A CORNER IS PAPER, and it is clear.
    expect(samples[3]).toBe(0);
    // THE CROSSING AT THE CENTRE IS INK, opaque and blue.
    const centre = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    expect(samples[centre + 3]).toBeGreaterThan(200);
    expect(samples[centre + 2] ?? 0).toBeGreaterThan((samples[centre] ?? 0) + 30);
  });

  it('holds a page past eight inches to the channel’s bound, its origin off zero', async () => {
    // A POSTER of 2000 × 1000 points, at 300 dpi 8333 pixels wide, its box starting at a fraction. MuPDF moves a page's
    // box to zero and rounds it with a tolerance, so the side scaled to the bound draws at the bound (measured
    // 2026-10-03 on four boxes, fractional and whole: 2400 each time).
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage([2000.4, 1000.4]);
    sheet.setMediaBox(0.3, 0.3, 2000.4, 1000.4);
    // A STROKE CORNER TO CORNER, so the cut is the whole drawn width and no row or column of it is mostly ink.
    sheet.drawLine({ start: { x: 1, y: 1 }, end: { x: 2000, y: 1000 }, thickness: 20, color: rgb(0, 0, 0) });
    const answer = signatureFromScan(await pdf.save());
    if (answer.kind !== 'drawn') throw new Error(`expected a picture, got ${answer.kind}`);
    expect(answer.width).toBeLessThanOrEqual(MAX_SCAN_SIDE);
    expect(answer.width).toBeGreaterThan(MAX_SCAN_SIDE - 200);
  });

  it('keeps a half-covered pixel’s colour through the PNG, so the colour is written premultiplied', () => {
    // A MuPDF pixmap with alpha holds its colour premultiplied and its PNG writer divides it out. Written straight,
    // a colour of 100 at half coverage would come back at 25 rather than 50.
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1, 1], true);
    try {
      pixmap.setPixels(Uint8ClampedArray.from([50, 50, 50, 128]));
      const { samples } = decoded(pixmap.asPNG());
      expect([...samples]).toEqual([50, 50, 50, 128]);
    } finally {
      pixmap.destroy();
    }
  });

  it('answers blank for a first page with no ink', async () => {
    expect(signatureFromScan(await page())).toEqual({ kind: 'blank' });
  });

  it('reads the FIRST page, and a signature on the second is not looked for', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 300]);
    pdf.addPage([400, 300]).drawRectangle({ x: 100, y: 100, width: 200, height: 40, color: rgb(0, 0, 0) });
    expect(signatureFromScan(await pdf.save())).toEqual({ kind: 'blank' });
  });

  it('answers locked for a PDF that needs a password, and unreadable for bytes that are not a PDF', async () => {
    // ON WHITE, as most scans are: the page's own paper, nothing drawn under the ink.
    const plain = await scanned(400, 300, (sheet) => {
      sheet.drawRectangle({ x: 100, y: 100, width: 200, height: 40, color: rgb(0, 0, 0) });
    });
    // THE CONTROL: the same document unencrypted is a picture, so `locked` below is the password and not the page.
    expect(signatureFromScan(plain).kind).toBe('drawn');
    const source = mupdf.Document.openDocument(plain, 'application/pdf');
    if (!(source instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
    let locked: Uint8Array;
    try {
      locked = Uint8Array.from(
        source.saveToBuffer('encrypt=aes-256,user-password="open-me",owner-password="own-me"').asUint8Array(),
      );
    } finally {
      source.destroy();
    }
    expect(signatureFromScan(locked)).toEqual({ kind: 'locked' });
    expect(signatureFromScan(new TextEncoder().encode('this is not a PDF at all'))).toEqual({ kind: 'unreadable' });
  });
});
