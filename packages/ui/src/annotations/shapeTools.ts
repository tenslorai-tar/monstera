import type { AnnotationColour, LineEnding, RenderableCommand } from '@monstera/contract';
import type { PageTransform, ViewportPoint } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';

/**
 * The four shape tools — Stage 3's first, and the callers the platform was
 * built with rather than for.
 *
 * ## Why the rectangle went first
 *
 * It exercises the whole controller in the simplest geometry there is: one
 * drag, two points, `begin` / `update` / `commit`. Ink drags the same four
 * phases and carries a point list, which puts an invariant L11 question in
 * front of a seam that has not been proven yet; text markup needs a selection
 * model that does not exist. So the first caller was the one that could only
 * find gaps in the seam.
 *
 * It found one: MuPDF's annotation rectangle is not in PDF user space, which is
 * recorded at `pageAnnotations.ts` and cost nothing to fix because a tool found
 * it rather than a document.
 *
 * ## TWO FACTORIES, and the second is what says they are not one
 *
 * A box tool and a line tool differ in three things — the draft they build,
 * the preview they describe, and **what counts as too small to be meant**. The
 * third is the one that matters: a drag of 40 by 1 is a rectangle nobody meant
 * to draw and a horizontal rule somebody did. A single factory branching on
 * which kind it was would be the shape the header/watermark row rejects: a
 * helper taking the union of two parameter sets, deciding between them.
 *
 * Within each factory nothing branches. `boxTool` differs between rectangle and
 * ellipse by two values, and `lineTool` between line and arrow by one — so a
 * copy each would be four near-identical modules for four values.
 *
 * ## What is fixed here and owed to the style controls
 *
 * The colour and the border width are constants, and the FEATURES row for
 * *style controls* is what makes them values a person picks. This follows the
 * shape the watermark, background and header rows already took: a command field
 * that exists and a control that does not, rather than a schema that has to
 * grow.
 */

/**
 * The stroke every shape is drawn in until a picker exists.
 *
 * A **document value**, not chrome, which is why it is three numbers here
 * rather than a design token: `docs/ARCHITECTURE.md` §10.2 names *a user-chosen
 * annotation color* as genuinely dynamic, and a token would put the
 * application's palette into the user's file, where it would still be the
 * application's palette after the theme changed.
 *
 * DeviceRGB components run 0 to 1, as `/C` holds them. This one is the red
 * every reviewing hand reaches for, and it is stated once so the picker
 * replaces one value rather than hunting for several.
 */
const STROKE: AnnotationColour = [0.85, 0.15, 0.15];

/**
 * The stroke width, in points.
 *
 * Points and not pixels, and that is why it is a constant rather than something
 * derived from the zoom: a border is a property of the annotation, so it stays
 * two points at every magnification and prints as two points. A width in screen
 * pixels would be an annotation whose thickness depended on how the person who
 * drew it happened to be zoomed.
 */
const BORDER_WIDTH = 2;

/**
 * How far the pointer must travel before a drag is a shape.
 *
 * In CSS pixels, because it is about the hand rather than about the document: a
 * click that moved three pixels is a click, whatever the zoom. Without it every
 * stray click on a page leaves an invisible annotation the user cannot select
 * to delete — the kernel refuses a degenerate one, but *almost* degenerate is
 * legal and is worse, because it is a real annotation nobody can see.
 */
const MINIMUM_DRAG = 4;

/** The gesture's box in the overlay's own pixels, ordered. */
function box(gesture: Gesture): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(gesture.from.x, gesture.to.x),
    y: Math.min(gesture.from.y, gesture.to.y),
    width: Math.abs(gesture.to.x - gesture.from.x),
    height: Math.abs(gesture.to.y - gesture.from.y),
  };
}

/**
 * A tool that draws a shape inside the box a drag describes.
 *
 * @param id the registry id, shared with the command that selects it
 * @param type which annotation the draft is
 * @param shape what the overlay draws while the drag is in flight
 */
function boxTool(
  id: string,
  type: 'square' | 'circle',
  shape: 'rect' | 'ellipse',
): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const measured = box(gesture);
    // BOTH AXES, not the diagonal: a drag of 40 by 1 is a sliver a person did
    // not mean, and a distance test accepts it.
    if (measured.width < MINIMUM_DRAG || measured.height < MINIMUM_DRAG) return undefined;
    return { shape, ...measured };
  };

  const controller: ToolController = {
    begin: (at: ViewportPoint): Gesture => ({ from: at, to: at }),
    // A NEW VALUE, never a mutation: the overlay keeps whichever it wants, and
    // a controller that wrote through its argument would make two pages sharing
    // this object share a drag.
    update: (gesture: Gesture, at: ViewportPoint): Gesture => ({ from: gesture.from, to: at }),
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      // THE SAME THRESHOLD AS THE PREVIEW, read from it rather than restated:
      // a preview that appeared for a drag the tool then discards is a control
      // that showed something and did nothing, and two copies of one number is
      // how the two come apart.
      if (drawn(gesture) === undefined) return undefined;
      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type,
          // THE CORNERS AS DRAGGED, unordered, converted by the one adapter.
          // Ordering happens in the kernel, against the document's own boxes —
          // ordering here as well would be two places deciding what a
          // degenerate shape is.
          rect: draggedRect(gesture.from, gesture.to, transform),
          colour: STROKE,
          borderWidth: BORDER_WIDTH,
        },
      };
    },
    preview: drawn,
  };

  return { id, controller };
}

/**
 * A tool that draws a line between a drag's two ends.
 *
 * @param id the registry id, shared with the command that selects it
 * @param ending how the `to` end is drawn — the only thing separating a line
 *   from an arrow, because that is what the format says separates them
 */
function lineTool(id: string, ending: LineEnding): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const across = gesture.to.x - gesture.from.x;
    const down = gesture.to.y - gesture.from.y;
    // THE DISTANCE, and this is where a line stops being a box tool. A
    // horizontal rule is 200 by 0 and is a thing people draw on purpose; a
    // per-axis threshold refuses it, and the refusal reads as correct because
    // the same test is right for the two shapes beside it.
    if (Math.hypot(across, down) < MINIMUM_DRAG) return undefined;
    return {
      shape: 'line',
      x1: gesture.from.x,
      y1: gesture.from.y,
      x2: gesture.to.x,
      y2: gesture.to.y,
    };
  };

  const controller: ToolController = {
    begin: (at: ViewportPoint): Gesture => ({ from: at, to: at }),
    update: (gesture: Gesture, at: ViewportPoint): Gesture => ({ from: gesture.from, to: at }),
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      if (drawn(gesture) === undefined) return undefined;
      // TWO POINTS AND NOT A RECTANGLE, which is the difference the draft
      // carries: a rectangle cannot say which diagonal was drawn, so a line
      // stored as one comes back with its arrowhead at whichever corner the
      // reader happens to call the end.
      const from = toPdf(gesture.from, transform);
      const to = toPdf(gesture.to, transform);
      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'line',
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          ending,
          colour: STROKE,
          borderWidth: BORDER_WIDTH,
        },
      };
    },
    // THE PREVIEW SHOWS NO ARROWHEAD, deliberately. It describes where the line
    // will be, which is the thing being placed; drawing a head would mean the
    // overlay carrying a marker definition for a decoration the annotation
    // renders itself. Stated so a reader does not read its absence as a defect.
    preview: drawn,
  };

  return { id, controller };
}

/**
 * The ids, shared with the commands that select these tools.
 *
 * Exported so a command and its registration name the same constant rather than
 * two string literals that have to agree — the mapping the shared id exists to
 * avoid would come straight back as a typo nothing checks.
 */
export const RECTANGLE_TOOL_ID = 'annotate.rectangle';
export const ELLIPSE_TOOL_ID = 'annotate.ellipse';
export const LINE_TOOL_ID = 'annotate.line';
export const ARROW_TOOL_ID = 'annotate.arrow';

export const rectangleTool = boxTool(RECTANGLE_TOOL_ID, 'square', 'rect');
export const ellipseTool = boxTool(ELLIPSE_TOOL_ID, 'circle', 'ellipse');
export const lineAnnotationTool = lineTool(LINE_TOOL_ID, 'none');
export const arrowTool = lineTool(ARROW_TOOL_ID, 'closed-arrow');

/** Every shape tool, in the order their controls appear. */
export const shapeTools: readonly UiTool[] = [
  rectangleTool,
  ellipseTool,
  lineAnnotationTool,
  arrowTool,
];
