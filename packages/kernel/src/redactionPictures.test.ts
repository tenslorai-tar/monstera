import { describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * A picture a redaction rewrites keeps its own kind ([ADR-0288](../../../docs/DECISIONS/0288-a-picture-a-redaction-rewrites-keeps-its-own-kind.md)),
 * and what the mark covered is gone from the saved file, read four ways: the saved picture decoded is blank inside the
 * mark; the original picture's bytes are nowhere in the file; the mask, the page's thumbnail and the picture's
 * alternate carry nothing removed; and a picture no mark touches is byte for byte the one it was, which is also the
 * search's positive control.
 *
 * The page, 612 by 792, draws:
 * - PHOTO, an 800 by 600 JPEG at (50, 450) 400 by 300, carrying an alternate version, under mark A;
 * - DRAWING, a 400 by 300 lossless picture with a soft mask at (50, 100) 200 by 150, under mark B;
 * - KEPT, a 300 by 200 JPEG at (300, 100) 150 by 100, under no mark.
 */

const STAMP = { author: 'Priya Raman', created: '2026-11-06T09:00:00.000Z' } as const;
/** Mark A in user space: x 100 to 200 and y 500 to 600, inside the photo. */
const MARK_A = { x0: 100, y0: 500, x1: 200, y1: 600 } as const;
/** Mark B: x 60 to 120 and y 110 to 160, inside the drawing. */
const MARK_B = { x0: 60, y0: 110, x1: 120, y1: 160 } as const;

/** A picture with smooth content and a little texture, `components` per pixel, from known samples. */
function picture(width: number, height: number, space: mupdf.ColorSpace, alpha: boolean, seed: number): mupdf.Pixmap {
  const pixmap = new mupdf.Pixmap(space, [0, 0, width, height], alpha);
  // THE COUNT HOLDS ALPHA already: a 400-pixel row with alpha is 1,600 samples.
  const n = pixmap.getStride() / width;
  const samples = new Uint8Array(width * height * n);
  let state = seed;
  for (let at = 0; at < samples.length; at += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    // DARK AND NOT REPEATING: a pixel the redaction set to white is told apart from one it did not, and no two pictures
    // share a run of encoded bytes, which a pattern that repeats gave them (the byte search then matched across them).
    samples[at] = alpha && at % n === n - 1 ? 128 + (state >>> 25) : 20 + ((state >>> 16) % 100);
  }
  pixmap.setPixels(samples);
  return pixmap;
}

interface Fixture {
  readonly bytes: ByteImage;
  /** The raw stream bytes of each original picture, by role. */
  readonly raw: Readonly<Record<'photo' | 'alternate' | 'drawing' | 'mask' | 'kept', Uint8Array>>;
}

function rawOf(document: mupdf.PDFDocument, object: mupdf.PDFObject): Uint8Array {
  return document.newIndirect(object.asIndirect()).readRawStream().asUint8Array().slice();
}

/** The page above, with `rotate` and the photo drawn through a form where `inForm`. */
function fixture(options: { rotate?: mupdf.Rotate; inForm?: boolean; photoSpace?: mupdf.ColorSpace } = {}): Fixture {
  const document = new mupdf.PDFDocument();
  try {
    const photoPixels = picture(800, 600, options.photoSpace ?? mupdf.ColorSpace.DeviceRGB, false, 7);
    const photo = document.addImage(new mupdf.Image(photoPixels.asJPEG(92)));
    const alternate = document.addImage(new mupdf.Image(picture(64, 48, mupdf.ColorSpace.DeviceRGB, false, 11).asJPEG(92)));
    photo.put('Alternates', [document.newDictionary()]);
    photo.get('Alternates').get(0).put('Image', alternate);
    const drawing = document.addImage(new mupdf.Image(picture(400, 300, mupdf.ColorSpace.DeviceRGB, true, 13).asPNG()));
    const kept = document.addImage(new mupdf.Image(picture(300, 200, mupdf.ColorSpace.DeviceRGB, false, 17).asJPEG(92)));
    const thumbnail = document.addImage(new mupdf.Image(picture(61, 79, mupdf.ColorSpace.DeviceRGB, false, 19).asJPEG(80)));
    const photoDraw = 'q 400 0 0 300 50 450 cm /P Do Q';
    const resources = document.addObject({ XObject: { A: drawing, K: kept } });
    if (options.inForm === true) {
      const form = document.addStream(photoDraw, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: { XObject: { P: photo } } });
      resources.get('XObject').put('F', form);
    } else {
      resources.get('XObject').put('P', photo);
    }
    const content = `${options.inForm === true ? '/F Do' : photoDraw} q 200 0 0 150 50 100 cm /A Do Q q 150 0 0 100 300 100 cm /K Do Q`;
    const page = document.addPage([0, 0, 612, 792], options.rotate ?? 0, resources, content);
    page.put('Thumb', thumbnail);
    document.insertPage(-1, page);
    const raw = {
      photo: rawOf(document, photo),
      alternate: rawOf(document, alternate),
      drawing: rawOf(document, drawing),
      mask: rawOf(document, drawing.get('SMask')),
      kept: rawOf(document, kept),
    };
    return { bytes: document.saveToBuffer('garbage,compress').asUint8Array().slice(), raw };
  } finally {
    document.destroy();
  }
}

/** Marks A and B burned in, and the session saved: the file a person keeps. */
async function redacted(bytes: ByteImage, cover: 'solid' | 'none' = 'solid'): Promise<ByteImage> {
  const session: MupdfSession = await mupdfWriter.open(bytes);
  try {
    for (const rect of [MARK_A, MARK_B]) {
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'redact', over: 'region', rect, colour: [0, 0, 0], opacity: 1 },
      });
    }
    await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover, images: 'pixels', keepTitle: false, keepBookmarks: false });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

interface SavedPicture {
  readonly filter: string;
  readonly width: number;
  readonly height: number;
  readonly mask: { readonly filter: string; readonly samples: Uint8Array } | null;
  readonly alternates: boolean;
  readonly raw: Uint8Array;
  /** Decoded, as MuPDF reads it: `n` samples a pixel, rows top down. */
  readonly samples: Uint8Array;
  readonly n: number;
}

/** Every picture the saved file holds that is not a mask, by its pixel size. */
function picturesOf(bytes: ByteImage): Map<string, SavedPicture> {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the case expected a PDF');
  try {
    const masks = new Set<number>();
    const all: mupdf.PDFObject[] = [];
    for (let number = 1; number < document.countObjects(); number += 1) {
      const object = document.newIndirect(number);
      if (!object.isStream() || String(object.get('Subtype')) !== '/Image') continue;
      all.push(object);
      if (object.get('SMask').isIndirect()) masks.add(object.get('SMask').asIndirect());
    }
    const found = new Map<string, SavedPicture>();
    for (const object of all) {
      if (masks.has(object.asIndirect())) continue;
      const decoded = document.loadImage(object).toPixmap();
      const smask = object.get('SMask');
      const maskPixels = smask.isIndirect() ? document.loadImage(smask).toPixmap() : null;
      found.set(`${String(object.get('Width'))}x${String(object.get('Height'))}`, {
        filter: String(object.get('Filter')),
        width: object.get('Width').asNumber(),
        height: object.get('Height').asNumber(),
        mask: maskPixels === null ? null : { filter: String(smask.get('Filter')), samples: Uint8Array.from(maskPixels.getPixels()) },
        alternates: !object.get('Alternates').isNull(),
        raw: object.readRawStream().asUint8Array().slice(),
        samples: Uint8Array.from(decoded.getPixels()),
        n: decoded.getStride() / decoded.getWidth(),
      });
    }
    // A SEARCH THAT FOUND NOTHING IS A BROKEN READ: the page draws three pictures.
    if (found.size === 0) throw new Error('no picture was read from the saved file');
    return found;
  } finally {
    document.destroy();
  }
}

/** Whether any 48-byte run from the middle of `needle` appears in `haystack`. */
function holdsBytesOf(haystack: ByteImage, needle: Uint8Array): boolean {
  const hay = Buffer.from(haystack);
  for (let start = Math.floor(needle.length / 4); start + 48 <= needle.length; start += Math.max(48, Math.floor(needle.length / 64))) {
    if (hay.includes(Buffer.from(needle.subarray(start, start + 48)))) return true;
  }
  return false;
}

/** The pixel box of a mark on a picture drawn at (x, y) w by h, inset by `inset` pixels, rows top down. */
function pixelBox(
  picture: SavedPicture,
  at: { x: number; y: number; w: number; h: number },
  mark: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  inset: number,
) {
  const sx = picture.width / at.w;
  const sy = picture.height / at.h;
  return {
    x0: Math.round((mark.x0 - at.x) * sx) + inset,
    x1: Math.round((mark.x1 - at.x) * sx) - inset,
    y0: Math.round((at.y + at.h - mark.y1) * sy) + inset,
    y1: Math.round((at.y + at.h - mark.y0) * sy) - inset,
  };
}

/** The darkest colour sample inside `box`, alpha left out. */
function darkestIn(picture: SavedPicture, box: ReturnType<typeof pixelBox>, colours: number): number {
  let darkest = 255;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      for (let k = 0; k < colours; k += 1) darkest = Math.min(darkest, picture.samples[(y * picture.width + x) * picture.n + k] ?? 0);
    }
  }
  return darkest;
}

const PHOTO_AT = { x: 50, y: 450, w: 400, h: 300 };
const DRAWING_AT = { x: 50, y: 100, w: 200, h: 150 };

describe('a picture a redaction rewrites keeps its own kind, and what the mark covered is gone', () => {
  it('the photo goes back to JPEG at its own size, the drawing and its mask stay lossless, and the file stays small', async () => {
    const { bytes } = fixture();
    const saved = await redacted(bytes);
    const pictures = picturesOf(saved);
    const photo = pictures.get('800x600');
    const drawing = pictures.get('400x300');
    expect(photo?.filter).toBe('/DCTDecode');
    expect(drawing?.filter).toBe('/FlateDecode');
    expect(drawing?.mask?.filter).not.toBe('/DCTDecode');
    // THE SIZE: the burn-in wrote the photo as 1,440,000 bytes of raw RGB before; here it is about the JPEG it was.
    expect(saved.byteLength).toBeLessThan(bytes.byteLength * 1.5);
  }, 60_000);

  it('ONE: decoded, the saved pictures are blank inside the marks, and not blank outside them', async () => {
    const pictures = picturesOf(await redacted(fixture().bytes));
    const photo = pictures.get('800x600');
    const drawing = pictures.get('400x300');
    if (photo === undefined || drawing === undefined) throw new Error('a redacted picture is missing');
    // INSET BY TWO JPEG BLOCKS: a block crossing the mark's edge softens the pixels beside it from outside only.
    expect(darkestIn(photo, pixelBox(photo, PHOTO_AT, MARK_A, 16), 3)).toBeGreaterThan(240);
    expect(darkestIn(drawing, pixelBox(drawing, DRAWING_AT, MARK_B, 1), 3)).toBe(255);
    // CONTROL: outside the marks the pictures still hold their dark content, so the read is not of a blank picture.
    expect(darkestIn(photo, { x0: 500, x1: 700, y0: 400, y1: 550 }, 3)).toBeLessThan(100);
    expect(darkestIn(drawing, { x0: 300, x1: 380, y0: 20, y1: 80 }, 3)).toBeLessThan(100);
  }, 60_000);

  it('TWO: the original pictures’ bytes are nowhere in the saved file, and the kept picture’s are (the search’s control)', async () => {
    const { bytes, raw } = fixture();
    const saved = await redacted(bytes);
    expect(holdsBytesOf(bytes, raw.photo), 'CONTROL: the search finds the photo in the original').toBe(true);
    expect(holdsBytesOf(saved, raw.kept), 'CONTROL: the search finds a picture no mark touched').toBe(true);
    expect(holdsBytesOf(saved, raw.photo)).toBe(false);
    expect(holdsBytesOf(saved, raw.drawing)).toBe(false);
    expect(holdsBytesOf(saved, raw.mask)).toBe(false);
  }, 60_000);

  it('THREE: the mask is opaque inside the mark, the thumbnail is gone, and so is the photo’s alternate', async () => {
    const { bytes, raw } = fixture();
    const saved = await redacted(bytes);
    const pictures = picturesOf(saved);
    const drawing = pictures.get('400x300');
    const photo = pictures.get('800x600');
    if (drawing?.mask == null || photo === undefined) throw new Error('a redacted picture or its mask is missing');
    const box = pixelBox(drawing, DRAWING_AT, MARK_B, 1);
    let lowest = 255;
    for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) lowest = Math.min(lowest, drawing.mask.samples[y * drawing.width + x] ?? 0);
    expect(lowest).toBe(255);
    expect(photo.alternates).toBe(false);
    expect(holdsBytesOf(saved, raw.alternate)).toBe(false);
    expect(pictures.has('61x79'), 'the page thumbnail').toBe(false);
  }, 60_000);

  it('FOUR, THE CONTROL: a picture no mark touches is byte for byte the one it was', async () => {
    const { bytes, raw } = fixture();
    const kept = picturesOf(await redacted(bytes)).get('300x200');
    expect(kept?.filter).toBe('/DCTDecode');
    expect(Buffer.from(kept?.raw ?? []).equals(Buffer.from(raw.kept))).toBe(true);
  }, 60_000);

  it.each<[string, Parameters<typeof fixture>[0]]>([
    ['a page turned 90', { rotate: 90 }],
    ['a page turned 270', { rotate: 270 }],
    ['the photo drawn through a form', { inForm: true }],
    ['a grey photo', { photoSpace: mupdf.ColorSpace.DeviceGray }],
  ])('%s: the photo goes back to JPEG and is blank inside the mark', async (_name, options) => {
    const pictures = picturesOf(await redacted(fixture(options).bytes));
    const photo = pictures.get('800x600');
    if (photo === undefined) throw new Error('the photo is missing');
    expect(photo.filter).toBe('/DCTDecode');
    const colours = options?.photoSpace === mupdf.ColorSpace.DeviceGray ? 1 : 3;
    expect(darkestIn(photo, pixelBox(photo, PHOTO_AT, MARK_A, 16), colours)).toBeGreaterThan(240);
  }, 60_000);

  it('a photo no mark reaches is not rewritten at all: the page’s pictures are the ones it had', async () => {
    const { bytes, raw } = fixture();
    const session = await mupdfWriter.open(bytes);
    try {
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'redact', over: 'region', rect: { x0: 480, y0: 700, x1: 560, y1: 760 }, colour: [0, 0, 0], opacity: 1 },
      });
      await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels', keepTitle: false, keepBookmarks: false });
      const saved = await mupdfWriter.serialise(session);
      expect(Buffer.from(picturesOf(saved).get('800x600')?.raw ?? []).equals(Buffer.from(raw.photo))).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);
});

/**
 * A CMYK JPEG keeps its colours (ADR-0288): stored as its samples, and stored inverted under `/Decode [1 0 1 0 1 0 1 0]`,
 * the way a CMYK JPEG from Photoshop is held in a PDF. The page is drawn in RGB before the burn-in and after it, and the
 * photo's colours outside the mark compared; inside it the page is white.
 */
describe('a CMYK JPEG under a mark keeps its colours', () => {
  /** A page drawing an 800 by 600 CMYK JPEG at PHOTO_AT, its stream written by hand as each convention has it. */
  function cmykPage(inverted: boolean): ByteImage {
    const document = new mupdf.PDFDocument();
    try {
      const pixels = picture(800, 600, mupdf.ColorSpace.DeviceCMYK, false, 23);
      const photo = document.addRawStream(pixels.asJPEG(92, inverted), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 800,
        Height: 600,
        ColorSpace: 'DeviceCMYK',
        BitsPerComponent: 8,
        Filter: 'DCTDecode',
        ...(inverted ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}),
      });
      const resources = document.addObject({ XObject: { P: photo } });
      document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, resources, 'q 400 0 0 300 50 450 cm /P Do Q'));
      return document.saveToBuffer('garbage,compress').asUint8Array().slice();
    } finally {
      document.destroy();
    }
  }

  /** The page drawn in RGB at 1x, rows top down. */
  function rgb(bytes: ByteImage): Uint8Array {
    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    try {
      const pixmap = document.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
      try {
        return Uint8Array.from(pixmap.getPixels());
      } finally {
        pixmap.destroy();
      }
    } finally {
      document.destroy();
    }
  }

  /** Over the photo, the mean colour difference outside the mark (4 points clear of it), and the darkest sample inside. */
  function compared(before: Uint8Array, after: Uint8Array): { readonly meanOutside: number; readonly darkestInside: number } {
    let total = 0;
    let count = 0;
    let darkest = 255;
    for (let y = 792 - (PHOTO_AT.y + PHOTO_AT.h); y < 792 - PHOTO_AT.y; y += 1) {
      for (let x = PHOTO_AT.x; x < PHOTO_AT.x + PHOTO_AT.w; x += 1) {
        const ux = x + 0.5;
        const uy = 792 - y - 0.5;
        const away = Math.max(MARK_A.x0 - ux, ux - MARK_A.x1, MARK_A.y0 - uy, uy - MARK_A.y1);
        for (let k = 0; k < 3; k += 1) {
          const at = (y * 612 + x) * 3 + k;
          if (away < -4) darkest = Math.min(darkest, after[at] ?? 0);
          else if (away > 4) {
            total += Math.abs((before[at] ?? 0) - (after[at] ?? 0));
            count += 1;
          }
        }
      }
    }
    return { meanOutside: total / Math.max(1, count), darkestInside: darkest };
  }

  it.each([
    ['stored as its samples', false],
    ['stored inverted under /Decode [1 0 1 0 1 0 1 0]', true],
  ])('%s: JPEG again, the same colours outside the mark, white inside it', async (_name, inverted) => {
    const bytes = cmykPage(inverted);
    // NO COVER, so what is drawn inside the mark is the picture's own pixels, not the black box over them.
    const saved = await redacted(bytes, 'none');
    const before = rgb(bytes);
    const after = rgb(saved);
    const photo = picturesOf(saved).get('800x600');
    expect(photo?.filter).toBe('/DCTDecode');
    // STILL CMYK: four samples a pixel, as it was. The JPEG writer had turned an ICC-based CMYK pixmap into RGB.
    expect(photo?.n).toBe(4);
    const read = compared(before, after);
    // CONTROL: the photo is dark and varied, so a page drawn with its colours turned over would be far off.
    expect(read.meanOutside).toBeLessThan(6);
    expect(read.darkestInside).toBeGreaterThan(240);
  }, 60_000);
});
