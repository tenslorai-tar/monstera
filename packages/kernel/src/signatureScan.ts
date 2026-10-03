import * as mupdf from './mupdfRaw.js';

import { MAX_SCAN_SIDE } from './host/composeChannels.js';
import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';

/**
 * A signature a person scanned into a PDF, made into the picture the plain Signature places: the first page drawn,
 * trimmed to the signature, and everything else made transparent.
 *
 * ## Where it runs
 *
 * In the compose host (ADR-0060), which holds no document: the PDF is a file a person picked, and threat model §2 keeps
 * parsing of any kind out of `main`. Main hands the bytes over and gets a PNG back, which it holds and places exactly
 * as it would a picture the person picked.
 *
 * ## The first page, at scanning resolution
 *
 * A signature scanned to PDF is one page. It is drawn at 300 dpi, the resolution a scanner's document setting uses,
 * with the long side held to {@link MAX_SCAN_SIDE} so a poster-sized page costs what a letter does. Annotations are drawn
 * too: a signature someone added with a viewer's pen is an ink annotation, and it is the signature.
 *
 * ## The paper is MEASURED, never assumed white
 *
 * Scanned paper reads 200 to 240, not 255, and a fixed threshold either keeps the paper's grain or loses a pencil
 * stroke. So the paper's brightness is the {@link PAPER_PERCENTILE}th percentile of the page's own luminance (most of a
 * signature page is paper), ink is anything below {@link INK_FRACTION} of it, and the colour-to-alpha step normalises by
 * it, so paper of any shade comes out transparent and ink keeps its colour.
 *
 * ## The signature is the ink that HANGS TOGETHER
 *
 * A scan carries dark pixels that are not the signature: a scanner's dark edge, a line printed across the form, dust.
 * Lines and edges are rows or columns that are mostly ink, which handwriting never is, and are set aside first. What
 * is left is read as connected pieces: the large ones are the signature, and a small one belongs to it when it sits
 * close by, as the dot of an i or a full stop does. A fleck of dust across the page is a small piece far away. Only
 * the kept pieces and their soft edges are drawn, so neither a printed line nor dust is in the picture, even where it
 * crosses the box the signature fills.
 */

/** A raster this module reads: 8-bit samples, `components` per pixel, rows `stride` bytes apart. */
export interface ScanRaster {
  readonly samples: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly components: number;
}

/** Where the signature is, in pixels, the paper's brightness it was measured against, and which pixels are drawn. */
export interface InkCut {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  /** Exclusive. */
  readonly y1: number;
  /** The paper's luminance, 0 to 255. */
  readonly paper: number;
  /** Over the whole raster, 1 where a pixel is the signature's ink or its soft edge, 0 where it is drawn clear. */
  readonly keep: Uint8Array;
}

/** What a scanned signature PDF answers. */
export type ScannedSignature =
  | { readonly kind: 'drawn'; readonly png: Uint8Array; readonly width: number; readonly height: number }
  /** The first page carries no ink. */
  | { readonly kind: 'blank' }
  /** It cannot be read without a password. */
  | { readonly kind: 'locked' }
  /** MuPDF cannot open it as a PDF, or it has no page to draw. */
  | { readonly kind: 'unreadable' };

/** The resolution a scanner's document setting uses, in dots per inch. */
export const SCAN_DPI = 300;

export { MAX_SCAN_SIDE };

/** The percentile of the page's luminance read as its paper: a signature covers far less than a tenth of its page. */
export const PAPER_PERCENTILE = 90;

/** Ink is darker than this fraction of the paper's luminance. */
export const INK_FRACTION = 0.75;

/** The darkest a page's paper is read as, so a page that is mostly dark is not read as dark paper with darker ink. */
const MIN_PAPER = 128;

/**
 * A row or column whose ink covers more than this fraction of it is a scanner's edge or a ruled line, never a stroke of
 * handwriting, and its ink is not the signature's.
 */
const SOLID_FRACTION = 0.5;

/** A piece of ink at least this fraction of the largest piece's area is part of the signature wherever it is. */
const CORE_FRACTION = 0.1;

/**
 * A smaller piece belongs to the signature when its box comes within this fraction of the signature's longer side —
 * an i's dot, a full stop, a second initial — and is dust when it does not.
 */
const NEAR_FRACTION = 0.15;

/**
 * A piece smaller than this, in pixels, is grain and joins nothing: at 300 dpi it is under a hundredth of an inch
 * square, where the dot of an i from a fine pen is about six pixels across.
 */
const MIN_PIECE = 9;

/** How far around the kept ink is drawn, in pixels: the antialiased edge of a stroke, which is lighter than ink. */
const FRINGE = 3;

/** Fewer ink pixels than this is a blank page with grain on it, not a signature. */
const MIN_INK_PIXELS = 64;

/** The margin left around the ink, as a fraction of its longer side, so no stroke ends at the picture's edge. */
const MARGIN_FRACTION = 0.04;

/** Coverage below this, after normalising by the paper, is paper: a scan's grain, never a stroke. */
const ALPHA_FLOOR = 0.12;

/**
 * Luminance, Rec. 601's weights in integers, of one pixel's first three samples (or its one grey sample): 0 to 255
 * INCLUSIVE, as an integer. Floored after the half is added, so white is 255 — a value rounded on top of that half is
 * 256 for white, which a byte array stores as 0 and reads as the darkest ink there is.
 */
function luminance(samples: ScanRaster['samples'], at: number, components: number): number {
  const r = samples[at] ?? 255;
  if (components < 3) return r;
  const g = samples[at + 1] ?? 255;
  const b = samples[at + 2] ?? 255;
  return Math.floor((299 * r + 587 * g + 114 * b + 500) / 1000);
}

/** The value below which `percent` of the counted pixels lie. */
function percentile(histogram: Uint32Array, count: number, percent: number): number {
  const target = (count * percent) / 100;
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value] ?? 0;
    if (seen >= target) return value;
  }
  return 255;
}

/** A box in pixels, ends exclusive. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One connected piece of ink: how many pixels, and the box they fill. */
interface Piece {
  readonly box: Box;
  area: number;
}

/** The root of `at` in a union-find forest, with the path halved on the way. */
function rootOf(parent: Int32Array, at: number): number {
  let node = at;
  while (parent[node] !== node) {
    const up = parent[node] ?? node;
    const next = parent[up] ?? up;
    parent[node] = next;
    node = next;
  }
  return node;
}

/** How far apart two boxes are, in pixels along the axis that separates them most; 0 where they touch or overlap. */
function gapBetween(a: Box, b: Box): number {
  return Math.max(0, b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
}

/**
 * Where the signature is on a drawn page, and which of its pixels to draw, or `null` where there is none.
 *
 * The paper is measured; rows and columns that are mostly ink are set aside; the rest is labelled into pieces that
 * touch, eight ways round, and the signature is the large pieces and the small ones near them (see the module's
 * comment). The cut is their box with a margin.
 */
export function inkOf(raster: ScanRaster): InkCut | null {
  const { samples, width, height, stride, components } = raster;
  if (width <= 0 || height <= 0) return null;
  const count = width * height;

  const histogram = new Uint32Array(256);
  const lum = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = luminance(samples, y * stride + x * components, components);
      lum[y * width + x] = value;
      histogram[value] = (histogram[value] ?? 0) + 1;
    }
  }
  const paper = Math.max(MIN_PAPER, percentile(histogram, count, PAPER_PERCENTILE));
  const below = paper * INK_FRACTION;

  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((lum[y * width + x] ?? 255) < below) {
        rows[y] = (rows[y] ?? 0) + 1;
        columns[x] = (columns[x] ?? 0) + 1;
      }
    }
  }

  // THE PIECES, labelled in one pass with a union-find over the four neighbours already visited. A pixel in a row or
  // column that is mostly ink is no piece's: that is a scanner's edge or a ruled line.
  const parent = new Int32Array(count).fill(-1);
  const isInk = (x: number, y: number): boolean =>
    (lum[y * width + x] ?? 255) < below &&
    (rows[y] ?? 0) <= width * SOLID_FRACTION &&
    (columns[x] ?? 0) <= height * SOLID_FRACTION;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInk(x, y)) continue;
      const at = y * width + x;
      parent[at] = at;
      const before = [x > 0 ? at - 1 : -1, y > 0 && x > 0 ? at - width - 1 : -1, y > 0 ? at - width : -1, y > 0 && x < width - 1 ? at - width + 1 : -1];
      for (const neighbour of before) {
        if (neighbour < 0 || (parent[neighbour] ?? -1) < 0) continue;
        const a = rootOf(parent, at);
        const b = rootOf(parent, neighbour);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const pieces = new Map<number, Piece>();
  for (let at = 0; at < count; at += 1) {
    if ((parent[at] ?? -1) < 0) continue;
    const root = rootOf(parent, at);
    const x = at % width;
    const y = (at - x) / width;
    const piece = pieces.get(root);
    if (piece === undefined) {
      pieces.set(root, { box: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, area: 1 });
    } else {
      piece.area += 1;
      piece.box.x0 = Math.min(piece.box.x0, x);
      piece.box.y0 = Math.min(piece.box.y0, y);
      piece.box.x1 = Math.max(piece.box.x1, x + 1);
      piece.box.y1 = Math.max(piece.box.y1, y + 1);
    }
  }
  if (pieces.size === 0) return null;

  // THE SIGNATURE: the large pieces wherever they are, then each piece of more than grain near THEM. Near the core and
  // never near what has joined it, because nearness measured against a growing box chains: on a grainy page every speck
  // is near the last one, and the cut floods the page.
  // A LOOP, never a spread: a grainy scan has a piece per speck, and that many arguments overflow the call stack.
  let largest = 0;
  for (const piece of pieces.values()) largest = Math.max(largest, piece.area);
  const kept = new Set<number>();
  let box: Box | null = null;
  for (const [root, piece] of pieces) {
    if (piece.area < largest * CORE_FRACTION) continue;
    kept.add(root);
    box = box === null ? { ...piece.box } : union(box, piece.box);
  }
  if (box === null) return null;
  const core: Box = box;
  const reach = Math.max(1, NEAR_FRACTION * Math.max(core.x1 - core.x0, core.y1 - core.y0));
  for (const [root, piece] of pieces) {
    if (kept.has(root) || piece.area < MIN_PIECE || gapBetween(core, piece.box) > reach) continue;
    kept.add(root);
    box = union(box, piece.box);
  }
  let inked = 0;
  for (const root of kept) inked += pieces.get(root)?.area ?? 0;
  if (inked < MIN_INK_PIXELS) return null;

  // WHAT IS DRAWN: the kept pieces, and FRINGE pixels round them for the antialiased edge a threshold leaves outside.
  const signature = new Uint8Array(count);
  for (let at = 0; at < count; at += 1) {
    if ((parent[at] ?? -1) >= 0 && kept.has(rootOf(parent, at))) signature[at] = 1;
  }
  const keep = new Uint8Array(count);
  for (let at = 0; at < count; at += 1) {
    if (signature[at] !== 1) continue;
    const x = at % width;
    const y = (at - x) / width;
    for (let fy = Math.max(0, y - FRINGE); fy <= Math.min(height - 1, y + FRINGE); fy += 1) {
      keep.fill(1, fy * width + Math.max(0, x - FRINGE), fy * width + Math.min(width, x + FRINGE + 1));
    }
  }
  // ACROSS A PRINTED LINE, only where a stroke CROSSES it: inside a run of solid rows a pixel is drawn when the
  // signature's ink sits both above the run and below it, near that column — and the same sideways for a run of solid
  // columns. A stroke that only touches the line then leaves no stub of it, where the fringe alone would draw one. The
  // band cleared reaches FRINGE past the run, for the line's own soft edge, and clears only fringe there: a pixel of
  // the signature's ink beside the line is never taken.
  const clearAt = (at: number): void => {
    if (signature[at] !== 1) keep[at] = 0;
  };
  /** Clears the fringe in column `x` from row `y0` to row `y1`, exclusive. */
  const clearDown = (x: number, y0: number, y1: number): void => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) clearAt(y * width + x);
  };
  /** Clears the fringe in row `y` from column `x0` to column `x1`, exclusive. */
  const clearAcross = (y: number, x0: number, x1: number): void => {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) clearAt(y * width + x);
  };
  const near = (x: number, y: number): boolean => {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      if (nx >= 0 && nx < width && y >= 0 && y < height && signature[y * width + nx] === 1) return true;
    }
    return false;
  };
  const nearAcross = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny >= 0 && ny < height && x >= 0 && x < width && signature[ny * width + x] === 1) return true;
    }
    return false;
  };
  for (const [start, end] of runsOf((y) => (rows[y] ?? 0) > width * SOLID_FRACTION, height)) {
    for (let x = 0; x < width; x += 1) {
      let above = false;
      let below = false;
      for (let d = 1; d <= FRINGE + 1; d += 1) {
        above ||= near(x, start - d);
        below ||= near(x, end - 1 + d);
      }
      if (above && below) continue;
      clearDown(x, start - FRINGE, end + FRINGE);
    }
  }
  for (const [start, end] of runsOf((x) => (columns[x] ?? 0) > height * SOLID_FRACTION, width)) {
    for (let y = 0; y < height; y += 1) {
      let left = false;
      let right = false;
      for (let d = 1; d <= FRINGE + 1; d += 1) {
        left ||= nearAcross(start - d, y);
        right ||= nearAcross(end - 1 + d, y);
      }
      if (left && right) continue;
      clearAcross(y, start - FRINGE, end + FRINGE);
    }
  }

  const margin = Math.ceil(Math.max(box.x1 - box.x0, box.y1 - box.y0) * MARGIN_FRACTION) + 2;
  return {
    x0: Math.max(0, box.x0 - margin),
    y0: Math.max(0, box.y0 - margin),
    x1: Math.min(width, box.x1 + margin),
    y1: Math.min(height, box.y1 + margin),
    paper,
    keep,
  };
}

/** The runs of consecutive indices below `length` for which `solid` holds, each as its start and exclusive end. */
function runsOf(solid: (index: number) => boolean, length: number): readonly (readonly [number, number])[] {
  const runs: [number, number][] = [];
  for (let index = 0; index < length; index += 1) {
    if (!solid(index)) continue;
    const start = index;
    while (index < length && solid(index)) index += 1;
    runs.push([start, index]);
  }
  return runs;
}

/** The smallest box holding both. */
function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * The cut as RGBA, everything but the signature transparent: each kept sample normalised by the paper, coverage read
 * as how far the darkest channel sits below it, and the colour recovered as the one that, laid over white at that
 * coverage, gives the sample. PREMULTIPLIED, because a MuPDF pixmap with alpha holds its colour that way and its PNG
 * writer divides it out.
 */
export function transparentCut(raster: ScanRaster, cut: InkCut): Uint8ClampedArray {
  const { samples, stride, components } = raster;
  const width = cut.x1 - cut.x0;
  const height = cut.y1 - cut.y0;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cut.keep[(cut.y0 + y) * raster.width + cut.x0 + x] !== 1) continue;
      const at = (cut.y0 + y) * stride + (cut.x0 + x) * components;
      const channels = [0, 1, 2].map((c) =>
        Math.min(255, ((samples[at + (components < 3 ? 0 : c)] ?? 255) * 255) / cut.paper),
      );
      const coverage = Math.max(...channels.map((value) => (255 - value) / 255));
      if (coverage <= ALPHA_FLOOR) continue;
      const alpha = (coverage - ALPHA_FLOOR) / (1 - ALPHA_FLOOR);
      const to = (y * width + x) * 4;
      channels.forEach((value, c) => {
        const colour = Math.max(0, 255 - (255 - value) / coverage);
        out[to + c] = Math.round(colour * alpha);
      });
      out[to + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** The scale the page is drawn at, in device pixels per point. */
function drawScale(width: number, height: number): number {
  const byDpi = SCAN_DPI / 72;
  const bySide = MAX_SCAN_SIDE / Math.max(width, height);
  const byPixels = Math.sqrt(MAX_SNAPSHOT_PIXELS / (width * height));
  return Math.min(byDpi, bySide, byPixels);
}

/**
 * A scanned signature PDF as the picture the plain Signature places.
 *
 * MuPDF failing to open the bytes is the file's answer, `unreadable`; a password it needs is `locked`; a first page
 * with no ink is `blank`. Anything that fails after the page is drawn is a fault in this build and throws.
 */
export function signatureFromScan(bytes: Uint8Array): ScannedSignature {
  let document: mupdf.Document;
  try {
    document = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch {
    return { kind: 'unreadable' };
  }
  try {
    // THE ONE ATTEMPT, with no password: `mupdfWriter.ts`' reason for never asking `needsPassword`, which is this
    // same call. A document with no `/Encrypt` answers it with access.
    if (document instanceof mupdf.PDFDocument && document.authenticatePassword('') === 0) return { kind: 'locked' };
    let pages: number;
    try {
      pages = document.countPages();
    } catch {
      return { kind: 'unreadable' };
    }
    if (pages < 1) return { kind: 'unreadable' };

    const page = document.loadPage(0);
    try {
      const [bx0, by0, bx1, by1] = page.getBounds();
      const width = bx1 - bx0;
      const height = by1 - by0;
      if (!(width > 0 && height > 0)) return { kind: 'unreadable' };
      const scale = drawScale(width, height);
      const drawn = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const raster: ScanRaster = {
          samples: drawn.getPixels(),
          width: drawn.getWidth(),
          height: drawn.getHeight(),
          stride: drawn.getStride(),
          components: drawn.getNumberOfComponents(),
        };
        const cut = inkOf(raster);
        if (cut === null) return { kind: 'blank' };
        const picture = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, cut.x1 - cut.x0, cut.y1 - cut.y0], true);
        try {
          picture.setPixels(transparentCut(raster, cut));
          return { kind: 'drawn', png: picture.asPNG(), width: picture.getWidth(), height: picture.getHeight() };
        } finally {
          picture.destroy();
        }
      } finally {
        drawn.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
}
