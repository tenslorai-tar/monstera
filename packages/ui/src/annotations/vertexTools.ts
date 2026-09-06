import type {
  AnnotationColour,
  AnnotationDraft,
  AnnotationPoint,
  BorderEffect,
  RenderableCommand,
} from '@monstera/contract';
import type { PageTransform, ViewportPoint } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, lastPress, pointerPath } from '../registries/tools.js';
import type { AnnotationStyle } from './annotationStyle.js';

/**
 * The vertex tools — polygon, connected lines and cloud, and the first callers
 * of a gesture that outlives a release.
 *
 * ## What ADR-0042 bought, seen from the tool side
 *
 * Everything here reads `gesture.presses` and nothing reads the decimated path
 * except the preview's rubber band. That is the whole shape of the amendment:
 * the platform records where presses happened, the tool decides when the
 * gesture is over, and `AnnotationOverlay.tsx` is untouched by which tool is
 * doing it.
 *
 * These are the first tools to override `complete`. Every other tool spreads
 * `pointerPath`'s `true` and ends at a release, which is why adding the member
 * changed none of them.
 *
 * ## Two finish signals, and only one of them needed the platform
 *
 * A **double press** is the one people arrive expecting, and it is the reason
 * `Gesture.done` exists — the overlay reads `event.detail`, because *was that a
 * double-click* is a question the DOM already answers and timing two presses
 * here would be a second opinion about it.
 *
 * **Closing the shape** — pressing near where the first vertex went — needed
 * nothing at all: it is a distance between two entries in `presses`, computed
 * here. It is offered for the polygon and the cloud, which are closed shapes
 * and where a person's instinct is to return to the start, and **not** for
 * connected lines, where the last point is meant to be somewhere else and
 * finishing by returning to the beginning would refuse the ordinary case.
 *
 * That asymmetry is the argument for `complete` being the tool's rather than
 * the platform's: one gesture, three tools, two different answers about what
 * ends it.
 */

/**
 * The stroke every vertex shape is drawn in when the person has chosen nothing.
 *
 * A PICKER NOW EXISTS, as of 2026-09-07, and this stopped being *until* one: it
 * is these tools' own colour, which `editing.annotation-colour`'s `'auto'`
 * resolves to. The width moved out entirely — `shapeTools.ts` says where and
 * why a constant nothing reads is worse than none.
 */
const STROKE: AnnotationColour = [0.85, 0.15, 0.15];

/**
 * How near the first vertex a press must land to close the shape, in CSS
 * pixels.
 *
 * Generous, and deliberately larger than `shapeTools`' four-pixel minimum: this
 * is a target a person is aiming AT rather than a movement they are trying not
 * to make, and the cost of missing it is one extra vertex nobody wanted while
 * the cost of an over-eager radius is a shape that finishes early. Twelve is
 * about a fingertip at ordinary zoom.
 */
const CLOSING_RADIUS = 12;

/**
 * How far apart two presses must be to count as two vertices.
 *
 * A double press arrives as two pointer-downs a few pixels apart, and without
 * this the second one would add a vertex on top of the first before `done` was
 * read — so every double-click finish would leave a duplicate corner. Measured
 * against the format rather than the hand: MuPDF stores what it is given, and
 * two identical vertices are a zero-length segment in `/Vertices`.
 */
const SEPARATE_VERTICES = 3;

/**
 * The vertices a gesture has actually placed, in the overlay's own pixels.
 *
 * The presses stay `ViewportPoint`s all the way through — filtered, never
 * rebuilt. A helper that stripped them to plain numbers would have to put the
 * brand back before {@link toPdf}, which is an assertion standing exactly where
 * invariant L3 exists to stop one.
 */
function verticesOf(gesture: Gesture): readonly ViewportPoint[] {
  const kept: ViewportPoint[] = [];
  for (const press of gesture.presses) {
    const last = kept[kept.length - 1];
    // THE DOUBLE PRESS'S SECOND DOWN IS DROPPED HERE, not in the overlay. The
    // platform's job is to record that a press happened and that it was a
    // double; deciding that two presses three pixels apart are one vertex is a
    // question about this shape, and a tool with a different answer — a stamp
    // placed by two clicks, say — would need the raw list.
    if (last !== undefined && Math.hypot(press.x - last.x, press.y - last.y) < SEPARATE_VERTICES) {
      continue;
    }
    kept.push(press);
  }
  return kept;
}

/** Whether a press has landed back on the first vertex. */
function closesShape(gesture: Gesture): boolean {
  const vertices = verticesOf(gesture);
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  // THREE, NOT TWO: with two vertices the "last" press is the second one, and a
  // shape whose second corner is near its first is a very small polygon
  // somebody is still drawing rather than one they have closed.
  if (first === undefined || last === undefined || vertices.length < 3) return false;
  return Math.hypot(last.x - first.x, last.y - first.y) <= CLOSING_RADIUS;
}

/** The vertices in PDF user space, which is what the payload carries. */
function placed(gesture: Gesture, transform: PageTransform): AnnotationPoint[] {
  return verticesOf(gesture).map((vertex) => {
    const point = toPdf(vertex, transform);
    return { x: point.x, y: point.y };
  });
}

/**
 * A tool whose gesture is a run of presses.
 *
 * @param id the registry id, shared with the command that selects it
 * @param minimum how many vertices the draft needs — three for a closed shape,
 *   two for an open one. Read from the schema's own bounds rather than chosen:
 *   a tool that committed fewer would build a payload the channel refuses
 * @param closes whether landing on the first vertex finishes the shape. False
 *   for connected lines, where the last point is meant to be somewhere else
 * @param draftOf what the vertices become
 */
function vertexTool(
  id: string,
  minimum: number,
  closes: boolean,
  draftOf: (points: AnnotationPoint[]) => AnnotationDraft,
): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    // THE FIRST OVERRIDE OF `complete` IN THE BUILD. A release does not end
    // this gesture; a double press does, and for a closed shape so does landing
    // back on the first vertex.
    //
    // Note what is NOT here: a minimum. A gesture that finishes with too few
    // vertices is complete — the person said they were done — and `commit`
    // answers `undefined`. Refusing to finish would leave somebody holding a
    // gesture they cannot get out of except by pressing Escape.
    complete: (gesture: Gesture): boolean => gesture.done || (closes && closesShape(gesture)),
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      const points = placed(gesture, transform);
      // TOO FEW IS THE ORDINARY OUTCOME, not an error: a double press with one
      // vertex down is a stray double-click on the page. `undefined` is what
      // every other tool answers for a gesture that produced nothing.
      if (points.length < minimum) return undefined;
      return { kind: 'addAnnotation', page, annotation: draftOf(points) };
    },
    preview: (gesture: Gesture): ToolPreview | undefined => {
      const vertices = verticesOf(gesture);
      const [first] = vertices;
      if (first === undefined) return undefined;
      // THE RUBBER BAND: the vertices placed so far, plus wherever the pointer
      // is now. This is the one thing here that reads the path rather than the
      // presses, and it is why the platform still records both — without the
      // live point the preview would only move when a vertex was placed, and
      // the person would be drawing blind between clicks.
      //
      // `endOf` and not `lastPress`, deliberately: the band follows the
      // pointer. The two are the same value at the instant of a press and
      // diverge immediately afterwards, which is the whole interval a preview
      // exists for.
      const live = endOf(gesture);
      const trailing = lastPress(gesture);
      const following =
        Math.hypot(live.x - trailing.x, live.y - trailing.y) < 1
          ? []
          : [[live.x, live.y] as const];
      return {
        shape: 'path',
        points: [...vertices.map((vertex) => [vertex.x, vertex.y] as const), ...following],
      };
    },
  };

  return { id, controller };
}

/** The ids, shared with the commands that select these tools. */
export const POLYGON_TOOL_ID = 'annotate.polygon';
export const POLYLINE_TOOL_ID = 'annotate.polyline';
export const CLOUD_TOOL_ID = 'annotate.cloud';

/**
 * These three tools' own colour and width, as the style resolves them.
 *
 * `shapeTools.ts`' `styled`, restated rather than shared: the two files' `own`
 * colour happens to be the same red today and they are different tools'
 * identities, which is what `annotationStyle.ts` keeps apart from a person's
 * preference. A shared helper would make one tool's default the other's by
 * accident the first time either changed.
 */
function styled(style: AnnotationStyle): {
  readonly colour: AnnotationColour;
  readonly opacity: number;
  readonly borderWidth: number;
} {
  return { colour: style.colour(STROKE), opacity: style.opacity, borderWidth: style.lineWidth };
}

/** A closed shape, solid or clouded — one draft, two tools, as a line and an arrow are. */
function polygonDraft(border: BorderEffect, style: AnnotationStyle) {
  return (points: AnnotationPoint[]): AnnotationDraft => ({
    type: 'polygon',
    points,
    border,
    ...styled(style),
  });
}

export const polygonTool = (style: AnnotationStyle): UiTool =>
  vertexTool(POLYGON_TOOL_ID, 3, true, polygonDraft('solid', style));
export const cloudTool = (style: AnnotationStyle): UiTool =>
  vertexTool(CLOUD_TOOL_ID, 3, true, polygonDraft('cloudy', style));
export const polylineTool = (style: AnnotationStyle): UiTool =>
  vertexTool(POLYLINE_TOOL_ID, 2, false, (points) => ({
    type: 'polyline',
    points,
    ...styled(style),
  }));

/** Every vertex tool, in the order their controls appear. */
export function vertexTools(style: AnnotationStyle): readonly UiTool[] {
  return [polygonTool(style), polylineTool(style), cloudTool(style)];
}

/**
 * The two distances, exported so the cases assert against the tool's own
 * numbers rather than restating them.
 *
 * A case that spelt `12` would pass a tool whose radius had moved, which is the
 * failure a shared constant exists to stop — and it is the same argument the
 * preview and the commit already share a threshold for in `shapeTools.ts`.
 */
export { CLOSING_RADIUS, SEPARATE_VERTICES };
