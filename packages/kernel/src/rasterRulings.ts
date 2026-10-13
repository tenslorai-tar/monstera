import { type GreyRaster, otsu } from './pageSkew.js';

/**
 * The ruled tables of a page that is a picture, read from its pixels
 * ([ADR-0233](../../../docs/DECISIONS/0233-a-scanned-tables-rulings-are-read-from-its-pixels.md)).
 *
 * MuPDF's table read proposes a table from the page's VECTOR paths (ADR-0073 reading 2), and a scan's rulings are pixels
 * in an image, so a printed table reaches it as unruled words (the owner's O2: a clean ruled table on a scanned page,
 * "No tables with ruled lines were found"). This finds the rulings where they are: long straight runs of ink, a ruling's
 * own shape, which a letter is not.
 *
 * Every length here is in INCHES of the page, turned into pixels by the raster's resolution, so a scan rendered at another
 * resolution finds the same rulings. Nothing is tuned to a document: the ink threshold is Otsu's (`pageSkew.ts`), and
 * each length is a property of what a ruling is (longer than a letter is tall, thinner than a filled box).
 */

/** The shortest run of ink that is a ruling: half an inch, taller than any letter of body text and most headings. */
const MIN_RULING_INCHES = 0.5;
/** The thickest band of ink that is a ruling and not a filled shape: four points. */
export const MAX_RULING_INCHES = 4 / 72;
/** A gap a scanned ruling may have and still be one line: the speckle a scanner leaves, one point. */
const GAP_INCHES = 1 / 72;
/** How far a ruling may stop short of the one it meets and still meet it: three points. */
const MEET_INCHES = 3 / 72;

/** A ruling: where it lies across, and where it runs from and to, in the raster's pixels. */
export interface Ruling {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** One ruled grid: its row edges top to bottom, its column edges left to right, and which cell sides are ruled. */
export interface RuledGrid {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  /** By row then column: whether each side of the cell has a ruling along most of it. */
  readonly borders: readonly (readonly { top: boolean; left: boolean; bottom: boolean; right: boolean }[])[];
}

/** The runs of ink along one line of pixels at least `min` long, joining across gaps of `gap` or fewer. */
function runsAlong(ink: (along: number) => boolean, length: number, min: number, gap: number): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let start = -1;
  let last = -1;
  for (let along = 0; along < length; along += 1) {
    if (!ink(along)) continue;
    if (start >= 0 && along - last - 1 <= gap) {
      last = along;
      continue;
    }
    if (start >= 0 && last - start + 1 >= min) runs.push({ from: start, to: last });
    start = along;
    last = along;
  }
  if (start >= 0 && last - start + 1 >= min) runs.push({ from: start, to: last });
  return runs;
}

/**
 * The rulings in one direction: runs found line by line, banded across neighbouring lines that overlap, and kept where the
 * band is a ruling's thickness.
 */
function rulingsOneWay(
  lines: number,
  length: number,
  ink: (line: number, along: number) => boolean,
  min: number,
  gap: number,
  thickest: number,
): Ruling[] {
  interface Band {
    first: number;
    last: number;
    from: number;
    to: number;
  }
  const open: Band[] = [];
  const closed: Band[] = [];
  for (let line = 0; line < lines; line += 1) {
    const runs = runsAlong((along) => ink(line, along), length, min, gap);
    const continued = new Set<Band>();
    for (const run of runs) {
      const band = open.find((each) => each.last === line - 1 && Math.min(each.to, run.to) - Math.max(each.from, run.from) > 0);
      if (band === undefined) {
        const made = { first: line, last: line, from: run.from, to: run.to };
        open.push(made);
        continued.add(made);
      } else {
        band.last = line;
        band.from = Math.min(band.from, run.from);
        band.to = Math.max(band.to, run.to);
        continued.add(band);
      }
    }
    for (let at = open.length - 1; at >= 0; at -= 1) {
      const band = open[at];
      if (band !== undefined && !continued.has(band)) {
        closed.push(band);
        open.splice(at, 1);
      }
    }
  }
  closed.push(...open);
  return closed
    .filter((band) => band.last - band.first + 1 <= thickest)
    .map((band) => ({ at: (band.first + band.last) / 2, from: band.from, to: band.to }));
}

/** The horizontal and vertical rulings of a raster at `dpi` pixels per inch. */
export function rulingsOf(raster: GreyRaster, dpi: number): { readonly horizontal: Ruling[]; readonly vertical: Ruling[] } {
  const { grey, width, height } = raster;
  const threshold = otsu(grey);
  const dark = (x: number, y: number): boolean => (grey[y * width + x] ?? 255) < threshold;
  const min = Math.max(2, Math.round(MIN_RULING_INCHES * dpi));
  const gap = Math.max(1, Math.round(GAP_INCHES * dpi));
  const thickest = Math.max(1, Math.round(MAX_RULING_INCHES * dpi));
  return {
    horizontal: rulingsOneWay(height, width, (y, x) => dark(x, y), min, gap, thickest),
    vertical: rulingsOneWay(width, height, (x, y) => dark(x, y), min, gap, thickest),
  };
}

/** Positions within `tolerance` of each other, as one position each: their mean. */
function clustered(positions: readonly number[], tolerance: number): number[] {
  const sorted = [...positions].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const position of sorted) {
    const last = groups.at(-1);
    const lastValue = last?.at(-1);
    if (last !== undefined && lastValue !== undefined && position - lastValue <= tolerance) last.push(position);
    else groups.push([position]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

/** How much of the stretch from `from` to `to` the rulings at `at` (within `tolerance`) cover, from 0 to 1. */
function coverage(rulings: readonly Ruling[], at: number, from: number, to: number, tolerance: number): number {
  const span = to - from;
  if (span <= 0) return 0;
  const pieces = rulings
    .filter((ruling) => Math.abs(ruling.at - at) <= tolerance)
    .map((ruling) => ({ from: Math.max(from, ruling.from - tolerance), to: Math.min(to, ruling.to + tolerance) }))
    .filter((piece) => piece.to > piece.from)
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let reached = from;
  for (const piece of pieces) {
    const start = Math.max(piece.from, reached);
    if (piece.to > start) covered += piece.to - start;
    reached = Math.max(reached, piece.to);
  }
  return covered / span;
}

/** A side counts as ruled where rulings cover most of it: a scan's line may break, and a merged cell's side is absent. */
const RULED_SIDE = 0.6;

/**
 * The ruled grids the rulings make: each set of horizontal and vertical rulings that meet one another, with at least two
 * of each, which is a table of at least one cell. A ruling that meets nothing — an underline, a page border's lone side —
 * is no table.
 */
export function gridsOf(rulings: { readonly horizontal: readonly Ruling[]; readonly vertical: readonly Ruling[] }, dpi: number): RuledGrid[] {
  const tolerance = Math.max(1, Math.round(MEET_INCHES * dpi));
  const { horizontal, vertical } = rulings;
  const parent = Array.from({ length: horizontal.length + vertical.length }, (_unused, at) => at);
  const find = (at: number): number => {
    let root = at;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[at] = root;
    return root;
  };
  horizontal.forEach((across, h) => {
    vertical.forEach((down, v) => {
      const meets =
        down.at >= across.from - tolerance && down.at <= across.to + tolerance && across.at >= down.from - tolerance && across.at <= down.to + tolerance;
      if (meets) parent[find(h)] = find(horizontal.length + v);
    });
  });
  const groups = new Map<number, { h: Ruling[]; v: Ruling[] }>();
  horizontal.forEach((ruling, h) => {
    const root = find(h);
    const group = groups.get(root) ?? { h: [], v: [] };
    group.h.push(ruling);
    groups.set(root, group);
  });
  vertical.forEach((ruling, v) => {
    const root = find(horizontal.length + v);
    const group = groups.get(root) ?? { h: [], v: [] };
    group.v.push(ruling);
    groups.set(root, group);
  });
  const grids: RuledGrid[] = [];
  for (const group of groups.values()) {
    if (group.h.length < 2 || group.v.length < 2) continue;
    const rows = clustered(
      group.h.map((ruling) => ruling.at),
      tolerance,
    );
    const columns = clustered(
      group.v.map((ruling) => ruling.at),
      tolerance,
    );
    if (rows.length < 2 || columns.length < 2) continue;
    const borders = rows.slice(0, -1).map((top, row) => {
      const bottom = rows[row + 1] ?? top;
      return columns.slice(0, -1).map((left, column) => {
        const right = columns[column + 1] ?? left;
        return {
          top: coverage(group.h, top, left, right, tolerance) >= RULED_SIDE,
          bottom: coverage(group.h, bottom, left, right, tolerance) >= RULED_SIDE,
          left: coverage(group.v, left, top, bottom, tolerance) >= RULED_SIDE,
          right: coverage(group.v, right, top, bottom, tolerance) >= RULED_SIDE,
        };
      });
    });
    grids.push({ rows, columns, borders });
  }
  // TOP TO BOTTOM, then left to right, as a reader meets them.
  return grids.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0) || (a.columns[0] ?? 0) - (b.columns[0] ?? 0));
}
