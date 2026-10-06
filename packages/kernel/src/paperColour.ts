/**
 * The paper round a box on a rendered page, and the cover that stands in for it
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)
 * Decision 9, [ADR-0187](../../../docs/DECISIONS/0187-a-scans-edited-words-are-covered-where-the-ink-is-with-the-paper-that-is-there.md)):
 * what a word on a scan is covered with, so that the words typed over it stand on the paper and not on a patch.
 *
 * ## A ring, not the box
 *
 * The box holds the ink of the words being replaced, so its own pixels are the one place the paper is not. A ring of
 * pixels just outside it is paper wherever the word is not touching its neighbour, and the MEDIAN of each channel
 * separately is the colour most of the ring is, so a stain, a fold or the ink of the next line crossing the ring moves it
 * by nothing. A scan's paper is rarely white: measured on the committed corpus pages, a cream or grey that a white patch
 * would show as a box.
 *
 * ## The box a recogniser reports is not where the ink ends
 *
 * A recogniser's box is its own estimate of a word, and a scanned letter runs past it: an ascender, a descender, the soft
 * edge of a stroke. So the cover grows from the box through the INK that touches it (a pixel that differs from the paper
 * there by more than {@link INK_THRESHOLD}, joined across a gap no wider than {@link CONNECT_POINTS}), within a cap, and
 * not by a margin that is a guess: a neighbouring word is not reached, because the gap between words is wider than the
 * gap a letter's own strokes leave.
 *
 * ## The paper behind a word is not always one colour
 *
 * A page that shades (a gradient fill, a vignette, a shadow at a fold) is not one median. The paper across a word is
 * taken as a PLANE in each channel, `value = a + b·x + c·y`, fitted to the ring by least squares with the pixels that are
 * not paper (a neighbour's ink crossing the ring) rejected and the plane fitted again, which a page's shading is across
 * one word and which a median cannot say. Where the plane's change across the box is under {@link FLAT_TOLERANCE} the
 * cover is ONE rectangle, as before; where it is not the cover is a grid of rectangles, each the plane's colour at its
 * centre.
 *
 * Pure: pixels in, a cover out, so the rule is tested without an engine.
 */

/** A pixel box in device space, `x1` and `y1` exclusive. */
export interface PixelBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A colour, each channel 0 to 255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** One rectangle of a cover, in device pixels, and the paper colour it is filled with. */
export interface PaperCell {
  readonly box: PixelBox;
  readonly colour: Rgb;
}

/** The ring's thickness in pixels: past the soft edge of a scanned word and short of the next line's ink. */
export const PAPER_RING = 3;

/** How far a pixel's channel may be from the paper there and still be paper: past a scan's grain, short of a light stroke. */
export const INK_THRESHOLD = 32;

/** The widest gap, in points, that ink is taken to run across: the space inside a letter, not the space between words. */
export const CONNECT_POINTS = 1;

/** How far past the recogniser's box the cover may grow sideways, in points. */
export const CAP_ACROSS_POINTS = 5;

/** How far it may grow up and down, as a fraction of the box's height, and at least {@link CAP_DOWN_MIN_POINTS}. */
export const CAP_DOWN_FRACTION = 0.35;
export const CAP_DOWN_MIN_POINTS = 2;

/** The widest a cell is, in points, where the paper shades; and the most cells a cover is made of in each direction. */
export const CELL_POINTS = 6;
export const MOST_ACROSS = 16;
export const MOST_DOWN = 6;

/** The most the paper may change across a box, in any channel, and still be one colour. */
export const FLAT_TOLERANCE = 14;

/**
 * The median colour of the pixels of `bgra` (four bytes a pixel, blue first, as PDFium renders) in the ring of
 * {@link PAPER_RING} pixels outside `box`, and white where the ring is wholly off the raster.
 */
export function paperColourAround(bgra: Uint8Array, width: number, height: number, box: PixelBox): Rgb {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (const [x, y] of ringOf(width, height, box)) {
    const at = (y * width + x) * 4;
    blues.push(bgra[at] ?? 255);
    greens.push(bgra[at + 1] ?? 255);
    reds.push(bgra[at + 2] ?? 255);
  }
  if (reds.length === 0) return { r: 255, g: 255, b: 255 };
  return { r: median(reds), g: median(greens), b: median(blues) };
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 255;
}

/** The pixels of the ring of {@link PAPER_RING} outside `box` that are on the raster. */
function ringOf(width: number, height: number, box: PixelBox): [number, number][] {
  const out: [number, number][] = [];
  const x0 = Math.floor(box.x0);
  const y0 = Math.floor(box.y0);
  const x1 = Math.ceil(box.x1);
  const y1 = Math.ceil(box.y1);
  for (let y = Math.max(0, y0 - PAPER_RING); y < Math.min(height, y1 + PAPER_RING); y += 1) {
    for (let x = Math.max(0, x0 - PAPER_RING); x < Math.min(width, x1 + PAPER_RING); x += 1) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** The paper across a box: a plane in each channel, `a + b·(x − centre) + c·(y − centre)`. */
interface Paper {
  /** The change across the box's width and across its height, the largest of the three channels', in channel units. */
  readonly change: number;
  readonly at: (x: number, y: number) => Rgb;
}

const CHANNELS = [2, 1, 0] as const;

/**
 * The plane of the paper round `box`, fitted to its ring by least squares with the pixels that are not paper left out
 * (`INK_THRESHOLD` from the plane, the plane fitted again) so that a neighbour's ink crossing the ring does not tilt it. A
 * ring with too few pixels to fit is the flat median, and one wholly off the raster is white.
 */
function paperAround(bgra: Uint8Array, width: number, height: number, box: PixelBox): Paper {
  const ring = ringOf(width, height, box);
  const flat = paperColourAround(bgra, width, height, box);
  const flatPaper: Paper = { change: 0, at: () => flat };
  if (ring.length < 6) return flatPaper;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const valueAt = (x: number, y: number, channel: number): number => bgra[(y * width + x) * 4 + channel] ?? 255;
  // THE START IS THE MEDIAN, so the first rejection is by distance from what most of the ring is, and the plane is only
  // ever fitted to pixels that agree about it.
  let planes: readonly (readonly [number, number, number])[] = [
    [flat.r, 0, 0],
    [flat.g, 0, 0],
    [flat.b, 0, 0],
  ];
  const model = (x: number, y: number, channel: number): number => {
    const plane = planes[CHANNELS.indexOf(channel as 0 | 1 | 2)] ?? [255, 0, 0];
    return plane[0] + plane[1] * (x - cx) + plane[2] * (y - cy);
  };
  for (const threshold of [INK_THRESHOLD * 2, INK_THRESHOLD, INK_THRESHOLD * 0.75]) {
    const inliers = ring.filter(([x, y]) => CHANNELS.every((channel) => Math.abs(valueAt(x, y, channel) - model(x, y, channel)) <= threshold));
    if (inliers.length < 6) break;
    const fitted = fitPlanes(inliers, cx, cy, valueAt);
    if (fitted === undefined) break;
    planes = fitted;
  }
  const spanX = Math.max(1, Math.ceil(box.x1) - Math.floor(box.x0));
  const spanY = Math.max(1, Math.ceil(box.y1) - Math.floor(box.y0));
  const change = Math.max(...planes.map((plane) => Math.abs(plane[1]) * spanX + Math.abs(plane[2]) * spanY));
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  return {
    change,
    at: (x, y) => ({
      r: clamp(model(x, y, 2)),
      g: clamp(model(x, y, 1)),
      b: clamp(model(x, y, 0)),
    }),
  };
}

/** The least-squares plane of each channel through `points`, or `undefined` where the points do not span a plane. */
function fitPlanes(
  points: readonly (readonly [number, number])[],
  cx: number,
  cy: number,
  valueAt: (x: number, y: number, channel: number) => number,
): readonly (readonly [number, number, number])[] | undefined {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    n += 1;
    sx += dx;
    sy += dy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  // THE NORMAL EQUATIONS, [[n sx sy] [sx sxx sxy] [sy sxy syy]]·[a b c] = [Σv Σv·dx Σv·dy], by Cramer's rule.
  const determinant = n * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) return undefined;
  return CHANNELS.map((channel) => {
    let sv = 0;
    let svx = 0;
    let svy = 0;
    for (const [x, y] of points) {
      const value = valueAt(x, y, channel);
      sv += value;
      svx += value * (x - cx);
      svy += value * (y - cy);
    }
    const a = (sv * (sxx * syy - sxy * sxy) - sx * (svx * syy - sxy * svy) + sy * (svx * sxy - sxx * svy)) / determinant;
    const b = (n * (svx * syy - sxy * svy) - sv * (sx * syy - sxy * sy) + sy * (sx * svy - svx * sy)) / determinant;
    const c = (n * (sxx * svy - svx * sxy) - sx * (sx * svy - svx * sy) + sv * (sx * sxy - sxx * sy)) / determinant;
    return [a, b, c] as const;
  });
}

/**
 * The box of the ink that touches `seed`: the seed, grown through the pixels that differ from the paper there, within the
 * caps. Where no ink is outside the seed it is the seed.
 */
export function inkExtent(bgra: Uint8Array, width: number, height: number, seed: PixelBox, pixelsPerPoint: number): PixelBox {
  const x0 = Math.floor(seed.x0);
  const y0 = Math.floor(seed.y0);
  const x1 = Math.ceil(seed.x1);
  const y1 = Math.ceil(seed.y1);
  const capAcross = Math.ceil(CAP_ACROSS_POINTS * pixelsPerPoint);
  const capDown = Math.ceil(Math.max(CAP_DOWN_MIN_POINTS * pixelsPerPoint, (y1 - y0) * CAP_DOWN_FRACTION));
  const connect = Math.max(1, Math.round(CONNECT_POINTS * pixelsPerPoint));
  const windowX0 = Math.max(0, x0 - capAcross);
  const windowY0 = Math.max(0, y0 - capDown);
  const windowX1 = Math.min(width, x1 + capAcross);
  const windowY1 = Math.min(height, y1 + capDown);
  const columns = windowX1 - windowX0;
  const rows = windowY1 - windowY0;
  if (columns <= 0 || rows <= 0) return seed;
  // THE PAPER BY THE SEED'S RING, so that on a page that shades a pixel is judged against the paper beside it and not
  // against one colour for the whole page, which would take the gradient itself for ink.
  const paper = paperAround(bgra, width, height, seed);
  const isInk = (x: number, y: number): boolean => {
    const at = (y * width + x) * 4;
    const expected = paper.at(x, y);
    return (
      Math.abs((bgra[at + 2] ?? 255) - expected.r) > INK_THRESHOLD ||
      Math.abs((bgra[at + 1] ?? 255) - expected.g) > INK_THRESHOLD ||
      Math.abs((bgra[at] ?? 255) - expected.b) > INK_THRESHOLD
    );
  };
  const seen = new Uint8Array(columns * rows);
  const queue: number[] = [];
  const index = (x: number, y: number): number => (y - windowY0) * columns + (x - windowX0);
  for (let y = Math.max(windowY0, y0); y < Math.min(windowY1, y1); y += 1) {
    for (let x = Math.max(windowX0, x0); x < Math.min(windowX1, x1); x += 1) {
      if (isInk(x, y)) {
        seen[index(x, y)] = 1;
        queue.push(x, y);
      }
    }
  }
  let left = x0;
  let top = y0;
  let right = x1;
  let bottom = y1;
  for (let head = 0; head < queue.length; head += 2) {
    const x = queue[head] ?? 0;
    const y = queue[head + 1] ?? 0;
    for (let dy = -connect; dy <= connect; dy += 1) {
      for (let dx = -connect; dx <= connect; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < windowX0 || nx >= windowX1 || ny < windowY0 || ny >= windowY1) continue;
        if (seen[index(nx, ny)] === 1 || !isInk(nx, ny)) continue;
        seen[index(nx, ny)] = 1;
        queue.push(nx, ny);
        left = Math.min(left, nx);
        top = Math.min(top, ny);
        right = Math.max(right, nx + 1);
        bottom = Math.max(bottom, ny + 1);
      }
    }
  }
  // ONE PIXEL PAST THE LAST INK PIXEL: the soft edge of a stroke is not ink by the threshold and is still not paper.
  return {
    x0: Math.max(windowX0, left - 1),
    y0: Math.max(windowY0, top - 1),
    x1: Math.min(windowX1, right + 1),
    y1: Math.min(windowY1, bottom + 1),
  };
}

/**
 * The cover for a recogniser's box on a raster: the box grown through the ink that touches it, filled with the paper
 * that is there. ONE cell where the paper round it is one colour, and a grid of cells where it shades. The cells of a
 * grid overlap their right and lower neighbour by a pixel, so a seam between two of them cannot show what is under it.
 */
export function paperCoverFor(
  bgra: Uint8Array,
  width: number,
  height: number,
  seed: PixelBox,
  pixelsPerPoint: number,
): readonly PaperCell[] {
  const grown = inkExtent(bgra, width, height, seed, pixelsPerPoint);
  const x0 = Math.floor(grown.x0);
  const y0 = Math.floor(grown.y0);
  const x1 = Math.ceil(grown.x1);
  const y1 = Math.ceil(grown.y1);
  const paper = paperAround(bgra, width, height, grown);
  if (paper.change <= FLAT_TOLERANCE) return [{ box: { x0, y0, x1, y1 }, colour: paper.at((x0 + x1) / 2, (y0 + y1) / 2) }];
  const across = Math.min(MOST_ACROSS, Math.max(1, Math.ceil((x1 - x0) / (CELL_POINTS * pixelsPerPoint))));
  const down = Math.min(MOST_DOWN, Math.max(1, Math.ceil((y1 - y0) / (CELL_POINTS * pixelsPerPoint))));
  const cells: PaperCell[] = [];
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const cx0 = x0 + Math.round(((x1 - x0) * column) / across);
      const cx1 = x0 + Math.round(((x1 - x0) * (column + 1)) / across);
      const cy0 = y0 + Math.round(((y1 - y0) * row) / down);
      const cy1 = y0 + Math.round(((y1 - y0) * (row + 1)) / down);
      cells.push({
        box: { x0: cx0, y0: cy0, x1: column < across - 1 ? cx1 + 1 : cx1, y1: row < down - 1 ? cy1 + 1 : cy1 },
        colour: paper.at((cx0 + cx1) / 2, (cy0 + cy1) / 2),
      });
    }
  }
  return cells;
}
