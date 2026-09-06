import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { Gesture, UiTool } from '../registries/tools.js';
import { pointerPath } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import {
  CLOSING_RADIUS,
  CLOUD_TOOL_ID,
  POLYGON_TOOL_ID,
  POLYLINE_TOOL_ID,
  SEPARATE_VERTICES,
  cloudTool as buildCloud,
  polygonTool as buildPolygon,
  polylineTool as buildPolyline,
  vertexTools as buildVertexTools,
} from './vertexTools.js';
import { PLAIN_STYLE } from './annotationStyle.js';

/**
 * The three tools, built with the style that chooses nothing.
 *
 * Aliased on import for `shapeTools.test.ts`' reason: these cases are about the
 * gesture and the geometry, and the style is a parameter that arrived on
 * 2026-09-07 and changes neither.
 */
const polygonTool = buildPolygon(PLAIN_STYLE);
const polylineTool = buildPolyline(PLAIN_STYLE);
const cloudTool = buildCloud(PLAIN_STYLE);
const vertexTools = buildVertexTools(PLAIN_STYLE);

/**
 * The vertex tools, driven without a DOM.
 *
 * These are the first tools whose gesture outlives a pointer-up, so this file
 * has to reproduce what the overlay does between presses rather than calling
 * `begin`/`update`/`commit` once. {@link press} is that reproduction and it is
 * the risk in this file: a helper that drove the gesture differently from
 * `AnnotationOverlay.tsx` would prove these tools work against a lifecycle
 * nothing implements.
 *
 * It is kept honest two ways — it spreads the real `pointerPath` rather than
 * building a gesture literal, and `AnnotationOverlay.test.tsx` drives the same
 * tools through real pointer events, so the two halves meet on a real DOM
 * somewhere.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/**
 * The overlay's press handling, reproduced: a press extends a live gesture and
 * records where it landed.
 */
function press(gesture: Gesture | undefined, at: readonly [number, number], double = false): Gesture {
  const point = viewportPoint(at[0], at[1]);
  if (gesture === undefined) return pointerPath.begin(point);
  const moved = pointerPath.update(gesture, point);
  return { ...moved, presses: [...gesture.presses, point], done: gesture.done || double };
}

/** Presses a run of points, doubling the last one when `finish` is set. */
function draw(
  tool: UiTool,
  points: readonly (readonly [number, number])[],
  { finish = true }: { finish?: boolean } = {},
): {
  gesture: Gesture;
  // `commit`'s OWN return type, spelt out rather than widened to `unknown`.
  // A looser type here would make every `await` in this file answer `{}`, and
  // the assertions would then be reading a value TypeScript cannot describe —
  // which is how a case ends up asserting on a shape nothing guarantees.
  command: RenderableCommand | undefined | Promise<RenderableCommand | undefined>;
  over: boolean;
} {
  let gesture: Gesture | undefined;
  for (const [at, point] of points.entries()) {
    gesture = press(gesture, point, finish && at === points.length - 1);
  }
  if (gesture === undefined) throw new Error('a run of no points is not a gesture');
  const over = tool.controller.complete(gesture);
  return {
    gesture,
    command: over ? tool.controller.commit(gesture, 3, overlayTransform(PAGE)) : undefined,
    over,
  };
}

describe('the gesture survives a release until the tool says otherwise', () => {
  it('is NOT complete after one press, which every other tool would have ended', () => {
    // THE AMENDMENT'S WHOLE POINT, asserted on the value the overlay reads. For
    // the eight tools that spread `pointerPath` unmodified this is `true` at
    // every release; here it stays false, so the overlay keeps the gesture and
    // does not commit.
    const first = press(undefined, [20, 20]);
    expect(polygonTool.controller.complete(first)).toBe(false);
    expect(polylineTool.controller.complete(first)).toBe(false);
    expect(cloudTool.controller.complete(first)).toBe(false);
  });

  it('CONTROL: and pointerPath itself still says every release ends a gesture', () => {
    // Without this the case above passes for a build whose default flipped —
    // at which point the eight drag tools would never commit at all, and their
    // own cases could not see it because they never ask.
    expect(pointerPath.complete(press(undefined, [20, 20]))).toBe(true);
  });

  it('is complete on a DOUBLE press, which is the platform’s signal', () => {
    const { over } = draw(polygonTool, [
      [20, 20],
      [120, 20],
      [120, 90],
    ]);
    expect(over).toBe(true);
  });

  it('is complete when a press lands back on the FIRST vertex, for a closed shape', () => {
    // NO DOUBLE PRESS HERE — `finish: false` — so the only thing that can end
    // this gesture is the closing rule. A tool that ignored it would leave the
    // person unable to finish except by double-clicking.
    const { over } = draw(
      polygonTool,
      [
        [20, 20],
        [120, 20],
        [120, 90],
        [20 + CLOSING_RADIUS - 1, 20],
      ],
      { finish: false },
    );
    expect(over).toBe(true);
  });

  it('CONTROL: and a press just OUTSIDE that radius does not close it', () => {
    // The partner the closing case needs: a rule that fired for any press at
    // all would satisfy the case above perfectly and end every polygon at its
    // third vertex.
    const { over } = draw(
      polygonTool,
      [
        [20, 20],
        [120, 20],
        [120, 90],
        [20 + CLOSING_RADIUS + 2, 20],
      ],
      { finish: false },
    );
    expect(over).toBe(false);
  });

  it('CONNECTED LINES DO NOT CLOSE, because the last point is meant to be elsewhere', () => {
    // THE ASYMMETRY THAT MAKES `complete` THE TOOL'S. Same gesture, same
    // platform, different answer: an open run that ended when the pointer
    // passed near its own start would refuse the ordinary case — a bracket, a
    // there-and-back measurement — and there would be nothing the person could
    // do about it.
    const { over } = draw(
      polylineTool,
      [
        [20, 20],
        [120, 20],
        [120, 90],
        [21, 21],
      ],
      { finish: false },
    );
    expect(over).toBe(false);
  });
});

describe('polygonTool', () => {
  it('sends the vertices it was given, converted by the one adapter', async () => {
    const { command } = draw(polygonTool, [
      [20, 20],
      [120, 20],
      [120, 80],
    ]);

    expect(await command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'polygon',
        // THE SAME CONVERSION THE OTHER TOOLS USE, and the same fixture: (20,
        // 20) at zoom 2 on a page whose visible box starts at (50, 400) is
        // (60, 390), which every file in this directory asserts.
        points: [
          { x: 60, y: 390 },
          { x: 110, y: 390 },
          { x: 110, y: 360 },
        ],
        border: 'solid',
        colour: [0.85, 0.15, 0.15],
        opacity: 1,
        borderWidth: 2,
      },
    });
  });

  it('does NOT repeat the first vertex, because MuPDF closes the shape', async () => {
    // A payload that closed the ring itself would store a duplicate corner in
    // `/Vertices` for every polygon this build writes. Asserted by count, since
    // the case above would pass either way if it only checked the first three.
    const { command } = draw(polygonTool, [
      [20, 20],
      [120, 20],
      [120, 80],
    ]);
    expect(await command).toMatchObject({
      annotation: { points: [{ x: 60 }, { x: 110 }, { x: 110 }] },
    });
  });

  it('sends NOTHING for a double press that placed too few vertices', async () => {
    // A STRAY DOUBLE-CLICK on the page. The gesture is complete — the person
    // said they were done — and there is nothing to build from, which is the
    // outcome every other tool already produces for a gesture that drew
    // nothing. Refusing to COMPLETE instead would leave somebody holding a
    // gesture they could only escape from.
    //
    // TWO PRESSES, NOT ONE WITH A FLAG, and getting that wrong is what this
    // case's first draft did. A double-click is two pointer-downs: the first
    // carries `detail: 1` and STARTS the gesture, so `done` cannot be set by
    // it — `begin` has no event to read. Only the second press can say so. A
    // fixture that set the flag on a lone press was testing a sequence the
    // overlay cannot produce, and it would have gone on passing for a build
    // whose first press wrongly ended the gesture on its own.
    const { over, command } = draw(polygonTool, [
      [20, 20],
      [21, 20],
    ]);
    expect(over).toBe(true);
    expect(await command).toBeUndefined();
  });

  it('treats the double press’s second down as ONE vertex, not two', async () => {
    // MEASURED AGAINST THE FORMAT rather than the hand: a double-click lands
    // two pointer-downs a few pixels apart, and without the separation rule the
    // second would add a corner on top of the third — a zero-length segment in
    // `/Vertices` on every shape finished the ordinary way.
    //
    // The fixture puts the closing press one pixel inside the threshold, so a
    // build that dropped the rule sends four points and this sends three.
    const { command } = draw(polygonTool, [
      [20, 20],
      [120, 20],
      [120, 80],
      [120 + SEPARATE_VERTICES - 2, 80],
    ]);
    expect(await command).toMatchObject({
      annotation: { points: [{ x: 60 }, { x: 110 }, { x: 110 }] },
    });
  });

  it('previews the vertices placed so far, following the pointer between them', () => {
    // THE ONE THING HERE THAT READS THE PATH. Without the live point the band
    // would only move when a vertex was placed and the person would be drawing
    // blind between clicks — so the preview carries one more point than the
    // gesture has vertices.
    const twoDown = press(press(undefined, [20, 20]), [120, 20]);
    const moved = pointerPath.update(twoDown, viewportPoint(120, 90));
    expect(polygonTool.controller.preview(moved)).toStrictEqual({
      shape: 'path',
      points: [
        [20, 20],
        [120, 20],
        [120, 90],
      ],
    });
  });

  it('previews without a trailing point when the pointer has not moved off the press', () => {
    // CONTROL for the case above: a band drawn to where the pointer already is
    // would be a zero-length segment appended to every preview, and the case
    // above cannot see it because there the pointer HAS moved.
    expect(polygonTool.controller.preview(press(undefined, [20, 20]))).toStrictEqual({
      shape: 'path',
      points: [[20, 20]],
    });
  });
});

describe('cloudTool', () => {
  it('is a POLYGON with a border effect, not a subtype of its own', async () => {
    // What the format says these are, and what MuPDF was measured to accept: a
    // `/BE` on a `/Polygon`. One draft member, two tools — the arrangement a
    // line and an arrow already have.
    const { command } = draw(cloudTool, [
      [20, 20],
      [120, 20],
      [120, 80],
    ]);
    expect(await command).toMatchObject({
      annotation: { type: 'polygon', border: 'cloudy' },
    });
  });

  it('claims its own id, so the two polygon tools are not one control', () => {
    expect(cloudTool.id).toBe(CLOUD_TOOL_ID);
    expect(polygonTool.id).toBe(POLYGON_TOOL_ID);
  });
});

describe('polylineTool', () => {
  it('sends an open run with NO border field, which MuPDF refuses on a PolyLine', async () => {
    // The absence is the assertion. MuPDF answers `setBorderEffect` on a
    // `/PolyLine` with "PolyLine annotations have no BE property", so a schema
    // carrying one would be a value nothing could apply — and this is what
    // makes polyline a separate member rather than a polygon with a flag.
    const { command } = draw(polylineTool, [
      [20, 20],
      [120, 80],
    ]);
    expect(await command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'polyline',
        points: [
          { x: 60, y: 390 },
          { x: 110, y: 360 },
        ],
        colour: [0.85, 0.15, 0.15],
        opacity: 1,
        borderWidth: 2,
      },
    });
  });

  it('accepts TWO points where a polygon needs three', async () => {
    // The minimums are the schemas' own, and they differ for a reason: two
    // corners closed on themselves is a line drawn twice, which the `line`
    // member already expresses. So this gesture is a command here and nothing
    // for a polygon.
    const open = draw(polylineTool, [
      [20, 20],
      [120, 80],
    ]);
    const closed = draw(polygonTool, [
      [20, 20],
      [120, 80],
    ]);
    expect(await open.command).toBeDefined();
    expect(await closed.command).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    expect(polylineTool.id).toBe(POLYLINE_TOOL_ID);
  });
});

describe('vertexTools', () => {
  it('registers all three, so one left out of the list is red here', () => {
    expect(vertexTools.map((tool) => tool.id)).toStrictEqual([
      POLYGON_TOOL_ID,
      POLYLINE_TOOL_ID,
      CLOUD_TOOL_ID,
    ]);
  });
});
