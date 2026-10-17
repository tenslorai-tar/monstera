import {
  type Box,
  type PageTransform,
  pdfPoint,
  toPdf,
  toViewport,
  viewportPoint,
} from '@monstera/shared';

import { type ClaudeImageLimits, fitsClaudeImage } from './ocrClaude.js';
import type { RecognisedLine, RecognisedPage, RecognisedWord } from './ocrRecognise.js';
import type { RecognisedCell } from './recognisedTables.js';

/**
 * A region too large for Claude, read in tiles and joined
 * ([ADR-0255](../../../docs/DECISIONS/0255-a-region-too-large-for-claude-is-read-in-tiles-and-joined.md)).
 *
 * ## Every rectangle here is in the DISPLAYED frame, at one point per unit
 *
 * The page as a reader sees it — the viewport of `pageTransform(crop, rotation, 1)`, y down, after the quarter turn —
 * because a line of text runs along its x axis whatever the page's `/Rotate`, and joining lines across a seam is a
 * question about that axis. A tile is converted to PDF user space for the snapshot that rasterises it, and a recognised
 * word's user-space box back to this frame, through the one transform ({@link toUserSpace}, {@link toDisplayed}): no
 * arithmetic of its own between the two spaces.
 */

/** How far neighbouring tiles overlap, in points: a line of ordinary text and its leading, so a word cut by one edge is whole in the next tile. */
export const TILE_OVERLAP_POINTS = 36;

/** How far neighbouring table bands overlap, in points: a table row of a few lines, so a row cut by one edge is whole in the next band. */
export const BAND_OVERLAP_POINTS = 72;

/** The most requests one read is made of; a region needing more is refused as too large, as one past the limits was. */
export const MAX_CLAUDE_TILES = 64;

/** One tile: the rectangle rasterised, and the part of it that is ITS — the cores partition the region. */
export interface Tile {
  readonly rect: Box;
  readonly core: Box;
}

/** One axis cut into overlapping spans of at most `edge`, with cores that meet at the middle of each overlap. */
function spans(start: number, end: number, edge: number, overlap: number): { from: number; to: number; coreFrom: number; coreTo: number }[] {
  const length = end - start;
  if (length <= edge) return [{ from: start, to: end, coreFrom: start, coreTo: end }];
  const count = Math.ceil((length - overlap) / (edge - overlap));
  const step = (length - edge) / (count - 1);
  const cut = Array.from({ length: count }, (_, index) => ({ from: start + index * step, to: start + index * step + edge }));
  return cut.map((span, index) => {
    const before = cut[index - 1];
    const after = cut[index + 1];
    return {
      ...span,
      coreFrom: before === undefined ? start : (span.from + before.to) / 2,
      coreTo: after === undefined ? end : (span.to + after.from) / 2,
    };
  });
}

/**
 * The largest square, in points, Claude reads unresized at `scale` — measured by the rule the route already takes
 * ({@link fitsClaudeImage}, with the snapshot's one pixel of outward rounding), not derived beside it.
 */
export function tileEdgePoints(limits: ClaudeImageLimits, scale: number): number {
  for (let points = Math.floor(limits.edge / scale); points > 0; points -= 1) {
    const pixels = Math.ceil(points * scale) + 1;
    if (fitsClaudeImage(pixels, pixels, limits)) return points;
  }
  return 0;
}

/**
 * The region cut into square tiles at `scale`, or null where it would take more than {@link MAX_CLAUDE_TILES}.
 * Square, so a tile fits whichever way the page is turned.
 */
export function squareTiles(region: Box, limits: ClaudeImageLimits, scale: number): readonly Tile[] | null {
  const edge = tileEdgePoints(limits, scale);
  if (edge <= TILE_OVERLAP_POINTS) return null;
  const across = spans(region.x0, region.x1, edge, TILE_OVERLAP_POINTS);
  const down = spans(region.y0, region.y1, edge, TILE_OVERLAP_POINTS);
  if (across.length * down.length > MAX_CLAUDE_TILES) return null;
  return down.flatMap((row) =>
    across.map((column) => ({
      rect: { x0: column.from, y0: row.from, x1: column.to, y1: row.to },
      core: { x0: column.coreFrom, y0: row.coreFrom, x1: column.coreTo, y1: row.coreTo },
    })),
  );
}

/**
 * The page cut into full-width bands for a table read: the largest scale from `ceiling` down to `floor` at which a
 * band of the page's whole width and at least a few rows' height fits, and the bands at it. Null where none does — a
 * page too wide to read in one band, whose columns cannot be read in pieces — or where it takes too many bands.
 */
export function tableBands(
  page: Box,
  limits: ClaudeImageLimits,
  ceiling: number,
  floor: number,
): { readonly scale: number; readonly bands: readonly Tile[] } | null {
  const width = page.x1 - page.x0;
  for (let hundredths = Math.round(ceiling * 100); hundredths >= Math.round(floor * 100); hundredths -= 1) {
    const scale = hundredths / 100;
    let tallest = 0;
    for (let points = Math.floor(limits.edge / scale); points > BAND_OVERLAP_POINTS * 2; points -= 1) {
      if (fitsClaudeImage(Math.ceil(width * scale) + 1, Math.ceil(points * scale) + 1, limits)) {
        tallest = points;
        break;
      }
    }
    if (tallest === 0) continue;
    const down = spans(page.y0, page.y1, tallest, BAND_OVERLAP_POINTS);
    if (down.length > MAX_CLAUDE_TILES) return null;
    return {
      scale,
      bands: down.map((row) => ({
        rect: { x0: page.x0, y0: row.from, x1: page.x1, y1: row.to },
        core: { x0: page.x0, y0: row.coreFrom, x1: page.x1, y1: row.coreTo },
      })),
    };
  }
  return null;
}

/** A displayed rectangle as the user-space box its corners span — the rectangle a snapshot is asked for. */
export function toUserSpace(rect: Box, transform: PageTransform): Box {
  const corners = [
    toPdf(viewportPoint(rect.x0, rect.y0), transform),
    toPdf(viewportPoint(rect.x1, rect.y0), transform),
    toPdf(viewportPoint(rect.x1, rect.y1), transform),
    toPdf(viewportPoint(rect.x0, rect.y1), transform),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A user-space box as the displayed rectangle its corners span. */
export function toDisplayed(box: readonly [number, number, number, number], transform: PageTransform): Box {
  const corners = [
    toViewport(pdfPoint(box[0], box[1]), transform),
    toViewport(pdfPoint(box[2], box[1]), transform),
    toViewport(pdfPoint(box[2], box[3]), transform),
    toViewport(pdfPoint(box[0], box[3]), transform),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const inside = (x: number, y: number, box: Box): boolean => x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;

/** A line rebuilt from the words it kept, its box their extent, its text their words joined with a space. */
function lineOf(words: readonly RecognisedWord[]): RecognisedLine {
  const xs = words.flatMap((word) => [word.box[0], word.box[2]]);
  const ys = words.flatMap((word) => [word.box[1], word.box[3]]);
  return {
    text: words.map((word) => word.text).join(' '),
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    words,
  };
}

/**
 * The tiles' recognitions as one page (ADR-0255 Decision 2). A word is kept from the tile whose core holds its box's
 * centre, in the displayed frame; a line keeps the words it has left. Then a line ending at a tile's right seam and one
 * starting at the next tile's left seam on the same row — their boxes overlapping by half the smaller height — are one
 * line, left to right as displayed.
 */
export function joinRecognised(
  parts: readonly { readonly core: Box; readonly page: RecognisedPage }[],
  transform: PageTransform,
): RecognisedPage {
  /** A kept line, the tile it came from, and its box as displayed. */
  interface Kept {
    readonly tile: number;
    readonly line: RecognisedLine;
    readonly shown: Box;
  }
  const kept: Kept[] = [];
  let words = 0;
  let confidence = 0;
  const languages = new Set<RecognisedPage['languages'][number]>();
  for (const [tile, part] of parts.entries()) {
    for (const language of part.page.languages) languages.add(language);
    for (const line of part.page.lines) {
      const mine = line.words.filter((word) => {
        const shown = toDisplayed(word.box, transform);
        return inside((shown.x0 + shown.x1) / 2, (shown.y0 + shown.y1) / 2, part.core);
      });
      if (mine.length === 0) continue;
      words += mine.length;
      confidence += part.page.confidence * mine.length;
      const rebuilt = lineOf(mine);
      kept.push({ tile, line: rebuilt, shown: toDisplayed(rebuilt.box, transform) });
    }
  }

  // ACROSS A SEAM: the left half ends within one line's height of its tile's right core edge, the right half starts
  // within one of the left edge of the tile whose core begins there, and the two share a row.
  const joined: Kept[] = [];
  const used = new Set<number>();
  const order = [...kept.keys()].sort((a, b) => (kept[a]?.shown.x0 ?? 0) - (kept[b]?.shown.x0 ?? 0));
  /** The kept line that continues `here` across its tile's right seam, if one does. */
  const continuation = (here: Kept): number | undefined => {
    const core = parts[here.tile]?.core;
    if (core === undefined) return undefined;
    const height = here.shown.y1 - here.shown.y0;
    if (core.x1 - here.shown.x1 > height) return undefined;
    return order.find((candidate): boolean => {
      if (used.has(candidate)) return false;
      const other = kept[candidate];
      const otherCore = other === undefined ? undefined : parts[other.tile]?.core;
      if (other === undefined || otherCore === undefined || other.tile === here.tile) return false;
      if (Math.abs(otherCore.x0 - core.x1) > 0.5 || otherCore.y0 > here.shown.y1 || otherCore.y1 < here.shown.y0) return false;
      const shared = Math.min(here.shown.y1, other.shown.y1) - Math.max(here.shown.y0, other.shown.y0);
      const smaller = Math.min(height, other.shown.y1 - other.shown.y0);
      return shared >= smaller / 2 && other.shown.x0 - otherCore.x0 <= Math.max(height, other.shown.y1 - other.shown.y0);
    });
  };
  for (const index of order) {
    const first = kept[index];
    if (used.has(index) || first === undefined) continue;
    used.add(index);
    let current: Kept = first;
    for (let next = continuation(current); next !== undefined; next = continuation(current)) {
      const other = kept[next];
      if (other === undefined) break;
      used.add(next);
      const line = lineOf([...current.line.words, ...other.line.words]);
      current = { tile: other.tile, line, shown: toDisplayed(line.box, transform) };
    }
    joined.push(current);
  }

  // READING ORDER AS DISPLAYED: top to bottom, then left to right.
  joined.sort((a, b) => a.shown.y0 - b.shown.y0 || a.shown.x0 - b.shown.x0);
  return {
    lines: joined.map((each) => each.line),
    confidence: words === 0 ? 0 : confidence / words,
    languages: [...languages],
  };
}

/** One table a band read, its cells and where each of its rows is, in the displayed frame. */
export interface BandTable {
  readonly cells: readonly RecognisedCell[];
  /** Each row's top and bottom, displayed, by its row index. */
  readonly rows: ReadonlyMap<number, { readonly top: number; readonly bottom: number }>;
}

/**
 * The bands' tables as the page's (ADR-0255 Decision 3). A row is kept from the band whose core holds its centre. A
 * table whose last kept row reaches its band's core bottom, followed by one whose first kept row starts at the next
 * band's core top with the same number of columns, is one table: the second's rows follow the first's, renumbered.
 */
export function joinBandTables(
  parts: readonly { readonly core: Box; readonly tables: readonly BandTable[] }[],
): readonly (readonly RecognisedCell[])[] {
  interface Kept {
    cells: RecognisedCell[];
    columns: number;
    top: number;
    bottom: number;
    band: number;
  }
  const tables: Kept[] = [];
  for (const [band, part] of parts.entries()) {
    for (const table of part.tables) {
      const keptRows = [...table.rows.entries()]
        .filter(([, place]) => {
          const centre = (place.top + place.bottom) / 2;
          return centre >= part.core.y0 && centre < part.core.y1;
        })
        .sort((a, b) => a[1].top - b[1].top);
      if (keptRows.length === 0) continue;
      const renumber = new Map(keptRows.map(([row], at) => [row, at]));
      const cells = table.cells.flatMap((cell) => {
        const at = renumber.get(cell.row);
        return at === undefined ? [] : [{ ...cell, row: at, rowSpan: Math.min(cell.rowSpan, keptRows.length - at) }];
      });
      if (cells.length === 0) continue;
      tables.push({
        cells,
        columns: Math.max(...cells.map((cell) => cell.column + cell.columnSpan)),
        top: keptRows[0]?.[1].top ?? 0,
        bottom: keptRows.at(-1)?.[1].bottom ?? 0,
        band,
      });
    }
  }

  const joined: Kept[] = [];
  for (const table of tables) {
    const last = joined.at(-1);
    const lastCore = last === undefined ? undefined : parts[last.band]?.core;
    const core = parts[table.band]?.core;
    const reachesSeam = (kept: Kept, edge: number): boolean =>
      Math.abs(kept.bottom - edge) <= BAND_OVERLAP_POINTS;
    if (
      last !== undefined &&
      lastCore !== undefined &&
      core !== undefined &&
      table.band === last.band + 1 &&
      table.columns === last.columns &&
      reachesSeam(last, lastCore.y1) &&
      Math.abs(table.top - core.y0) <= BAND_OVERLAP_POINTS
    ) {
      const offset = Math.max(...last.cells.map((cell) => cell.row + cell.rowSpan));
      last.cells.push(...table.cells.map((cell) => ({ ...cell, row: cell.row + offset })));
      last.bottom = table.bottom;
      last.band = table.band;
      continue;
    }
    joined.push({ ...table, cells: [...table.cells] });
  }
  return joined.map((table) => table.cells);
}
