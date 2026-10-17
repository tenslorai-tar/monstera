import { type Box, pageTransform } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  BAND_OVERLAP_POINTS,
  MAX_CLAUDE_TILES,
  TILE_OVERLAP_POINTS,
  joinBandTables,
  joinRecognised,
  squareTiles,
  tableBands,
  tileEdgePoints,
  toUserSpace,
} from './claudeTiles.js';
import { CLAUDE_STANDARD_RESOLUTION, fitsClaudeImage } from './ocrClaude.js';
import type { RecognisedPage } from './ocrRecognise.js';

const LIMITS = CLAUDE_STANDARD_RESOLUTION;
const area = (box: Box): number => (box.x1 - box.x0) * (box.y1 - box.y0);

describe('the tiles', () => {
  it('a tile is the largest square Claude reads unresized, by the route’s own rule — one point more does not fit', () => {
    const edge = tileEdgePoints(LIMITS, 2);
    const fits = (points: number): boolean => fitsClaudeImage(Math.ceil(points * 2) + 1, Math.ceil(points * 2) + 1, LIMITS);
    expect(edge).toBeGreaterThan(TILE_OVERLAP_POINTS);
    expect(fits(edge)).toBe(true);
    expect(fits(edge + 1)).toBe(false);
  });

  it('cut a large region into tiles that each fit and whose cores cover it exactly once', () => {
    const region = { x0: 10, y0: 20, x1: 1810, y1: 1220 };
    const tiles = squareTiles(region, LIMITS, 2) ?? [];
    expect(tiles.length).toBeGreaterThan(4);
    const edge = tileEdgePoints(LIMITS, 2);
    for (const tile of tiles) {
      expect(tile.rect.x1 - tile.rect.x0).toBeLessThanOrEqual(edge + 1e-9);
      expect(tile.rect.y1 - tile.rect.y0).toBeLessThanOrEqual(edge + 1e-9);
    }
    // THE CORES PARTITION THE REGION: their areas sum to its area, and each is inside its own tile.
    expect(tiles.reduce((sum, tile) => sum + area(tile.core), 0)).toBeCloseTo(area(region), 6);
    for (const tile of tiles) {
      expect(tile.core.x0).toBeGreaterThanOrEqual(tile.rect.x0);
      expect(tile.core.x1).toBeLessThanOrEqual(tile.rect.x1);
    }
    // NEIGHBOURS OVERLAP: the second tile starts before the first ends.
    const [first, second] = tiles;
    expect((first?.rect.x1 ?? 0) - (second?.rect.x0 ?? 0)).toBeGreaterThanOrEqual(TILE_OVERLAP_POINTS - 1e-9);
  });

  it('CONTROL: a region that fits is one tile, itself', () => {
    const region = { x0: 0, y0: 0, x1: 200, y1: 100 };
    expect(squareTiles(region, LIMITS, 2)).toStrictEqual([{ rect: region, core: region }]);
  });

  it('a region needing more than the bound is refused as too large', () => {
    const edge = tileEdgePoints(LIMITS, 2);
    const huge = { x0: 0, y0: 0, x1: edge * 10, y1: edge * 10 };
    expect(squareTiles(huge, LIMITS, 2)).toBeNull();
    expect(MAX_CLAUDE_TILES).toBeLessThan(100);
  });

  it('a page is read in full-width bands, and one too wide for any band at the floor is refused', () => {
    const tall = tableBands({ x0: 0, y0: 0, x1: 612, y1: 4000 }, LIMITS, 2, 1);
    expect(tall?.bands.length).toBeGreaterThan(1);
    for (const band of tall?.bands ?? []) expect(band.rect.x1 - band.rect.x0).toBe(612);
    expect(tableBands({ x0: 0, y0: 0, x1: 5000, y1: 800 }, LIMITS, 2, 1)).toBeNull();
  });
});

/** A one-word-per-entry page, its boxes given in USER SPACE. */
function pageOf(lines: readonly (readonly { text: string; box: readonly [number, number, number, number] }[])[]): RecognisedPage {
  return {
    lines: lines.map((words) => ({
      text: words.map((word) => word.text).join(' '),
      box: [
        Math.min(...words.map((word) => word.box[0])),
        Math.min(...words.map((word) => word.box[1])),
        Math.max(...words.map((word) => word.box[2])),
        Math.max(...words.map((word) => word.box[3])),
      ],
      words: words.map((word) => ({ ...word, confidence: 0 })),
    })),
    confidence: 90,
    languages: ['eng'],
  };
}

describe('the text is joined', () => {
  // A 1000 × 400 page, upright: displayed y = 400 − user y. Two tiles side by side, the seam of their cores at x 500.
  const upright = pageTransform({ x0: 0, y0: 0, x1: 1000, y1: 400 }, 0, 1);
  const left = { x0: 0, y0: 0, x1: 500, y1: 400 };
  const right = { x0: 500, y0: 0, x1: 1000, y1: 400 };
  /** A word at a DISPLAYED box, given in user space as the recogniser answers it. */
  const word = (text: string, x0: number, y0: number, x1: number, y1: number) => {
    const user = toUserSpace({ x0, y0, x1, y1 }, upright);
    return { text, box: [user.x0, user.y0, user.x1, user.y1] as const };
  };

  it('a line cut by the seam is one line, and the overlap’s words are read once', () => {
    const page = joinRecognised(
      [
        // THE LEFT TILE read past its core: "brown" centres at 530, in the right tile's core, so it is the right's.
        { core: left, page: pageOf([[word('The', 420, 100, 450, 112), word('quick', 455, 100, 495, 112), word('brown', 505, 100, 555, 112)]]) },
        { core: right, page: pageOf([[word('brown', 505, 100, 555, 112), word('fox', 560, 100, 590, 112)]]) },
      ],
      upright,
    );
    expect(page.lines.map((line) => line.text)).toStrictEqual(['The quick brown fox']);
  });

  it('CONTROL: a line on another row of the next tile is not joined to it', () => {
    const page = joinRecognised(
      [
        { core: left, page: pageOf([[word('The', 420, 100, 450, 112), word('quick', 455, 100, 495, 112)]]) },
        { core: right, page: pageOf([[word('Lower', 505, 200, 555, 212)]]) },
      ],
      upright,
    );
    expect(page.lines.map((line) => line.text)).toStrictEqual(['The quick', 'Lower']);
  });

  it('on a TURNED page the join follows the displayed row, not user space’s x', () => {
    // /Rotate 90: the displayed page is 400 wide and 1000 tall; the tiles are side by side AS DISPLAYED.
    const turned = pageTransform({ x0: 0, y0: 0, x1: 1000, y1: 400 }, 90, 1);
    const at = (text: string, x0: number, y0: number, x1: number, y1: number) => {
      const user = toUserSpace({ x0, y0, x1, y1 }, turned);
      return { text, box: [user.x0, user.y0, user.x1, user.y1] as const };
    };
    const page = joinRecognised(
      [
        { core: { x0: 0, y0: 0, x1: 200, y1: 1000 }, page: pageOf([[at('Left', 150, 300, 195, 312)]]) },
        { core: { x0: 200, y0: 0, x1: 400, y1: 1000 }, page: pageOf([[at('right', 205, 300, 250, 312)]]) },
      ],
      turned,
    );
    expect(page.lines.map((line) => line.text)).toStrictEqual(['Left right']);
  });
});

describe('a table continues across a band', () => {
  const cell = (row: number, column: number, text: string) => ({ row, column, rowSpan: 1, columnSpan: 1, text });
  const bandA = { x0: 0, y0: 0, x1: 600, y1: 400 };
  const bandB = { x0: 0, y0: 400, x1: 600, y1: 800 };

  it('rows reaching the seam on both sides, with the same columns, are one table, and the overlap row is read once', () => {
    const joined = joinBandTables([
      {
        core: bandA,
        tables: [
          {
            cells: [cell(0, 0, 'a'), cell(0, 1, '1'), cell(1, 0, 'b'), cell(1, 1, '2'), cell(2, 0, 'c'), cell(2, 1, '3')],
            // ROW 2 CENTRES AT 420, in the next band's core: it is the next band's.
            rows: new Map([
              [0, { top: 340, bottom: 370 }],
              [1, { top: 370, bottom: 400 }],
              [2, { top: 405, bottom: 435 }],
            ]),
          },
        ],
      },
      {
        core: bandB,
        tables: [
          {
            cells: [cell(0, 0, 'c'), cell(0, 1, '3'), cell(1, 0, 'd'), cell(1, 1, '4')],
            rows: new Map([
              [0, { top: 405, bottom: 435 }],
              [1, { top: 435, bottom: 465 }],
            ]),
          },
        ],
      },
    ]);
    expect(joined).toHaveLength(1);
    expect((joined[0] ?? []).filter((each) => each.column === 0).map((each) => each.text)).toStrictEqual(['a', 'b', 'c', 'd']);
    expect(BAND_OVERLAP_POINTS).toBeGreaterThan(0);
  });

  it('CONTROL: a table with other columns after the seam is a table of its own', () => {
    const joined = joinBandTables([
      { core: bandA, tables: [{ cells: [cell(0, 0, 'a'), cell(0, 1, '1')], rows: new Map([[0, { top: 360, bottom: 395 }]]) }] },
      { core: bandB, tables: [{ cells: [cell(0, 0, 'x')], rows: new Map([[0, { top: 405, bottom: 430 }]]) }] },
    ]);
    expect(joined).toHaveLength(2);
  });
});
