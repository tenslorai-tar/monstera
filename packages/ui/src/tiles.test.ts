import { describe, expect, it } from 'vitest';

import { TILE_SIDE, tilesCovering } from './tiles.js';

/**
 * The tile grid (E1). Every case's page is sized so its last column and row are PARTIAL tiles — a page that is a
 * whole number of tiles is the fixture a clipping bug passes.
 */
const PAGE = { width: TILE_SIDE * 5 + 100, height: TILE_SIDE * 7 + 37 };

describe('tilesCovering', () => {
  it('covers the visible part with the cells it touches and one cell of margin, keyed by cell', () => {
    // Visible: inside cell (2,3) exactly, so the margin makes a 3 × 3 block around it.
    const tiles = tilesCovering(PAGE, { x: TILE_SIDE * 2 + 10, y: TILE_SIDE * 3 + 10, width: 50, height: 50 });

    expect(tiles.map((tile) => tile.key)).toStrictEqual(['1,2', '2,2', '3,2', '1,3', '2,3', '3,3', '1,4', '2,4', '3,4']);
    expect(tiles[4]).toStrictEqual({ key: '2,3', x: TILE_SIDE * 2, y: TILE_SIDE * 3, width: TILE_SIDE, height: TILE_SIDE });
  });

  it('clips the last column and row to the page, so no tile asks PDF.js for pixels past its edge', () => {
    const tiles = tilesCovering(PAGE, { x: PAGE.width - 1, y: PAGE.height - 1, width: 500, height: 500 });
    const corner = tiles.find((tile) => tile.key === '5,7');

    expect(corner).toStrictEqual({ key: '5,7', x: TILE_SIDE * 5, y: TILE_SIDE * 7, width: 100, height: 37 });
    // AND NOTHING BEYOND IT: the margin does not invent a column 6 or a row 8.
    expect(tiles.every((tile) => tile.x + tile.width <= PAGE.width && tile.y + tile.height <= PAGE.height)).toBe(true);
    expect(tiles.map((tile) => tile.key)).not.toContain('6,7');
  });

  it('clamps at the page’s origin: a view starting above and left of the page has no negative cells', () => {
    const tiles = tilesCovering(PAGE, { x: -400, y: -900, width: 450, height: 950 });

    expect(tiles.map((tile) => tile.key)).toStrictEqual(['0,0', '1,0', '0,1', '1,1']);
  });

  it('needs NO tiles for a page scrolled wholly out of view — the memory a scroll gives back', () => {
    expect(tilesCovering(PAGE, { x: 0, y: PAGE.height + 10, width: 1920, height: 1080 })).toStrictEqual([]);
    expect(tilesCovering(PAGE, { x: -2000, y: 0, width: 1000, height: 1080 })).toStrictEqual([]);
  });

  it('a view ENDING exactly on a cell boundary does not reach into the next cell', () => {
    // [0, TILE_SIDE) is cell 0 alone; margin 0 so the margin cannot hide an off-by-one.
    const tiles = tilesCovering(PAGE, { x: 0, y: 0, width: TILE_SIDE, height: TILE_SIDE }, 0);

    expect(tiles.map((tile) => tile.key)).toStrictEqual(['0,0']);
  });

  it('THE BOUND: however large the page, the tiles follow the view — a 4K view on a sheet the size of a wall', () => {
    const wall = { width: 200_000, height: 150_000 };
    const view = { x: 90_000, y: 70_000, width: 3840, height: 2160 };
    const tiles = tilesCovering(wall, view);

    // ceil(3840/512)+1 columns touched at most, plus a margin each side; the same for rows.
    const most = (Math.ceil(3840 / TILE_SIDE) + 1 + 2) * (Math.ceil(2160 / TILE_SIDE) + 1 + 2);
    expect(tiles.length).toBeLessThanOrEqual(most);
    // CONTROL for the bound: the whole page would be thousands of tiles, so the bound above is not the page's size.
    expect(Math.ceil(wall.width / TILE_SIDE) * Math.ceil(wall.height / TILE_SIDE)).toBeGreaterThan(most * 100);
  });
});
