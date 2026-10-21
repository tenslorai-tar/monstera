import type { BlockPlace } from '@monstera/contract';

/**
 * Where an open block is being put: moved, scaled, rotated, and set at a new measure
 * ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md),
 * corrected 2026-10-06), kept as the INTENT the contract carries and never as a matrix.
 *
 * ## Every number is in the block's own frame, in points
 *
 * A drag arrives as a movement of the pointer on screen. Text is upright in PDF user space whatever the page's rotation
 * (an edit is offered for nothing else), so the movement is converted to PDF points by the page's one transform before
 * it reaches this module, and every function here works on the text's own axes: x along a line, y up the page. That is
 * why a block on a page shown turned is dragged the way it looks and written the way it reads.
 */

/** The corners and sides a block is dragged by, and the grip that moves it and the one that turns it. */
export type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'e' | 'w' | 'n' | 'r';

/** What has been done to the block so far. */
export interface Placement {
  /** Points added to every object of the block. */
  readonly move: { readonly x: number; readonly y: number };
  /** A factor about the block's top left. */
  readonly scale: number;
  /** Degrees about its centre, counter-clockwise. */
  readonly rotate: number;
  /** The measure the words are laid out at, in points, once the person has set one. */
  readonly width: number | undefined;
}

export const NOT_PLACED: Placement = { move: { x: 0, y: 0 }, scale: 1, rotate: 0, width: undefined };

/** The block as read, in PDF points: its box, which is where it starts and how wide it is. */
export interface BlockBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The narrowest a block may be set: a column that holds a letter, which a person can still see to widen again. */
export const MIN_MEASURE = 12;
/** The smallest and largest factor a drag may reach, inside the contract's own bounds. */
export const MIN_DRAG_SCALE = 0.1;
export const MAX_DRAG_SCALE = 10;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** How far right of the block's right edge the turn handle sits, in points at scale 1. */
export const TURN_REACH = 20;

/**
 * The placement after the pointer has moved by `delta` (PDF points) since the drag began from `start`.
 *
 * - **A side** sets the measure: the words are laid out again at it, which is what resizing a text box means.
 * - **A corner** scales the block about the corner opposite it, so that corner stays where it is: the contract scales
 *   about the top left, and the difference is the move this composes.
 * - **The top grip** moves the block.
 * - **The turn handle** turns it about its centre, to the angle the pointer is at.
 */
export function dragged(
  handle: Handle,
  start: Placement,
  delta: { readonly x: number; readonly y: number },
  box: BlockBox,
  zoom: number,
): Placement {
  const own = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const measure = start.width ?? own;
  switch (handle) {
    case 'e':
      return { ...start, width: Math.max(MIN_MEASURE, measure + delta.x) };
    case 'w': {
      const width = Math.max(MIN_MEASURE, measure - delta.x);
      // THE RIGHT EDGE STAYS where it was: the left edge moves by what the width gave up.
      return { ...start, width, move: { x: start.move.x + (measure - width), y: start.move.y } };
    }
    case 'n':
      return { ...start, move: { x: start.move.x + delta.x, y: start.move.y + delta.y } };
    case 'r': {
      // THE POINTER'S PLACE relative to the block's centre, in the block's own frame: the handle starts to the right of
      // the right edge, level with the middle.
      const reach = (own * start.scale) / 2 + TURN_REACH / zoom;
      const began = (start.rotate * Math.PI) / 180;
      const at = { x: reach * Math.cos(began) + delta.x, y: reach * Math.sin(began) + delta.y };
      const degrees = (Math.atan2(at.y, at.x) * 180) / Math.PI;
      // CLOSE TO UPRIGHT IS UPRIGHT: a hand does not land on zero, and a block a hair off level is not what was meant.
      return { ...start, rotate: Math.abs(degrees) < 2 ? 0 : degrees };
    }
    case 'se':
    case 'ne':
    case 'sw':
    case 'nw': {
      const westward = handle === 'sw' || handle === 'nw';
      const visible = measure * start.scale;
      const factor = clamp(start.scale * (1 + (westward ? -delta.x : delta.x) / visible), MIN_DRAG_SCALE, MAX_DRAG_SCALE);
      // THE FIXED CORNER, in the unscaled block's frame from its top left: the one opposite the corner dragged.
      const fixed = {
        x: handle === 'sw' || handle === 'nw' ? measure : 0,
        y: handle === 'ne' || handle === 'nw' ? -height : 0,
      };
      return {
        ...start,
        scale: factor,
        move: { x: start.move.x + (start.scale - factor) * fixed.x, y: start.move.y + (start.scale - factor) * fixed.y },
      };
    }
  }
}

/**
 * A placement made by keys, the way a drag cannot be made by a person who cannot drag: one step of a move, a width, a
 * scale or a turn. Each is a drag of a handle by the same amount, so a key and a pointer reach the same placement.
 */
export type Nudge =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'width'; readonly by: number }
  | { readonly kind: 'scale'; readonly by: number }
  | { readonly kind: 'turn'; readonly degrees: number };

/** The placement after one {@link Nudge}: the drag of the handle that makes it, by the amount it asks. */
export function nudged(nudge: Nudge, start: Placement, box: BlockBox, zoom: number): Placement {
  switch (nudge.kind) {
    case 'move':
      return dragged('n', start, { x: nudge.x, y: nudge.y }, box, zoom);
    case 'width':
      return dragged('e', start, { x: nudge.by, y: 0 }, box, zoom);
    case 'scale':
      // THE SOUTH-EAST CORNER by a share of the width the block is shown at.
      return dragged('se', start, { x: nudge.by * (start.width ?? box.x1 - box.x0) * start.scale, y: 0 }, box, zoom);
    case 'turn':
      return { ...start, rotate: start.rotate + nudge.degrees };
  }
}

/**
 * What the contract carries for a placement: only what was done, and `undefined` where nothing was, so a block nobody
 * placed is written exactly as it was. A measure within half a point of the block's own is not a new one.
 */
export function placeOf(placement: Placement, box: BlockBox): Omit<BlockPlace, 'block'> | undefined {
  const moved = Math.abs(placement.move.x) > 0.01 || Math.abs(placement.move.y) > 0.01;
  const scaled = Math.abs(placement.scale - 1) > 0.001;
  const turned = Math.abs(placement.rotate) > 0.01;
  const width = placement.width !== undefined && Math.abs(placement.width - (box.x1 - box.x0)) > 0.5 ? placement.width : undefined;
  if (!moved && !scaled && !turned && width === undefined) return undefined;
  return {
    ...(moved ? { move: { x: placement.move.x, y: placement.move.y } } : {}),
    ...(scaled ? { scale: placement.scale } : {}),
    ...(turned ? { rotate: placement.rotate } : {}),
    ...(width === undefined ? {} : { width }),
  };
}

/**
 * The CSS transform that SHOWS a placement over the open block, in the block's own frame at `zoom`: scaled about its top
 * left, turned about the centre of what that left, then moved, the order the writer applies them in (the screen's y runs
 * down where the page's runs up, so a counter-clockwise turn is a negative CSS angle and a move up is negative).
 */
export function placeTransform(placement: Placement, size: { readonly width: number; readonly height: number }, zoom: number): string {
  const scaledWidth = (placement.width === undefined ? size.width : placement.width * zoom) * placement.scale;
  const scaledHeight = size.height * placement.scale;
  const move = `translate(${String(placement.move.x * zoom)}px, ${String(-placement.move.y * zoom)}px)`;
  const turn = `translate(${String(scaledWidth / 2)}px, ${String(scaledHeight / 2)}px) rotate(${String(-placement.rotate)}deg) translate(${String(-scaledWidth / 2)}px, ${String(-scaledHeight / 2)}px)`;
  return `${move} ${turn} scale(${String(placement.scale)})`;
}
