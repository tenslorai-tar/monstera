import type { AnnotationColour, MeasureScale, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import type { AnnotationStyle } from './annotationStyle.js';
import { vertexTool } from './vertexTools.js';

/**
 * The three measurement tools — distance, area and perimeter.
 *
 * ## They are the shapes that already exist, said differently
 *
 * A distance is the line tool's drag, an area is the polygon's multi-press and a
 * perimeter is the polyline's. Nothing about the gesture is new, which is what
 * the reviewing seat meant by *the first two need nothing new* — so this file
 * builds on `vertexTool` rather than repeating it, and the distance tool is the
 * only one written out, because a two-point drag is not a vertex gesture.
 *
 * ## The number is NOT computed here
 *
 * The payload carries the points and the scale; the kernel does the arithmetic
 * and writes both the label and `/Measure`'s ratio. A tool that formatted the
 * text would put the reading a person sees and the conversion another
 * application recalculates from on opposite sides of the boundary, which is
 * where two statements of one measurement come apart.
 *
 * ## The scale is a dependency, not a constant
 *
 * *One point is fifty millimetres* is a fact about the drawing, and it arrives
 * from `editing.measure-scale` and `editing.measure-unit` the way the style
 * does. Uncalibrated it is one point per point, and a distance then reads in
 * points — honest, because nothing has told this build what the drawing is.
 */

/** What a dimension is drawn in when the person has chosen nothing. */
const MEASURE_COLOUR: AnnotationColour = [0.1, 0.45, 0.9];

export const MEASURE_DISTANCE_TOOL_ID = 'annotate.measure-distance';
export const MEASURE_AREA_TOOL_ID = 'annotate.measure-area';
export const MEASURE_PERIMETER_TOOL_ID = 'annotate.measure-perimeter';

/** How far a distance drag must run before it is a measurement. */
const MINIMUM_DRAG = 4;

export interface MeasureDeps {
  readonly style: AnnotationStyle;
  /** The drawing's calibration, from the two `editing` settings. */
  readonly scale: MeasureScale;
}

/** The three fields every measurement draft carries beyond its points. */
function measured(deps: MeasureDeps): {
  readonly scale: MeasureScale;
  readonly colour: AnnotationColour;
  readonly opacity: number;
  readonly borderWidth: number;
} {
  return {
    scale: deps.scale,
    colour: deps.style.colour(MEASURE_COLOUR),
    opacity: deps.style.opacity,
    borderWidth: deps.style.lineWidth,
  };
}

/**
 * The distance tool — a drag between two points.
 *
 * Written out rather than built on `vertexTool` because it is not a vertex
 * gesture: two points come from one drag, and a person measuring a distance
 * expects the line to follow the pointer rather than to wait for a second press.
 */
function distanceTool(deps: MeasureDeps): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const from = startOf(gesture);
    const to = endOf(gesture);
    if (Math.hypot(to.x - from.x, to.y - from.y) < MINIMUM_DRAG) return undefined;
    return { shape: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      if (drawn(gesture) === undefined) return undefined;
      const from = toPdf(startOf(gesture), transform);
      const to = toPdf(endOf(gesture), transform);
      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'measure-distance',
          points: [
            { x: from.x, y: from.y },
            { x: to.x, y: to.y },
          ],
          ...measured(deps),
        },
      };
    },
    preview: drawn,
  };

  return { id: MEASURE_DISTANCE_TOOL_ID, controller };
}

/** All three, in the order their controls appear. */
export function measureTools(deps: MeasureDeps): readonly UiTool[] {
  return [
    distanceTool(deps),
    // THE POLYGON'S AND THE POLYLINE'S GESTURES, taken whole: an area closes
    // and a perimeter does not, which is the one difference `vertexTool`
    // already carries as its `closes` argument.
    vertexTool(MEASURE_AREA_TOOL_ID, 3, true, (points) => ({
      type: 'measure-area',
      points,
      ...measured(deps),
    })),
    vertexTool(MEASURE_PERIMETER_TOOL_ID, 2, false, (points) => ({
      type: 'measure-perimeter',
      points,
      ...measured(deps),
    })),
  ];
}
