import type { AnnotationColour, RenderableCommand } from '@monstera/contract';
import type { PageTransform, ViewportPoint } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';

/**
 * The rectangle tool — Stage 3's first, and the caller the platform was built
 * with rather than for.
 *
 * ## Why this one first
 *
 * It exercises the whole controller in the simplest geometry there is: one
 * drag, two points, `begin` / `update` / `commit`. Ink drags the same four
 * phases and carries a point list, which puts an invariant L11 question in
 * front of a seam that has not been proven yet; text markup needs a selection
 * model that does not exist. A seam whose every case injects its own surfaces
 * is unproven against reality, and the first real caller is what finds the
 * gap — so the first caller is the one that can only find gaps in the seam.
 *
 * It found one: MuPDF's annotation rectangle is not in PDF user space, which is
 * recorded at `pageAnnotations.ts` and cost nothing to fix because it was found
 * by a tool rather than by a document.
 *
 * ## What is fixed here and owed to the style controls
 *
 * The colour and the border width are constants, and the FEATURES row for
 * *style controls* is what makes them values a person picks. This follows the
 * shape the watermark, the background and the header rows already took: a
 * command field that exists and a control that does not, rather than a schema
 * that has to grow. What that costs today is one appearance; what it buys is
 * that the picker, when it lands, is a control wired to a field rather than a
 * field and a control at once.
 */

/**
 * The stroke every rectangle is drawn in until a picker exists.
 *
 * A **document value**, not chrome, which is why it is three numbers here
 * rather than a design token: `docs/ARCHITECTURE.md` §10.2 names *a user-chosen
 * annotation color* as genuinely dynamic, and a token would put the
 * application's palette into the user's file, where it would still be the
 * application's palette after the theme changed.
 *
 * DeviceRGB components run 0 to 1, as `/C` holds them. This one is the red
 * every reviewing hand reaches for, and it is stated here so the picker
 * replaces one value rather than hunting for several.
 */
const STROKE: AnnotationColour = [0.85, 0.15, 0.15];

/**
 * The stroke width, in points.
 *
 * Points and not pixels, and that is the whole reason it is a constant rather
 * than something derived from the zoom: a border is a property of the
 * annotation, so it stays two points at every magnification and prints as two
 * points. A width in screen pixels would be an annotation whose thickness
 * depended on how the person who drew it happened to be zoomed.
 */
const BORDER_WIDTH = 2;

/**
 * How far the pointer must travel before a drag is a rectangle.
 *
 * In CSS pixels, because it is about the hand rather than about the document: a
 * click that moved three pixels is a click, whatever the zoom. Without it every
 * stray click on a page leaves an invisible annotation the user cannot select
 * to delete — the kernel refuses a zero-area rectangle, but *almost* zero is
 * legal and is worse, because it is a real annotation nobody can see.
 */
const MINIMUM_DRAG = 4;

/** The rectangle's corners in the overlay's own pixels, ordered. */
function box(gesture: Gesture): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(gesture.from.x, gesture.to.x),
    y: Math.min(gesture.from.y, gesture.to.y),
    width: Math.abs(gesture.to.x - gesture.from.x),
    height: Math.abs(gesture.to.y - gesture.from.y),
  };
}

const controller: ToolController = {
  begin: (at: ViewportPoint): Gesture => ({ from: at, to: at }),

  // A NEW VALUE, never a mutation: the overlay keeps whichever it wants, and a
  // controller that wrote through its argument would make two pages sharing
  // this object share a drag.
  update: (gesture: Gesture, at: ViewportPoint): Gesture => ({ from: gesture.from, to: at }),

  commit: (
    gesture: Gesture,
    page: number,
    transform: PageTransform,
  ): RenderableCommand | undefined => {
    const drawn = box(gesture);
    // BOTH AXES, not the diagonal: a drag of 40 by 1 is a line a person did not
    // mean to draw, and a distance test accepts it.
    if (drawn.width < MINIMUM_DRAG || drawn.height < MINIMUM_DRAG) return undefined;
    return {
      kind: 'addAnnotation',
      page,
      annotation: {
        type: 'square',
        // THE CORNERS AS DRAGGED, unordered, and converted by the one adapter.
        // Ordering happens in the kernel, against the document's own boxes —
        // ordering here as well would be two places deciding what a degenerate
        // rectangle is.
        rect: draggedRect(gesture.from, gesture.to, transform),
        colour: STROKE,
        borderWidth: BORDER_WIDTH,
      },
    };
  },

  preview: (gesture: Gesture): ToolPreview | undefined => {
    const drawn = box(gesture);
    // NOTHING IS DRAWN UNTIL THE GESTURE WOULD COMMIT, which is the same
    // threshold rather than a second one: a preview that appeared for a drag
    // the tool then discards is a control that showed something and did
    // nothing.
    if (drawn.width < MINIMUM_DRAG || drawn.height < MINIMUM_DRAG) return undefined;
    return { shape: 'rect', ...drawn };
  },
};

/**
 * The id, shared with the command that selects this tool.
 *
 * Exported so the command and the registration name the same constant rather
 * than two string literals that have to agree — the mapping the shared id
 * exists to avoid would come straight back as a typo nothing checks.
 */
export const RECTANGLE_TOOL_ID = 'annotate.rectangle';

/** The registration. Its controller is reached through this, never separately. */
export const rectangleTool: UiTool = { id: RECTANGLE_TOOL_ID, controller };
