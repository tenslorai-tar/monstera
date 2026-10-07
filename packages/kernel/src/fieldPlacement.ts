/**
 * Where a field copied onto another page goes: the same PLACE on the page, not the same numbers.
 *
 * ## Why the numbers are not the place
 *
 * A widget's `/Rect` is in its page's default user space, whose origin and extent are that page's own box. The same
 * four numbers on a page of another size, another origin or another rotation sit somewhere else, or off the page (a
 * copy from a Letter page onto a smaller one was placed past its edge, where nothing shows it and nothing selects it).
 * So the place is read as a FRACTION of the visible page, the way a person sees it, and written back in the target's
 * own space.
 *
 * ## The visible frame
 *
 * A page shows its box rotated by `/Rotate`, so the fraction is taken in that rotated frame, from the top left: a field
 * a third of the way down a page that is turned a quarter is a third of the way down on the page it is copied to,
 * whatever its own `/Rotate`. The box is the crop box where there is one (what a viewer shows), else the media box.
 *
 * The field keeps its SIZE in points and its CENTRE keeps its fraction, then it is moved inside the page where that
 * would put an edge outside it. A field larger than the page is cut to the page, so a copy is always visible and never
 * refused for where it lands.
 */

/** A page's visible area in user space and how it is turned. */
export interface PageFrame {
  /** The box's lower left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `/Rotate`, as a multiple of 90 in `0..270`. */
  readonly rotation: 0 | 90 | 180 | 270;
}

/** A rectangle in user space, `x0 <= x1` and `y0 <= y1`. */
export interface PlacedRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A point as a fraction of the visible page, from its top left: `u` across and `v` down, each `0..1` on the page. */
interface Unit {
  readonly u: number;
  readonly v: number;
}

function toUnit(frame: PageFrame, x: number, y: number): Unit {
  const across = (x - frame.x) / frame.width;
  const up = (y - frame.y) / frame.height;
  switch (frame.rotation) {
    case 0:
      return { u: across, v: 1 - up };
    case 90:
      return { u: up, v: across };
    case 180:
      return { u: 1 - across, v: up };
    case 270:
      return { u: 1 - up, v: 1 - across };
  }
}

function fromUnit(frame: PageFrame, point: Unit): { readonly x: number; readonly y: number } {
  switch (frame.rotation) {
    case 0:
      return { x: frame.x + point.u * frame.width, y: frame.y + (1 - point.v) * frame.height };
    case 90:
      return { x: frame.x + point.v * frame.width, y: frame.y + point.u * frame.height };
    case 180:
      return { x: frame.x + (1 - point.u) * frame.width, y: frame.y + point.v * frame.height };
    case 270:
      return { x: frame.x + (1 - point.v) * frame.width, y: frame.y + (1 - point.u) * frame.height };
  }
}

/** The rotation a page declares as one of the four it can show, whatever the file wrote (`-90`, `450`, `45`). */
export function rotationOf(angle: number): PageFrame['rotation'] {
  const turned = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return turned === 90 || turned === 180 || turned === 270 ? turned : 0;
}

/**
 * `rect` as placed on `from`, put at the same place on `to`.
 *
 * A page with no area (a zero or negative extent a hostile file may declare) has no place to be a fraction of, so the
 * rectangle is returned as it is: there is nothing to move it relative to.
 */
export function placeOnPage(rect: PlacedRect, from: PageFrame, to: PageFrame): PlacedRect {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return rect;
  const centre = toUnit(from, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
  const there = fromUnit(to, centre);
  // The size is in points as a person sees it, so a field on a page turned a quarter keeps its look on one that is not:
  // it is read from the rectangle in the source's visible frame and written in the target's. A field never outgrows
  // the page it lands on.
  const seenSideways = (frame: PageFrame): boolean => frame.rotation === 90 || frame.rotation === 270;
  const visible = { width: seenSideways(from) ? rect.y1 - rect.y0 : rect.x1 - rect.x0, height: seenSideways(from) ? rect.x1 - rect.x0 : rect.y1 - rect.y0 };
  const room = { width: seenSideways(to) ? to.height : to.width, height: seenSideways(to) ? to.width : to.height };
  const shown = { width: Math.min(visible.width, room.width), height: Math.min(visible.height, room.height) };
  const width = seenSideways(to) ? shown.height : shown.width;
  const height = seenSideways(to) ? shown.width : shown.height;
  const x0 = Math.min(Math.max(there.x - width / 2, to.x), to.x + to.width - width);
  const y0 = Math.min(Math.max(there.y - height / 2, to.y), to.y + to.height - height);
  return { x0, y0, x1: x0 + width, y1: y0 + height };
}
