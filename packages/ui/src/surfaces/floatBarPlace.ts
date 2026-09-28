/**
 * Where the Float bar sits in the page area: the conversion from where a person put it to what is stored (the owner's
 * 27 September list, item 4). What is stored is also what is drawn — the stylesheet resolves the share against the
 * area as laid out, so there is no conversion back to pixels here to fall out of date.
 *
 * ## Stored as a share of the bar's TRAVEL, never as pixels
 *
 * A position is `x` and `y` in [0, 1] of the room the bar can move in — the page area's size less the bar's own. So
 * `{ x: 0, y: 0 }` is the top-left corner with the bar wholly inside, `{ x: 1, y: 1 }` the bottom-right, and **no
 * stored value can put the bar outside the page area at any window size**: a window that shrinks shrinks the travel,
 * and the same share lands inside the smaller room. A pixel position would have to be clamped on every resize and
 * would drift each time it was; this is B5, the out-of-bounds state not being expressible. (One reach it does not
 * make: an area SHORTER than the bar, which the window's minimum size keeps from arising — there the travel is
 * negative, and a share stored at a larger size is drawn overhanging both ends by that share.)
 *
 * `start` and `end` are the two docked places — against an edge, vertically centred, as v5 draws it — and `start`
 * is the default. A docked bar is placed by the stylesheet; a move starts from where it is DRAWN, which the bar reads
 * from its own box, so the first arrow key moves it one step from where the person sees it.
 */

/** The page area's size and the bar's, in CSS pixels. */
export interface FloatBarRoom {
  readonly areaWidth: number;
  readonly areaHeight: number;
  readonly barWidth: number;
  readonly barHeight: number;
}

/** A point in the page area's own pixels, where the bar's top-left corner goes. */
export interface FloatBarPoint {
  readonly left: number;
  readonly top: number;
}

/** How far one arrow key moves the bar, and Shift with it: the 8 px grid, and four steps of it. */
export const FLOAT_BAR_STEP = 8;
export const FLOAT_BAR_LEAP = 32;

/**
 * Where an arrow key moves the bar's corner: one step of the grid, or four with Shift — the window splitter's arrow
 * keys (WAI-ARIA APG, *Window Splitter*) on two axes, and the arrows Windows' own *Move* takes after Alt+Space.
 * `undefined` for any other key, so the caller leaves it to the page.
 */
export function nudged(point: FloatBarPoint, key: string, far: boolean): FloatBarPoint | undefined {
  const step = far ? FLOAT_BAR_LEAP : FLOAT_BAR_STEP;
  switch (key) {
    case 'ArrowLeft':
      return { left: point.left - step, top: point.top };
    case 'ArrowRight':
      return { left: point.left + step, top: point.top };
    case 'ArrowUp':
      return { left: point.left, top: point.top - step };
    case 'ArrowDown':
      return { left: point.left, top: point.top + step };
    default:
      return undefined;
  }
}

/** The room the bar can move in on one axis — never negative, so an area smaller than the bar pins it to the start. */
function travel(area: number, bar: number): number {
  return Math.max(0, area - bar);
}

const unit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A free position: each axis a share in [0, 1] of the bar's travel. What is stored, and what is DRAWN — the stylesheet
 * turns it into a place against the page area as it is laid out at that moment (`.m-quick-toolbar--free`: `left` at
 * the share of the area, less the same share of the bar), so no copy of the area's size is ever drawn from.
 */
export interface FloatBarShare {
  readonly x: number;
  readonly y: number;
}

/**
 * The stored position for a top-left corner a person asked for — a drag's, an arrow key's, a click's — clamped into
 * the room. A room with no travel on an axis answers 0 there: the bar is pinned to that edge, which is the only place
 * it can be.
 */
export function positionAt(point: FloatBarPoint, room: FloatBarRoom): FloatBarShare {
  const across = travel(room.areaWidth, room.barWidth);
  const down = travel(room.areaHeight, room.barHeight);
  return {
    x: across === 0 ? 0 : unit(point.left / across),
    y: down === 0 ? 0 : unit(point.top / down),
  };
}
