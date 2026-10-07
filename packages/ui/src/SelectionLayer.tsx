import type { ReactElement } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { pdfRectOnScreen } from './annotations/annotationSpace.js';
import { type AnnotationSelection, CORNER_REACH, SIDE_RESIZABLE_KINDS, sidesOf } from './annotations/selectTool.js';

/**
 * What is selected, drawn over the page.
 *
 * ## A component beside the overlay, not part of it
 *
 * `AnnotationOverlay` knows how to turn pointers into gestures and nothing
 * about what any tool means — *"adding the nineteenth tool changes this file not
 * at all"*. A selection is state that outlives every gesture, so drawing it
 * there would put a tool's own concept inside the dispatcher, and the next
 * stateful tool would add a second.
 *
 * So this is its own layer, mounted in the page slot from the same geometry, and
 * it is **inert**: `pointer-events: none`, no handlers, nothing focusable. The
 * pointer belongs to the overlay above it, which is what keeps *where a gesture
 * goes* a question with one answer.
 *
 * ## It draws the reported box, which is not always the shape
 *
 * `rect` is a bounding box — a diagonal line's is the square its ends span — so
 * the outline around a selected line is larger than the line. That is the same
 * box the eraser and this tool hit-test against, and drawing a different one
 * would show a person a region that does not match what clicking does.
 */
export interface SelectionLayerProps {
  /** The selection, or `undefined` for none. Drawn only on its own page. */
  readonly selection: AnnotationSelection | undefined;
  /** Which page this layer sits on, zero-based. */
  readonly page: number;
  /** The page as drawn, for the transform. The overlay's own geometry. */
  readonly geometry: OverlayPage;
}

export function SelectionLayer({
  selection,
  page,
  geometry,
}: SelectionLayerProps): ReactElement | null {
  // NOTHING AT ALL RATHER THAN AN EMPTY SURFACE, which is `AnnotationOverlay`'s
  // rule and its reason: an element over the page that draws nothing is a thing
  // that can go wrong silently, and *absent* is checkable in a way *inert* is
  // not.
  if (selection === undefined) return null;
  // ONE LAYER PER PAGE and one selection per document, so every slot but its own
  // renders nothing. Written as a second statement rather than folded into the
  // first: the two conditions are *there is no selection* and *it is not this
  // page's*, and only the second is about this component.
  if (selection.page !== page) return null;

  return (
    <svg
      aria-hidden="true"
      className="m-selection-layer"
      data-selection-layer={String(page)}
    >
      {selection.items.map((item) => {
        const box = pdfRectOnScreen(item.rect, geometry);
        const left = box.left;
        const top = box.top;
        const right = box.left + box.width;
        const bottom = box.top + box.height;
        return (
          // THE WALK INDEX IS THE KEY, and here it is the right one: the items are a set of handles at one version, so
          // an index identifies a row across a re-render in a way its position in the array does not once a marquee
          // replaces the selection.
          <g data-selection-index={String(item.index)} key={item.index}>
            <rect className="m-selection-box" height={bottom - top} width={right - left} x={left} y={top} />
            {/* THE FOUR CORNERS, DRAWN (ADR-0133): a square `CORNER_REACH` across on each, centred on it, which is the
                select tool's own grab radius — so what is drawn is exactly where a press resizes. */}
            {[
              [left, top],
              [right, top],
              [left, bottom],
              [right, bottom],
            ].map(([x = 0, y = 0]) => (
              <rect
                className="m-selection-handle"
                data-selection-handle=""
                height={CORNER_REACH}
                key={`${String(x)},${String(y)}`}
                width={CORNER_REACH}
                x={x - CORNER_REACH / 2}
                y={y - CORNER_REACH / 2}
              />
            ))}
            {/* THE FOUR SIDE MIDPOINTS, for a box-shaped mark only — the same reach, drawn where the tool grabs. */}
            {SIDE_RESIZABLE_KINDS.has(item.kind)
              ? sidesOf({ x0: left, y0: top, x1: right, y1: bottom }).map(([side, x, y]) => (
                  <rect
                    className="m-selection-handle"
                    data-selection-handle={side}
                    height={CORNER_REACH}
                    key={side}
                    width={CORNER_REACH}
                    x={x - CORNER_REACH / 2}
                    y={y - CORNER_REACH / 2}
                  />
                ))
              : null}
          </g>
        );
      })}
    </svg>
  );
}
