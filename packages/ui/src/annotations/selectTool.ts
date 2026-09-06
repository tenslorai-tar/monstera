import type { AnnotationRect } from '@monstera/contract';
import type { DocVersion, PageTransform, ViewportPoint } from '@monstera/shared';
import { pdfPoint, toViewport } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import type { AnnotationSnapshot, ErasableAnnotation } from './eraserTool.js';

/**
 * The select tool — the first whose gesture produces **no command at all**.
 *
 * ## It fits the seam, and that was checked before it was assumed
 *
 * Selecting is not a mutation, so `commit` answers `undefined` every time and
 * the selection travels through a dependency the tool holds — the same shape as
 * the sticky note's `ask` and the eraser's read. That is worth stating because
 * the obvious reading is that this needs a platform change: a selection outlives
 * a gesture, is drawn while nothing is being dragged, and answers to the
 * keyboard, none of which a controller can do.
 *
 * None of those is the tool's, and that is why no amendment was owed
 * ([ADR-0042](../../../../docs/DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)
 * made the same check one row earlier and found the opposite). The state lives
 * where the application's state lives; the drawing is `SelectionLayer`, a
 * component beside the overlay rather than inside it; and the keyboard is the
 * **command registry**, which is where a key already reaches a feature. A tool
 * that held any of the three would be the second wiring place three surfaces
 * would then have to agree with.
 *
 * ## Two gestures, and the threshold decides which
 *
 * A click picks the topmost annotation under it. A drag draws a marquee and
 * picks everything it touches — which is how *multi* is expressed without a
 * modifier key, since `Gesture` records what the pointer did and not what was
 * held down while it did it. Shift-click-to-add is the ordinary convenience on
 * top of that and it is **owed**: the platform would have to record modifiers,
 * which is a third widening of `Gesture` and belongs with the tool that cannot
 * work without one.
 *
 * ## TOUCHES, not contains
 *
 * A marquee selects an annotation whose box it overlaps at all. Requiring
 * containment is the other convention and it is worse here: annotations are
 * often larger than the region a person sweeps, and a marquee that selected
 * nothing because the box hung over the edge would read as the tool being
 * broken rather than as a rule.
 *
 * ## Selecting NOTHING is a selection
 *
 * A click on blank paper clears. That is a real outcome rather than a no-op, and
 * it is what makes the tool feel like a selection tool — so the dependency is
 * called with an empty selection rather than not called at all.
 */

/** The id, shared with the command that selects this tool. */
export const SELECT_TOOL_ID = 'annotate.select';

/**
 * How far the pointer must travel before a click becomes a marquee.
 *
 * `shapeTools.ts`' `MINIMUM_DRAG` and its number, stated separately for the
 * reason that file states its own three separately: this one decides between
 * two *gestures* where those decide whether a shape has extent, and a shared
 * constant would tie a hand's steadiness to a rule about degenerate rectangles.
 */
const MINIMUM_MARQUEE = 4;

/** One selected annotation, with where it is so a layer can draw it. */
export interface SelectedAnnotation {
  readonly index: number;
  readonly rect: AnnotationRect;
}

/**
 * What is selected, on one page, at one version.
 *
 * **The version is part of it**, for the handle's reason
 * ([ADR-0041](../../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)):
 * the indices are positions in one walk, so a selection that outlived its
 * version would be arithmetic pointing at whatever is now there. The holder
 * drops it when the document moves rather than carrying it forward.
 *
 * **One page**, because a gesture belongs to the page it started on and neither
 * a click nor a marquee can reach a second. `removeAnnotation`'s payload has the
 * same shape for the same reason.
 */
export interface AnnotationSelection {
  readonly page: number;
  readonly version: DocVersion;
  /** Never empty — an empty selection is `undefined`, so there is one *nothing*. */
  readonly items: readonly SelectedAnnotation[];
}

export interface SelectDeps {
  /** The same read the eraser holds. */
  readonly annotations: () => Promise<AnnotationSnapshot | undefined>;
  /** Where the selection goes. `undefined` is *nothing is selected*. */
  readonly onSelect: (selection: AnnotationSelection | undefined) => void;
}

/** An annotation's box in the overlay's own pixels, or `null` if it has none. */
function boxOf(
  annotation: ErasableAnnotation,
  transform: PageTransform,
): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null {
  const { rect } = annotation;
  if (rect === null) return null;
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** The gesture's box in the overlay's own pixels, ordered. */
function marqueeOf(gesture: Gesture): {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly travelled: number;
} {
  const from: ViewportPoint = startOf(gesture);
  const to: ViewportPoint = endOf(gesture);
  return {
    x0: Math.min(from.x, to.x),
    y0: Math.min(from.y, to.y),
    x1: Math.max(from.x, to.x),
    y1: Math.max(from.y, to.y),
    travelled: Math.hypot(to.x - from.x, to.y - from.y),
  };
}

export function selectTool(deps: SelectDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<undefined> => {
      const marquee = marqueeOf(gesture);
      const snapshot = await deps.annotations();
      if (snapshot === undefined) {
        // NOTHING TO SELECT FROM. The selection is cleared rather than left
        // alone: whatever it named was read from a document that is now closed
        // or unreadable, and keeping it would draw boxes over a page nobody can
        // name annotations on.
        deps.onSelect(undefined);
        return undefined;
      }

      const onPage = snapshot.annotations.filter((entry) => entry.page === page);
      const picked =
        marquee.travelled < MINIMUM_MARQUEE
          ? // A CLICK: the topmost containing the point, which is the last in
            // the walk — `eraserTool.ts` has the argument, and both tools must
            // agree or clicking to select and clicking to erase would pick
            // different marks from the same pixel.
            [
              onPage.findLast((entry) => {
                const box = boxOf(entry, transform);
                return (
                  box !== null &&
                  marquee.x0 >= box.x0 &&
                  marquee.x0 <= box.x1 &&
                  marquee.y0 >= box.y0 &&
                  marquee.y0 <= box.y1
                );
              }),
            ].filter((entry) => entry !== undefined)
          : // A MARQUEE: everything it touches, in walk order, so the payload a
            // removal is built from is ordered the way the document is.
            onPage.filter((entry) => {
              const box = boxOf(entry, transform);
              return (
                box !== null &&
                box.x0 <= marquee.x1 &&
                box.x1 >= marquee.x0 &&
                box.y0 <= marquee.y1 &&
                box.y1 >= marquee.y0
              );
            });

      const items = picked
        .map((entry) => ({ index: entry.index, rect: entry.rect }))
        .filter((entry): entry is SelectedAnnotation => entry.rect !== null);

      deps.onSelect(
        items.length === 0 ? undefined : { page, version: snapshot.version, items },
      );
      // NEVER A COMMAND. Selecting changes nothing about the document, and a
      // tool that returned one here would put a version bump behind a click
      // that was only meant to point at something.
      return undefined;
    },
    preview: (gesture: Gesture): ToolPreview | undefined => {
      const marquee = marqueeOf(gesture);
      // NO MARQUEE UNTIL IT IS ONE. Below the threshold the gesture is still a
      // click, and drawing a one-pixel rectangle under the pointer would show a
      // region that is about to be ignored.
      if (marquee.travelled < MINIMUM_MARQUEE) return undefined;
      return {
        shape: 'rect',
        x: marquee.x0,
        y: marquee.y0,
        width: marquee.x1 - marquee.x0,
        height: marquee.y1 - marquee.y0,
      };
    },
  };

  return { id: SELECT_TOOL_ID, controller };
}
