import type { MeasureScale, RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { Gesture, UiTool } from '../registries/tools.js';
import { pointerPath } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import {
  MEASURE_AREA_TOOL_ID,
  MEASURE_DISTANCE_TOOL_ID,
  MEASURE_PERIMETER_TOOL_ID,
  measureTools as buildMeasureTools,
} from './measureTools.js';

/**
 * The three measurement tools, driven without a DOM.
 *
 * ## The scale is a NON-DEFAULT value in every case here
 *
 * `{ perPoint: 1, unit: 'pt' }` is what an uncalibrated document uses, and it is
 * the value a tool that dropped the field entirely would be indistinguishable
 * from — the schema's own fallback arriving as though it had been carried. So
 * the fixture is half a millimetre to the point, and every payload assertion
 * names it.
 *
 * ## What these cases prove, and what they cannot
 *
 * This is the UI half of the pair: that each control dispatches the command it
 * claims to, with the points the gesture placed and the scale it was built with.
 * The arithmetic — a distance scaled once and an area scaled twice — is the
 * kernel's, and `pageAnnotations.test.ts` holds it. Neither half alone is the
 * feature.
 */

const SCALE: MeasureScale = { perPoint: 0.5, unit: 'mm' };

const measureTools = buildMeasureTools({ style: PLAIN_STYLE, scale: SCALE });
const [distanceTool, areaTool, perimeterTool] = measureTools;

if (distanceTool === undefined || areaTool === undefined || perimeterTool === undefined) {
  throw new Error('measureTools built fewer than three tools');
}

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The fixture every file in this directory shares: a non-zero origin and a
  // zoom that is not 1, so a controller passing pixels through would fail
  // rather than coincide.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** The three fields a measurement carries beyond its points, at `PLAIN_STYLE`. */
const STYLED = { scale: SCALE, colour: [0.1, 0.45, 0.9], opacity: 1, borderWidth: 2 };

/** Drives a whole drag on one tool and returns whatever `commit` decided. */
function drag(
  tool: UiTool,
  from: readonly [number, number],
  to: readonly [number, number],
): RenderableCommand | undefined {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, 3, overlayTransform(PAGE)) as RenderableCommand | undefined;
}

/**
 * The overlay's press handling, reproduced — `vertexTools.test.ts`' helper, and
 * the same caveat applies: a helper that drove the gesture differently from
 * `AnnotationOverlay.tsx` would prove these tools work against a lifecycle
 * nothing implements. It spreads the real `pointerPath` for that reason.
 */
function press(gesture: Gesture | undefined, at: readonly [number, number], double = false): Gesture {
  const point = viewportPoint(at[0], at[1]);
  if (gesture === undefined) return pointerPath.begin(point);
  const moved = pointerPath.update(gesture, point);
  return { ...moved, presses: [...gesture.presses, point], done: gesture.done || double };
}

/** Presses a run of points, doubling the last one to finish. */
function draw(
  tool: UiTool,
  points: readonly (readonly [number, number])[],
): { command: RenderableCommand | undefined; over: boolean } {
  let gesture: Gesture | undefined;
  for (const [at, point] of points.entries()) {
    gesture = press(gesture, point, at === points.length - 1);
  }
  if (gesture === undefined) throw new Error('a run of no points is not a gesture');
  const over = tool.controller.complete(gesture);
  return {
    command: over
      ? (tool.controller.commit(gesture, 3, overlayTransform(PAGE)) as
          | RenderableCommand
          | undefined)
      : undefined,
    over,
  };
}

describe('the distance tool', () => {
  it('sends two points and the drawing’s scale, converted by the one adapter', () => {
    // (20, 20) at zoom 2 on a page whose visible box starts at (50, 400) is
    // (60, 390) — the conversion every file in this directory asserts.
    expect(drag(distanceTool, [20, 20], [120, 80])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'measure-distance',
        points: [
          { x: 60, y: 390 },
          { x: 110, y: 360 },
        ],
        ...STYLED,
      },
    });
  });

  it('IS A DRAG, not a vertex gesture, which is what the other two are', () => {
    // The one behavioural difference in this file, asserted on the value the
    // overlay reads: a release ends this gesture and does not end the other
    // two. A distance tool built on `vertexTool` would leave a person clicking
    // twice for a measurement they had already dragged out.
    const started = distanceTool.controller.begin(viewportPoint(20, 20));
    expect(distanceTool.controller.complete(started)).toBe(true);
    expect(areaTool.controller.complete(started)).toBe(false);
    expect(perimeterTool.controller.complete(started)).toBe(false);
  });

  it('sends nothing for a press that did not travel', () => {
    expect(drag(distanceTool, [20, 20], [21, 20])).toBeUndefined();
  });

  it('previews the line it would draw', () => {
    const started = distanceTool.controller.begin(viewportPoint(20, 20));
    const moved = distanceTool.controller.update(started, viewportPoint(120, 80));
    expect(distanceTool.controller.preview(moved)).toStrictEqual({
      shape: 'line',
      x1: 20,
      y1: 20,
      x2: 120,
      y2: 80,
    });
  });
});

describe('the area and perimeter tools', () => {
  const SQUARE = [
    [20, 20],
    [120, 20],
    [120, 80],
  ] as const;

  it('sends an area as a closed run of vertices', () => {
    expect(draw(areaTool, SQUARE).command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'measure-area',
        points: [
          { x: 60, y: 390 },
          { x: 110, y: 390 },
          { x: 110, y: 360 },
        ],
        ...STYLED,
      },
    });
  });

  it('sends a perimeter as an OPEN one, which is the same gesture', () => {
    expect(draw(perimeterTool, SQUARE).command).toMatchObject({
      annotation: { type: 'measure-perimeter', points: [{ x: 60 }, { x: 110 }, { x: 110 }] },
    });
  });

  it('accepts TWO points for a perimeter where an area needs three', () => {
    // The minimums are the schemas' own, and they differ for the reason the
    // polygon and polyline's do: a run of two closed on itself is a distance
    // measured twice, which `measure-distance` already expresses.
    const twoPoints = [
      [20, 20],
      [120, 80],
    ] as const;
    expect(draw(perimeterTool, twoPoints).command).toBeDefined();
    expect(draw(areaTool, twoPoints).command).toBeUndefined();
  });
});

describe('measureTools', () => {
  it('registers all three, so one left out of the list is red here', () => {
    expect(measureTools.map((tool) => tool.id)).toStrictEqual([
      MEASURE_DISTANCE_TOOL_ID,
      MEASURE_AREA_TOOL_ID,
      MEASURE_PERIMETER_TOOL_ID,
    ]);
  });

  it('CARRIES THE SCALE IT WAS BUILT WITH, and not the uncalibrated default', () => {
    // The case that separates *the field was passed through* from *the field
    // was dropped*. A tool that omitted `scale` would build a payload the
    // channel refuses, and one that hard-coded `{ perPoint: 1, unit: 'pt' }`
    // would be silently wrong on every calibrated drawing — indistinguishable
    // from correct in a fixture that used the fallback.
    const uncalibrated = buildMeasureTools({
      style: PLAIN_STYLE,
      scale: { perPoint: 1, unit: 'pt' },
    })[0];
    if (uncalibrated === undefined) throw new Error('no distance tool');
    expect(drag(distanceTool, [20, 20], [120, 80])).toMatchObject({
      annotation: { scale: { perPoint: 0.5, unit: 'mm' } },
    });
    expect(drag(uncalibrated, [20, 20], [120, 80])).toMatchObject({
      annotation: { scale: { perPoint: 1, unit: 'pt' } },
    });
  });
});
