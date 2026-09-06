import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import {
  ARROW_TOOL_ID,
  ELLIPSE_TOOL_ID,
  INK_TOOL_ID,
  LINE_TOOL_ID,
  RECTANGLE_TOOL_ID,
  REDACT_TOOL_ID,
  arrowTool,
  ellipseTool,
  inkAnnotationTool,
  lineAnnotationTool,
  rectangleTool,
  redactTool,
  shapeTools,
} from './shapeTools.js';

/**
 * The four shape tools' controllers, driven without a DOM.
 *
 * That is what the controller being **pure** buys: a whole drag is three calls,
 * and every case here asserts the command that came out of `commit` — the
 * decision — rather than any state the overlay would be left in.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // A NON-ZERO ORIGIN AND A ZOOM THAT IS NOT 1, so a controller that passed
  // pixels straight through would fail rather than coincide.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** Drives a whole drag on one tool and returns whatever `commit` decided. */
function drag(
  tool: UiTool,
  from: readonly [number, number],
  to: readonly [number, number],
  page = 3,
): RenderableCommand | undefined {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  // NOT AWAITED, and the cast is what says why rather than hiding it: `commit`
  // may answer now or later, and every tool in this file answers now. A tool
  // that asks a person returns a promise, and its cases await — see
  // `textTools.test.ts`. Widening these twenty-two cases to `async` for a value
  // that is never a promise would put the ceremony where the behaviour is not.
  return controller.commit(moved, page, overlayTransform(PAGE)) as
    | RenderableCommand
    | undefined;
}

/** The gesture a drag describes, for the preview cases. */
function gesture(tool: UiTool, from: readonly [number, number], to: readonly [number, number]) {
  const { controller } = tool;
  return controller.update(
    controller.begin(viewportPoint(from[0], from[1])),
    viewportPoint(to[0], to[1]),
  );
}

describe('the shape tools are registered under the ids their commands use', () => {
  it('names each tool once, and the set is what the composition point spreads', () => {
    // The two registries are joined by these values and by nothing else, so an
    // id that merely resembled a command's would select nothing, silently.
    expect(shapeTools.map((tool) => tool.id)).toStrictEqual([
      RECTANGLE_TOOL_ID,
      ELLIPSE_TOOL_ID,
      LINE_TOOL_ID,
      ARROW_TOOL_ID,
      INK_TOOL_ID,
      REDACT_TOOL_ID,
    ]);
    expect(new Set(shapeTools.map((tool) => tool.id)).size).toBe(shapeTools.length);
  });
});

describe('the box tools', () => {
  it('commit an addAnnotation naming the page and the rectangle drawn', () => {
    // THE PAGE COMES FROM THE OVERLAY, which is the slot the pointer went down
    // on — so a fixture at page 0 would let an implementation that sent a
    // literal zero pass. That is the exact defect the rotate shipped with.
    expect(drag(rectangleTool, [20, 20], [120, 80], 3)).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'square',
        // 100 by 60 CSS pixels at zoom 2 is 50 by 30 PDF units, from the crop
        // box's top-left corner (50, 400).
        rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
        colour: [0.85, 0.15, 0.15],
        borderWidth: 2,
      },
    });
  });

  it('differ ONLY in the annotation type, which is what makes them one factory', () => {
    // The separator for the factory: if the ellipse were a copy that had drifted
    // — a different colour, a different threshold, a rect built another way —
    // this is where it would show. Comparing the whole command rather than the
    // type is what makes that true.
    const rectangle = drag(rectangleTool, [20, 20], [120, 80]);
    const ellipse = drag(ellipseTool, [20, 20], [120, 80]);
    expect(rectangle?.kind === 'addAnnotation' ? rectangle.annotation.type : '').toBe('square');
    expect(ellipse?.kind === 'addAnnotation' ? ellipse.annotation.type : '').toBe('circle');
    expect({ ...(ellipse as { annotation: object }).annotation, type: 'square' }).toStrictEqual(
      (rectangle as { annotation: object }).annotation,
    );
  });

  it('build a redact mark with no border width, which MuPDF would refuse', () => {
    // The third box tool, and it is not a copy of the other two: its draft has
    // no `borderWidth` field at all, because `setBorderWidth` on a Redact
    // throws. That is why `boxTool` takes a draft BUILDER rather than a type
    // name — the three drafts are not the same shape.
    expect(drag(redactTool, [20, 20], [120, 80], 3)).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'redact',
        rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
        colour: [0.85, 0.15, 0.15],
      },
    });
  });

  it('carry the corners in the order they were dragged', () => {
    // A drag that ran up and to the left is the same rectangle by its other
    // diagonal, and the kernel is what orders it. An implementation that
    // ordered here as well would answer identically for both directions, and
    // the disagreement about a degenerate shape would live in two places.
    const command = drag(rectangleTool, [120, 80], [20, 20]);
    const drawn =
      command?.kind === 'addAnnotation' && command.annotation.type === 'square'
        ? command.annotation.rect
        : undefined;
    expect(drawn).toStrictEqual({ x0: 110, y0: 360, x1: 60, y1: 390 });
  });

  it('commit nothing for a click, or for a drag short on EITHER axis', () => {
    // BOTH AXES, not the diagonal: 40 by 1 is a distance of 40, which a
    // distance test accepts, and it is a sliver nobody meant to draw.
    expect(drag(rectangleTool, [40, 40], [40, 40])).toBeUndefined();
    expect(drag(rectangleTool, [40, 40], [80, 41])).toBeUndefined();
    expect(drag(rectangleTool, [40, 40], [41, 80])).toBeUndefined();
  });

  it('CONTROL: a drag past the threshold on both axes does commit', () => {
    // Without this, the case above is satisfied by a tool that commits nothing.
    expect(drag(rectangleTool, [40, 40], [80, 80])).not.toBeUndefined();
  });

  it('preview the box, ordered, and nothing until the gesture would commit', () => {
    // ORDERED HERE and unordered in the command, which is not an
    // inconsistency: a preview is a box on screen and SVG has no meaning for a
    // negative width, where the command's rectangle is a pair of document
    // corners.
    expect(rectangleTool.controller.preview(gesture(rectangleTool, [40, 40], [42, 42]))).toBeUndefined();
    expect(ellipseTool.controller.preview(gesture(ellipseTool, [120, 80], [20, 20]))).toStrictEqual({
      shape: 'ellipse',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
    });
  });
});

describe('the line tools', () => {
  it('commit two POINTS rather than a rectangle, so the arrow end is known', () => {
    // A rectangle cannot say which diagonal was drawn, so a line stored as one
    // comes back with its head at whichever corner the reader calls the end.
    expect(drag(lineAnnotationTool, [20, 20], [120, 80], 3)).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'line',
        from: { x: 60, y: 390 },
        to: { x: 110, y: 360 },
        ending: 'none',
        colour: [0.85, 0.15, 0.15],
        borderWidth: 2,
      },
    });
  });

  it('differ ONLY in the ending, which is what the format says an arrow is', () => {
    const line = drag(lineAnnotationTool, [20, 20], [120, 80]);
    const arrow = drag(arrowTool, [20, 20], [120, 80]);
    expect(line?.kind === 'addAnnotation' && line.annotation.type === 'line'
      ? line.annotation.ending
      : '').toBe('none');
    expect(arrow?.kind === 'addAnnotation' && arrow.annotation.type === 'line'
      ? arrow.annotation.ending
      : '').toBe('closed-arrow');
    expect({ ...(arrow as { annotation: object }).annotation, ending: 'none' }).toStrictEqual(
      (line as { annotation: object }).annotation,
    );
  });

  it('keep the drag\'s direction, so the head lands where the pointer stopped', () => {
    const reversed = drag(arrowTool, [120, 80], [20, 20]);
    const drawn =
      reversed?.kind === 'addAnnotation' && reversed.annotation.type === 'line'
        ? [reversed.annotation.from, reversed.annotation.to]
        : undefined;
    expect(drawn).toStrictEqual([
      { x: 110, y: 360 },
      { x: 60, y: 390 },
    ]);
  });

  it('COMMIT A HORIZONTAL RULE, which a per-axis threshold would refuse', () => {
    // THE SEPARATOR between the two factories, and the reason there are two. A
    // 200-by-0 drag is a sliver for a rectangle and a line for a line, and a
    // single shared threshold gets one of them wrong — silently, because the
    // same test is right for the shapes beside it.
    expect(drag(lineAnnotationTool, [20, 40], [220, 40])).not.toBeUndefined();
    expect(drag(rectangleTool, [20, 40], [220, 40])).toBeUndefined();
  });

  it('commit nothing for a drag shorter than the threshold in any direction', () => {
    expect(drag(lineAnnotationTool, [40, 40], [40, 40])).toBeUndefined();
    expect(drag(lineAnnotationTool, [40, 40], [42, 42])).toBeUndefined();
  });

  it('preview a line between the two ends, unordered', () => {
    expect(lineAnnotationTool.controller.preview(gesture(lineAnnotationTool, [120, 80], [20, 20])))
      .toStrictEqual({ shape: 'line', x1: 120, y1: 80, x2: 20, y2: 20 });
  });
});

describe('the ink tool', () => {
  /** Drags through several points, as a hand does. */
  function scribble(...through: readonly (readonly [number, number])[]) {
    const { controller } = inkAnnotationTool;
    const [first, ...rest] = through;
    if (first === undefined) throw new Error('a scribble starts somewhere');
    let gesture = controller.begin(viewportPoint(first[0], first[1]));
    for (const [x, y] of rest) gesture = controller.update(gesture, viewportPoint(x, y));
    return gesture;
  }

  it('commits every kept point, converted to PDF user space', () => {
    const command = inkAnnotationTool.controller.commit(
      scribble([20, 20], [60, 40], [120, 20]),
      3,
      overlayTransform(PAGE),
    );
    expect(command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'ink',
        // At zoom 2 from the crop box's top-left corner (50, 400).
        points: [
          { x: 60, y: 390 },
          { x: 80, y: 380 },
          { x: 110, y: 390 },
        ],
        colour: [0.85, 0.15, 0.15],
        borderWidth: 2,
      },
    });
  });

  it('DECIMATES the path, which is the platform doing it rather than this tool', () => {
    // A pointer reports a move per frame, so an undecimated stroke is hundreds
    // of points for a short scribble and every one crosses to the kernel. Six
    // one-pixel steps are one kept point past the start; the LAST is exact,
    // which is what keeps a rectangle's corner from snapping.
    const gesture = scribble([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]);
    expect(gesture.points.length).toBeLessThan(6);
    expect(gesture.points[gesture.points.length - 1]).toStrictEqual(viewportPoint(5, 0));
  });

  it('CONTROL: points far apart are all kept', () => {
    // Without this, the case above is satisfied by a path that keeps only its
    // two ends — which would make ink a line tool with extra steps.
    expect(scribble([0, 0], [40, 0], [80, 0], [120, 0]).points).toHaveLength(4);
  });

  it('commits nothing for a scribble that went nowhere', () => {
    expect(
      inkAnnotationTool.controller.commit(scribble([40, 40], [41, 40]), 3, overlayTransform(PAGE)),
    ).toBeUndefined();
  });

  it('commits a scribble that RETURNS to where it started', () => {
    // THE THIRD THRESHOLD SHAPE in this file, and the reason it is per tool: a
    // loop's two ends are the same point, so the line tool's end-to-end test
    // calls it a click and the box tool's calls it empty. Only the path's own
    // extent sees it.
    expect(
      inkAnnotationTool.controller.commit(
        scribble([40, 40], [90, 90], [40, 40]),
        3,
        overlayTransform(PAGE),
      ),
    ).not.toBeUndefined();
  });

  it('CONTROL: the line tool refuses that same loop', () => {
    // Which is what says the two thresholds are different rules rather than one
    // written twice.
    const loop = scribble([40, 40], [90, 90], [40, 40]);
    expect(
      lineAnnotationTool.controller.commit(loop, 3, overlayTransform(PAGE)),
    ).toBeUndefined();
  });

  it('previews the path rather than a box around it', () => {
    expect(inkAnnotationTool.controller.preview(scribble([20, 20], [60, 40], [120, 20])))
      .toStrictEqual({
        shape: 'path',
        points: [
          [20, 20],
          [60, 40],
          [120, 20],
        ],
      });
  });
});

describe('every controller', () => {
  for (const tool of shapeTools) {
    it(`does not mutate the gesture it was given — ${tool.id}`, () => {
      // A controller that wrote through its argument would make two pages
      // sharing this object share a drag — and the registry hands the same
      // object to every page's overlay.
      const started = tool.controller.begin(viewportPoint(10, 10));
      tool.controller.update(started, viewportPoint(90, 90));
      expect(started.points).toStrictEqual([viewportPoint(10, 10)]);
    });
  }
});
