import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import type { AnnotationRect } from '@monstera/contract';
import { Image } from 'mupdf';
import { describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import {
  MAX_SNAPSHOT_PIXELS,
  MAX_SNAPSHOT_SCALE,
  MIN_SNAPSHOT_SCALE,
  snapshotRegion,
} from './pageSnapshot.js';

/**
 * Rasterising a region of a page.
 *
 * ## The fixture is FOUR COLOURS, because a region is a position and not a size
 *
 * Every wrong implementation here produces a PNG of plausible dimensions: a
 * snapshot that ignored the rectangle renders the whole page, one that dropped
 * the y-flip renders the region mirrored, one that ignored the CropBox origin
 * renders a region the same size in the wrong place. Size separates none of
 * them. So the page is four quadrants of four colours nothing else has, and the
 * cases read the colour back — a reading only the correct region produces.
 *
 * ## The colour is read by DECODING the PNG, which is a second pass over MuPDF
 *
 * `Image(...).toPixmap()` decodes what `Pixmap.asPNG()` wrote, so this is one
 * library round-tripping its own output — the shape that proves nothing when
 * the property under test is *what was stored*. It is not that here: what is
 * under test is **which part of the page was rendered**, and the decoder has no
 * opinion about that. The dimensions are read a second way regardless, from the
 * PNG's own header through `pdf-lib`, so the size claim does not rest on MuPDF
 * at all.
 *
 * ## Three fixtures, for the reason `pageAnnotations.test.ts` has three
 *
 * An upright page whose box starts at the origin makes *flip y* and *translate
 * by the crop origin* and *turn by /Rotate* all invisible or identical.
 */

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const YELLOW = [255, 255, 0] as const;

/**
 * A 200×300 page: four quadrants, each one colour.
 *
 * PDF space is y-up, so the first rectangle is the BOTTOM-left. Named by where
 * a reader sees them, which is the frame every assertion below is written in.
 */
async function fixture({
  crop,
  rotate,
}: { readonly crop?: readonly number[]; readonly rotate?: number } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([200, 300]);
  page.drawRectangle({ x: 0, y: 0, width: 100, height: 150, color: rgb(1, 0, 0) }); // lower left
  page.drawRectangle({ x: 100, y: 0, width: 100, height: 150, color: rgb(0, 1, 0) }); // lower right
  page.drawRectangle({ x: 0, y: 150, width: 100, height: 150, color: rgb(0, 0, 1) }); // upper left
  page.drawRectangle({ x: 100, y: 150, width: 100, height: 150, color: rgb(1, 1, 0) }); // upper right
  if (crop !== undefined) page.setCropBox(crop[0] ?? 0, crop[1] ?? 0, crop[2] ?? 0, crop[3] ?? 0);
  if (rotate !== undefined) page.node.set(page.node.context.obj('Rotate'), page.node.context.obj(rotate));
  return await document.save({ useObjectStreams: false });
}

/** Runs work against a session over these bytes, closing it either way. */
async function onSession<T>(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Snapshots one region of a fixture. */
async function snapshot(
  bytes: Uint8Array,
  rect: AnnotationRect,
  scale = 1,
  page = 0,
): Promise<ByteImage> {
  return await onSession(bytes, (session) => snapshotRegion(session, { page, rect, scale }));
}

/** The PNG's size, read from its own IHDR rather than from the writer. */
function pngSize(png: ByteImage): readonly [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // Bytes 0-7 are the signature, 8-11 the IHDR length, 12-15 its type, then the
  // two 32-bit dimensions. Read as 32 bits, so a width past 255 is not the
  // truncation a byte-wise read would silently produce.
  return [view.getUint32(16), view.getUint32(20)];
}

/** The RGB triple at one pixel of a decoded snapshot. */
function pixelAt(png: ByteImage, x: number, y: number): readonly number[] {
  const pixmap = new Image(png).toPixmap();
  try {
    const pixels = pixmap.getPixels();
    const components = pixmap.getNumberOfComponents();
    const start = (y * pixmap.getWidth() + x) * components;
    return [pixels[start] ?? -1, pixels[start + 1] ?? -1, pixels[start + 2] ?? -1];
  } finally {
    pixmap.destroy();
  }
}

/**
 * The four quadrants in PDF user space, named by where a reader sees them.
 *
 * A rectangle two points inside each quadrant's edge, so a snapshot that is off
 * by a rounding still lands in the right colour and one that is off by a
 * quadrant does not — the case is about which region, not about which pixel.
 */
const QUADRANT = {
  lowerLeft: { x0: 2, y0: 2, x1: 98, y1: 148 },
  lowerRight: { x0: 102, y0: 2, x1: 198, y1: 148 },
  upperLeft: { x0: 2, y0: 152, x1: 98, y1: 298 },
  upperRight: { x0: 102, y0: 152, x1: 198, y1: 298 },
} as const satisfies Record<string, AnnotationRect>;

describe('snapshotRegion on an upright page', () => {
  it('renders the region asked for, at the size asked for', async () => {
    const png = await snapshot(await fixture(), QUADRANT.upperLeft);
    expect(pngSize(png)).toStrictEqual([96, 146]);
  });

  it('RENDERS A DIFFERENT REGION FOR A DIFFERENT RECTANGLE, which size cannot say', async () => {
    // THE CASE THE DIMENSIONS CANNOT MAKE. A snapshot that ignored the rectangle
    // and rendered the whole page scaled to fit would answer the right size for
    // both of these and the same colour for both — so the assertion is that the
    // two DIFFER, and that each is the colour its own quadrant carries.
    const bytes = await fixture();
    const upper = await snapshot(bytes, QUADRANT.upperLeft);
    const lower = await snapshot(bytes, QUADRANT.lowerRight);
    expect(pixelAt(upper, 10, 10)).toStrictEqual([...BLUE]);
    expect(pixelAt(lower, 10, 10)).toStrictEqual([...GREEN]);
  });

  it('reads the OTHER two quadrants too, so no pair of them is one answer', async () => {
    const bytes = await fixture();
    expect(pixelAt(await snapshot(bytes, QUADRANT.lowerLeft), 10, 10)).toStrictEqual([...RED]);
    expect(pixelAt(await snapshot(bytes, QUADRANT.upperRight), 10, 10)).toStrictEqual([
      ...YELLOW,
    ]);
  });

  it('scales the pixels and NOT the region, which is what a scale means here', async () => {
    // The same rectangle at 2× is twice the pixels of the SAME part of the
    // page — not the same pixels covering half the area. The colour is what
    // separates those: a snapshot that scaled the region instead would spill
    // into the quadrant next door.
    const bytes = await fixture();
    const png = await snapshot(bytes, QUADRANT.upperLeft, 2);
    expect(pngSize(png)).toStrictEqual([192, 292]);
    expect(pixelAt(png, 10, 10)).toStrictEqual([...BLUE]);
    expect(pixelAt(png, 180, 280)).toStrictEqual([...BLUE]);
  });

  it('is not upside down, which a page-height flip would make it', async () => {
    // A REGION SPANNING THE SEAM, so the two halves of one snapshot say which
    // way up it is. The upper half must be blue and the lower red; a snapshot
    // flipped about the page's height has the same size and swaps them.
    const png = await snapshot(await fixture(), { x0: 2, y0: 2, x1: 98, y1: 298 });
    expect(pngSize(png)).toStrictEqual([96, 296]);
    expect(pixelAt(png, 10, 10)).toStrictEqual([...BLUE]);
    expect(pixelAt(png, 10, 285)).toStrictEqual([...RED]);
  });

  it('takes an UNORDERED rectangle, because a drag runs whichever way', async () => {
    const bytes = await fixture();
    const forwards = await snapshot(bytes, QUADRANT.upperLeft);
    const backwards = await snapshot(bytes, { x0: 98, y0: 298, x1: 2, y1: 152 });
    expect(pngSize(backwards)).toStrictEqual(pngSize(forwards));
    expect(pixelAt(backwards, 10, 10)).toStrictEqual([...BLUE]);
  });
});

describe('snapshotRegion on the shapes an upright page hides', () => {
  it('follows a /CropBox at a NON-ZERO origin', async () => {
    // The crop keeps the upper half of the page, whose origin is (0, 150) in
    // PDF space. A snapshot that ignored the translation renders from the
    // page's origin instead and answers RED — the same size, the wrong half.
    const bytes = await fixture({ crop: [0, 150, 200, 300] });
    const png = await snapshot(bytes, { x0: 2, y0: 152, x1: 98, y1: 298 });
    expect(pixelAt(png, 10, 10)).toStrictEqual([...BLUE]);
  });

  it('follows /Rotate 90, where the region turns with the page', async () => {
    // AT 90° THE READER'S UPPER LEFT IS THE PAGE'S LOWER LEFT. The rectangle is
    // still stated in PDF user space, so this asks for the same quadrant and
    // the snapshot must still be red — what changes is the SHAPE, since a
    // 96×146 region of an upright page is 146×96 once the page is turned.
    const bytes = await fixture({ rotate: 90 });
    const png = await snapshot(bytes, QUADRANT.lowerLeft);
    expect(pngSize(png)).toStrictEqual([146, 96]);
    expect(pixelAt(png, 10, 10)).toStrictEqual([...RED]);
  });

  it('CONTROL: the same rectangle on an UPRIGHT page is the other way round', async () => {
    // Without this the case above passes for a build that ignores /Rotate and
    // happens to be handed a square-ish region — the dimensions only say
    // something because they are different from the unrotated ones.
    const png = await snapshot(await fixture(), QUADRANT.lowerLeft);
    expect(pngSize(png)).toStrictEqual([96, 146]);
  });
});

describe('snapshotRegion refuses', () => {
  it('a page this document does not have', async () => {
    await expect(snapshot(await fixture(), QUADRANT.upperLeft, 1, 9)).rejects.toThrow(
      /outside this document/u,
    );
  });

  it('a region with no extent, rather than writing a PNG nothing opens', async () => {
    await expect(
      snapshot(await fixture(), { x0: 40, y0: 40, x1: 40, y1: 90 }),
    ).rejects.toThrow(/no width or no height/u);
  });

  it('a scale outside its bounds, at both ends', async () => {
    const bytes = await fixture();
    await expect(snapshot(bytes, QUADRANT.upperLeft, MIN_SNAPSHOT_SCALE - 0.5)).rejects.toThrow(
      /snapshot scale/u,
    );
    await expect(snapshot(bytes, QUADRANT.upperLeft, MAX_SNAPSHOT_SCALE + 1)).rejects.toThrow(
      /snapshot scale/u,
    );
  });

  it('CONTROL: a scale AT each bound is served, so the refusal is not "everything"', async () => {
    // The partner every bound needs: a comparison written the wrong way round
    // refuses every scale, and the three refusals above read as rigour while
    // the feature does nothing.
    const bytes = await fixture();
    expect(pngSize(await snapshot(bytes, QUADRANT.upperLeft, MIN_SNAPSHOT_SCALE))).toStrictEqual([
      96, 146,
    ]);
    expect(
      pngSize(await snapshot(bytes, QUADRANT.upperLeft, MAX_SNAPSHOT_SCALE))[0],
    ).toBeGreaterThan(96);
  });

  it('a snapshot past the pixel bound, naming the count', async () => {
    // A REGION THAT IS LEGAL AND A SCALE THAT IS LEGAL, whose product is not —
    // which is the whole reason the bound is on the product. A page-sized
    // region at the maximum scale is 1600×2400 and well inside it, so the
    // fixture is a page big enough that the two legal numbers multiply past the
    // limit.
    const document = await PDFDocument.create();
    document.addPage([14_000, 14_000]);
    const huge = await document.save({ useObjectStreams: false });
    await expect(
      snapshot(huge, { x0: 0, y0: 0, x1: 14_000, y1: 14_000 }, MAX_SNAPSHOT_SCALE),
    ).rejects.toThrow(new RegExp(String(MAX_SNAPSHOT_PIXELS), 'u'));
  });
});
