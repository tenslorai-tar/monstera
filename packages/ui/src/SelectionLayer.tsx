import { pdfPoint, toViewport } from '@monstera/shared';
import type { ReactElement } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import type { AnnotationSelection } from './annotations/selectTool.js';

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

  const transform = overlayTransform(geometry);

  return (
    <svg
      aria-hidden="true"
      className="m-selection-layer"
      data-selection-layer={String(page)}
    >
      {selection.items.map((item) => {
        const a = toViewport(pdfPoint(item.rect.x0, item.rect.y0), transform);
        const b = toViewport(pdfPoint(item.rect.x1, item.rect.y1), transform);
        return (
          <rect
            className="m-selection-box"
            // THE WALK INDEX IS THE KEY, and here it is the right one: the
            // items are a set of handles at one version, so an index identifies
            // a row across a re-render in a way its position in the array does
            // not once a marquee replaces the selection.
            data-selection-index={String(item.index)}
            height={Math.abs(b.y - a.y)}
            key={item.index}
            width={Math.abs(b.x - a.x)}
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
          />
        );
      })}
    </svg>
  );
}
