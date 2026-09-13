import type { CommandOfKind } from '@monstera/contract';
import * as mupdf from 'mupdf';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import { COORDINATE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { imagesOf, roundTrippable, writeGreyJpeg } from './pageEnhance.js';
import { pagesOf } from './pageScope.js';
import { otsu } from './pageSkew.js';

/**
 * D9's *Document scan (edge detection)*: a photograph of a sheet of paper, straightened
 * into a page.
 *
 * ## Where it runs, and why it is a page command
 *
 * A camera picture of a document is a sheet at an angle on a background. By the time it
 * is in a document — *New PDF from camera* or *New PDF from images* — it is an image-only
 * page, and the engine that decodes, re-encodes and rewrites a page's image is MuPDF,
 * inside the contained host, exactly as `pageEnhance.ts` does. So this is `enhancePages`'
 * shape with geometry added, and nothing here is a new engine or a new dependency.
 *
 * ## What it decides, in order
 *
 * 1. **The sheet**, in a copy of the image reduced to {@link SHEET_DETECT_SIDE} pixels on
 *    its longer side: paper is the LIGHT class of Otsu's split — `pageSkew.ts`' threshold,
 *    taken rather than written again — and the sheet is the largest connected region of
 *    it. Its corners are the extremes of *x + y* and *x − y*, which is exact for a convex
 *    quadrilateral that is not turned past 45°.
 * 2. **Whether it is a sheet at all.** A convex quadrilateral covering between
 *    {@link MIN_SHEET_FRACTION} and {@link MAX_SHEET_FRACTION} of the image. Below, what was
 *    found is not a page; above, the photograph already is the page, and "correcting" it
 *    would only resample it.
 * 3. **The perspective**: the homography taking the output rectangle to the four corners,
 *    solved exactly from the four correspondences, and the full-resolution image sampled
 *    through it bilinearly.
 * 4. **The page**: its box becomes the sheet's shape, keeping the page's longer side, and
 *    its content draws the one image to fill it.
 *
 * ## Stated assumptions
 *
 * - **The sheet is lighter than what it lies on.** A white page on a white desk has no
 *   edge to find, and is answered `no-sheet` rather than guessed at.
 * - **The result is grey**, for `pageEnhance.ts`' reason: a scan's information is its ink.
 * - **Exactly one image on the page.** A page carrying several is not a photograph of one
 *   sheet, and rewriting its content would drop the others.
 */

/** The longer side, in pixels, of the reduced copy the sheet is found in. */
export const SHEET_DETECT_SIDE = 640;

/**
 * The smallest share of the image a sheet may cover, and the largest.
 *
 * DECISIONS, NOT MEASUREMENTS, and they define the row's subject rather than tune it: a
 * fifth of the frame is a document photographed from arm's length, and past ninety-seven
 * hundredths the photograph is already cropped to the page.
 */
export const MIN_SHEET_FRACTION = 0.2;
export const MAX_SHEET_FRACTION = 0.97;

/**
 * How wide a dark mark on the sheet may be and still be closed over, as a share of the
 * reduced image's longer side.
 *
 * WHY THE PAPER IS CLOSED BEFORE IT IS LABELLED: a ruled line, a table border or a row of
 * ink that runs edge to edge across the sheet disconnects the light region into strips,
 * and the largest strip is then a small fraction of the sheet — measured on this module's
 * own fixture, where 3-row bands every 30 rows left no strip past a twentieth of the image
 * and the sheet was answered `no-sheet`. Closing (dilate, then erode) fills a dark gap
 * narrower than its window and leaves a convex outline where it was. A decision about
 * what counts as a mark on a page, stated rather than tuned.
 */
export const CLOSING_FRACTION = 1 / 100;

/**
 * A binary mask closed by a square window of `radius`: dilated, then eroded.
 *
 * Each pass is separable and uses running counts, so the cost is linear in the pixels and
 * independent of the radius. Outside the image counts as dark for the dilation and as
 * light for the erosion, so closing never grows the region past the frame or eats it at
 * the edge.
 */
function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  /** One separable pass: `keep` decides from the count of set pixels in the window. */
  const pass = (source: Uint8Array, horizontal: boolean, keep: (set: number, window: number) => boolean): Uint8Array => {
    const out = new Uint8Array(source.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const index = (line: number, along: number): number => (horizontal ? line * width + along : along * width + line);
    for (let line = 0; line < lines; line += 1) {
      const prefix = new Int32Array(length + 1);
      for (let along = 0; along < length; along += 1) {
        prefix[along + 1] = (prefix[along] ?? 0) + (source[index(line, along)] ?? 0);
      }
      for (let along = 0; along < length; along += 1) {
        const from = Math.max(0, along - radius);
        const to = Math.min(length - 1, along + radius);
        const set = (prefix[to + 1] ?? 0) - (prefix[from] ?? 0);
        out[index(line, along)] = keep(set, to - from + 1) ? 1 : 0;
      }
    }
    return out;
  };
  const anySet = (set: number): boolean => set > 0;
  const allSet = (set: number, window: number): boolean => set === window;
  const dilated = pass(pass(mask, true, anySet), false, anySet);
  return pass(pass(dilated, true, allSet), false, allSet);
}

/** A point in image pixels, x right and y down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A sheet's corners, in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

/** What straightening one page did, by name, so a caller can tell a decision from a no-op. */
export type ScanOutcome = 'straightened' | 'no-sheet' | 'not-one-image' | 'unreadable';

export interface ScannedPage {
  readonly page: number;
  readonly outcome: ScanOutcome;
}

/**
 * Each corner with the two that follow it, going round.
 *
 * NAMED TUPLES RATHER THAN INDICES into the quad, so every point is one the compiler can
 * see exists — an index read would be `Point | undefined` and need a cast to use.
 */
function turns(quad: Quad): readonly (readonly [Point, Point, Point])[] {
  const [a, b, c, d] = quad;
  return [
    [a, b, c],
    [b, c, d],
    [c, d, a],
    [d, a, b],
  ];
}

/** Twice the signed area of a quadrilateral, by the shoelace formula. */
function doubledArea(quad: Quad): number {
  let sum = 0;
  for (const [a, b] of turns(quad)) sum += a.x * b.y - b.x * a.y;
  return sum;
}

/** Whether every turn around the quadrilateral bends the same way. */
function convex(quad: Quad): boolean {
  let sign = 0;
  for (const [a, b, c] of turns(quad)) {
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    const turn = Math.sign(cross);
    if (sign !== 0 && turn !== sign) return false;
    sign = turn;
  }
  return true;
}

/**
 * The sheet's corners in a grey image, or `null` where no sheet is found.
 *
 * @param grey one byte per pixel, `width × height`, rows top to bottom
 */
export function sheetCorners(grey: Uint8Array | Uint8ClampedArray, width: number, height: number): Quad | null {
  if (grey.length !== width * height || width < 2 || height < 2) {
    throw new RangeError(`expected ${String(width * height)} grey bytes and got ${String(grey.length)}`);
  }
  const threshold = otsu(grey);
  const light = new Uint8Array(grey.length);
  for (let at = 0; at < grey.length; at += 1) light[at] = (grey[at] ?? 0) > threshold ? 1 : 0;
  const paper = closeMask(light, width, height, Math.max(1, Math.round(Math.max(width, height) * CLOSING_FRACTION)));

  // THE LARGEST CONNECTED PAPER REGION, four-connected, one pass over the closed mask.
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < grey.length; start += 1) {
    if (labels[start] !== 0 || paper[start] !== 1) continue;
    next += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = next;
    while (head < tail) {
      const at = queue[head] ?? 0;
      head += 1;
      const x = at % width;
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        at - width,
        at + width,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= grey.length) continue;
        if (labels[neighbour] !== 0 || paper[neighbour] !== 1) continue;
        labels[neighbour] = next;
        queue[tail] = neighbour;
        tail += 1;
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = next;
    }
  }
  if (best === 0) return null;

  let topLeft: Point | null = null;
  let topRight: Point | null = null;
  let bottomRight: Point | null = null;
  let bottomLeft: Point | null = null;
  for (let at = 0; at < labels.length; at += 1) {
    if (labels[at] !== best) continue;
    // PIXEL CENTRES, so a corner is where the region's pixel is rather than its edge.
    const point = { x: (at % width) + 0.5, y: Math.floor(at / width) + 0.5 };
    if (topLeft === null || point.x + point.y < topLeft.x + topLeft.y) topLeft = point;
    if (bottomRight === null || point.x + point.y > bottomRight.x + bottomRight.y) bottomRight = point;
    if (topRight === null || point.x - point.y > topRight.x - topRight.y) topRight = point;
    if (bottomLeft === null || point.x - point.y < bottomLeft.x - bottomLeft.y) bottomLeft = point;
  }
  if (topLeft === null || topRight === null || bottomRight === null || bottomLeft === null) return null;

  const quad: Quad = [topLeft, topRight, bottomRight, bottomLeft];
  if (!convex(quad)) return null;
  const share = Math.abs(doubledArea(quad)) / 2 / (width * height);
  if (share < MIN_SHEET_FRACTION || share > MAX_SHEET_FRACTION) return null;
  return quad;
}

/** The straightened sheet's size in pixels: each pair of opposite sides, the longer of the two. */
export function straightenedSize(quad: Quad): { readonly width: number; readonly height: number } {
  const [tl, tr, br, bl] = quad;
  const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
  return {
    width: Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br)))),
    height: Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br)))),
  };
}

/**
 * The homography taking a point of the `width × height` output rectangle to the image,
 * such that its corners land on the quad's — or `null` for a degenerate quad.
 *
 * Solved exactly from the four correspondences as an eight-unknown linear system, with
 * the ninth coefficient fixed at one, by Gaussian elimination with partial pivoting.
 */
export function perspectiveMap(quad: Quad, width: number, height: number): ((u: number, v: number) => Point) | null {
  const [tl, tr, br, bl] = quad;
  const correspondences: readonly (readonly [Point, Point])[] = [
    [{ x: 0, y: 0 }, tl],
    [{ x: width, y: 0 }, tr],
    [{ x: width, y: height }, br],
    [{ x: 0, y: height }, bl],
  ];

  // EIGHT ROWS OF NINE, flat: the augmented matrix of the system, one accessor for reading
  // and writing, and a row swap done column by column.
  const COLUMNS = 9;
  const matrix = new Float64Array(8 * COLUMNS);
  const get = (row: number, column: number): number => matrix[row * COLUMNS + column] ?? 0;
  const set = (row: number, column: number, value: number): void => {
    matrix[row * COLUMNS + column] = value;
  };
  let written = 0;
  for (const [{ x: u, y: v }, { x, y }] of correspondences) {
    for (const [column, value] of [u, v, 1, 0, 0, 0, -u * x, -v * x, x].entries()) set(written, column, value);
    for (const [column, value] of [0, 0, 0, u, v, 1, -u * y, -v * y, y].entries()) set(written + 1, column, value);
    written += 2;
  }

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(get(row, column)) > Math.abs(get(pivot, column))) pivot = row;
    }
    if (Math.abs(get(pivot, column)) < 1e-9) return null;
    if (pivot !== column) {
      for (let entry = 0; entry < COLUMNS; entry += 1) {
        const held = get(column, entry);
        set(column, entry, get(pivot, entry));
        set(pivot, entry, held);
      }
    }
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = get(row, column) / get(column, column);
      for (let entry = column; entry < COLUMNS; entry += 1) {
        set(row, entry, get(row, entry) - factor * get(column, entry));
      }
    }
  }
  const h0 = get(0, 8) / get(0, 0);
  const h1 = get(1, 8) / get(1, 1);
  const h2 = get(2, 8) / get(2, 2);
  const h3 = get(3, 8) / get(3, 3);
  const h4 = get(4, 8) / get(4, 4);
  const h5 = get(5, 8) / get(5, 5);
  const h6 = get(6, 8) / get(6, 6);
  const h7 = get(7, 8) / get(7, 7);
  return (u, v) => {
    const w = h6 * u + h7 * v + 1;
    return { x: (h0 * u + h1 * v + h2) / w, y: (h3 * u + h4 * v + h5) / w };
  };
}

/** One grey raster: its samples, its size, and how many bytes one row occupies. */
export interface GreySamples {
  readonly samples: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
}

/**
 * Fills `target` by sampling `source` through `map`, bilinearly, at each pixel's centre.
 *
 * A sample falling outside the source is clamped to its edge rather than read as black:
 * a corner found half a pixel outside the image is still paper.
 */
export function warpGrey(source: GreySamples, target: GreySamples, map: (u: number, v: number) => Point): void {
  const at = (x: number, y: number): number => {
    const cx = Math.min(source.width - 1, Math.max(0, x));
    const cy = Math.min(source.height - 1, Math.max(0, y));
    return source.samples[cy * source.stride + cx] ?? 0;
  };
  for (let v = 0; v < target.height; v += 1) {
    for (let u = 0; u < target.width; u += 1) {
      const { x, y } = map(u + 0.5, v + 0.5);
      const sx = x - 0.5;
      const sy = y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      target.samples[v * target.stride + u] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
}

/** A reduced copy of a grey raster, no side longer than {@link SHEET_DETECT_SIDE}, and its step. */
function reduced(source: GreySamples): { readonly grey: Uint8Array; readonly width: number; readonly height: number; readonly step: number } {
  const step = Math.max(1, Math.ceil(Math.max(source.width, source.height) / SHEET_DETECT_SIDE));
  const width = Math.max(2, Math.floor(source.width / step));
  const height = Math.max(2, Math.floor(source.height / step));
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grey[y * width + x] = source.samples[Math.min(source.height - 1, y * step) * source.stride + Math.min(source.width - 1, x * step)] ?? 0;
    }
  }
  return { grey, width, height, step };
}

/** Straightens one page, or answers why not. */
function straighten(document: PDFDocument, page: number): ScanOutcome {
  const object: PDFObject = document.loadPage(page).getObject();
  const images = imagesOf(object);
  const only = images[0];
  if (images.length !== 1 || only === undefined) return 'not-one-image';
  if (!roundTrippable(only.object)) return 'unreadable';

  let pixmap: mupdf.Pixmap;
  try {
    pixmap = new mupdf.Image(only.object.readRawStream()).toPixmap();
  } catch (error) {
    // `pageEnhance.ts`' reading of the same throw: MuPDF refuses a stream that is not a
    // format it recognises on its own, which is a property of the document. The error is
    // kept as the cause of nothing because the outcome is the whole answer.
    void error;
    return 'unreadable';
  }

  const grey = pixmap.getNumberOfComponents() === 1 ? pixmap : pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceGray, true);
  let straightened: mupdf.Pixmap | null = null;
  try {
    const source: GreySamples = {
      samples: grey.getPixels(),
      width: grey.getWidth(),
      height: grey.getHeight(),
      stride: grey.getStride(),
    };
    const small = reduced(source);
    const found = sheetCorners(small.grey, small.width, small.height);
    if (found === null) return 'no-sheet';
    const quad = found.map((point) => ({ x: point.x * small.step, y: point.y * small.step })) as unknown as Quad;

    let { width, height } = straightenedSize(quad);
    // NEVER MORE PIXELS THAN THE PHOTOGRAPH HAD: a sheet cannot carry more detail than
    // the picture it was taken from, so a skewed quad's longer sides are scaled down.
    const limit = source.width * source.height;
    if (width * height > limit) {
      const scale = Math.sqrt(limit / (width * height));
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
    const map = perspectiveMap(quad, width, height);
    if (map === null) return 'no-sheet';

    straightened = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, width, height], false);
    warpGrey(source, { samples: straightened.getPixels(), width, height, stride: straightened.getStride() }, map);
    writeGreyJpeg(only.object, straightened);

    // THE PAGE BECOMES THE SHEET'S SHAPE, keeping its longer side, and draws the one
    // image to fill it. The other boxes described the photograph's page, so they go.
    const [x0, y0, x1, y1] = document.loadPage(page).getBounds();
    const longer = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const boxWidth = width >= height ? longer : (longer * width) / height;
    const boxHeight = width >= height ? (longer * height) / width : longer;
    const box = document.newArray();
    for (const value of [0, 0, boxWidth, boxHeight]) box.push(Number(contentNumber(value, COORDINATE_DECIMALS)));
    object.put('MediaBox', box);
    object.put('CropBox', box);
    for (const key of ['TrimBox', 'BleedBox', 'ArtBox']) object.delete(key);

    const name = only.key.replace(/^\//u, '');
    const operators =
      `q\n${contentNumber(boxWidth, COORDINATE_DECIMALS)} 0 0 ${contentNumber(boxHeight, COORDINATE_DECIMALS)} 0 0 cm\n` +
      `/${name} Do\nQ\n`;
    object.put('Contents', document.addStream(new TextEncoder().encode(operators), document.newDictionary()));
    return 'straightened';
  } finally {
    straightened?.destroy();
    if (grey !== pixmap) grey.destroy();
    pixmap.destroy();
  }
}

/**
 * Straightens every named page, reporting what each came to.
 *
 * Every page is validated before the first is written, `applyEnhancePages`' rule.
 */
export function straightenedPages(
  session: MupdfSession,
  command: CommandOfKind<'straightenScans'>,
): Promise<readonly ScannedPage[]> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const targets = pagesOf(command.pages, total);
    for (const page of targets) {
      if (!Number.isInteger(page) || page < 0 || page >= total) {
        throw new RangeError(
          `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
            'Page indices are zero-based.',
        );
      }
    }
    return targets.map((page) => ({ page, outcome: straighten(document, page) }));
  });
}

/** The apply: {@link straightenedPages}, answering nothing, for `applyEnhancePages`' reason. */
export const applyStraightenScans: Apply<'mupdf', 'straightenScans'> = async (session, command) => {
  const report = await straightenedPages(session, command);
  void report;
};

/** Capture refuses: the prior state is the image and the page it was drawn on. */
export const captureStraightenScans: (
  session: MupdfSession,
  command: CommandOfKind<'straightenScans'>,
) => Promise<CaptureResult<never>> = (_session, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a straightened scan has no recordable prior state: restoring it means restoring the image ' +
      'stream, the page boxes and the content that drew it, and the image is document-scaled',
  });

/** Unreachable by the type, like every other checkpoint command's inverse. */
export const invertStraightenScans: Invert<'mupdf', 'straightenScans'> = (_session, _inverse) => {
  throw new Error(
    'straightenScans has no inverse and this is unreachable: its prior state is `never`. Undo ' +
      'restores the checkpoint the bus took.',
  );
};
