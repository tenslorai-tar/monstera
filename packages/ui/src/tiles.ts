/**
 * Which parts of a page are drawn once a page is drawn in tiles (E1, `BUILD-PROMPT.md`:533;
 * `docs/ARCHITECTURE.md` §6's *"Above a zoom threshold, render tiles rather than whole pages"*).
 *
 * ## Why a whole page stops being the unit
 *
 * A canvas's backing store is its width times its height times four bytes, whatever is drawn in it. At the ladder's
 * top, 400%, an A4 page on a display at 2× is 4,760 × 6,736 device pixels — 128 MB for one page — and a drawing sheet
 * of 36 × 48 inches is 573 MB at 1×. What a reader SEES is the viewport, so a page drawn in tiles holds the tiles the
 * viewport touches and a margin, and the cost follows the window rather than the page.
 *
 * ## Device pixels, top-left origin, at one scale
 *
 * Every rectangle here is in the page's DEVICE pixels at the scale it is drawn at, counted as a canvas counts them.
 * Nothing here converts to PDF space: `renderRegion` hands PDF.js the offset and PDF.js' own viewport does the rest,
 * which is `renderPage`'s B3a argument unchanged.
 */

/** A rectangle in a page's device pixels at one scale. */
export interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One tile: its cell in the grid, as a key that is stable across scrolls, and the page pixels it holds. */
export interface Tile extends DeviceRect {
  readonly key: string;
}

/**
 * A tile's side, in device pixels. **A bound, not a measurement**: 512 × 512 × 4 bytes is 1 MiB a tile, small enough
 * that the margin around the viewport costs little and large enough that a 4K viewport is some forty tiles, not
 * hundreds of draws.
 */
export const TILE_SIDE = 512;

/**
 * The tiles a page needs: every grid cell the visible part touches, and `margin` cells around those, clipped to the
 * page. A page with no visible part needs none — it is scrolled away, and its tiles are what a bounded memory drops.
 *
 * @param page the page's size in device pixels at the scale it is drawn at
 * @param visible the part of the page on screen, in the same pixels; may extend past the page, or miss it
 * @param margin cells kept beyond the visible ones on every side, so a small scroll finds them drawn
 */
export function tilesCovering(
  page: { readonly width: number; readonly height: number },
  visible: DeviceRect,
  margin = 1,
): readonly Tile[] {
  const x0 = Math.max(0, visible.x);
  const y0 = Math.max(0, visible.y);
  const x1 = Math.min(page.width, visible.x + visible.width);
  const y1 = Math.min(page.height, visible.y + visible.height);
  if (x1 <= x0 || y1 <= y0) return [];

  const lastColumn = Math.ceil(page.width / TILE_SIDE) - 1;
  const lastRow = Math.ceil(page.height / TILE_SIDE) - 1;
  const firstC = Math.max(0, Math.floor(x0 / TILE_SIDE) - margin);
  const lastC = Math.min(lastColumn, Math.floor((x1 - 1) / TILE_SIDE) + margin);
  const firstR = Math.max(0, Math.floor(y0 / TILE_SIDE) - margin);
  const lastR = Math.min(lastRow, Math.floor((y1 - 1) / TILE_SIDE) + margin);

  const tiles: Tile[] = [];
  for (let row = firstR; row <= lastR; row += 1) {
    for (let column = firstC; column <= lastC; column += 1) {
      const x = column * TILE_SIDE;
      const y = row * TILE_SIDE;
      // A TILE'S FAR EDGES, clipped to the page's, and its size the distance between its edges — never past the page.
      const right = Math.min(x + TILE_SIDE, page.width);
      const bottom = Math.min(y + TILE_SIDE, page.height);
      tiles.push({ key: `${String(column)},${String(row)}`, x, y, width: right - x, height: bottom - y });
    }
  }
  return tiles;
}
