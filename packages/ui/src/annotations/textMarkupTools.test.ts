import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import {
  HIGHLIGHT_TOOL_ID,
  STRIKEOUT_TOOL_ID,
  UNDERLINE_TOOL_ID,
  textMarkupTools as buildMarkupTools,
} from './textMarkupTools.js';
import { PLAIN_STYLE } from './annotationStyle.js';

/** The three tools, built with the style that chooses nothing. */
const textMarkupTools = buildMarkupTools(PLAIN_STYLE);

/**
 * The three text markups' controllers, driven without a DOM.
 *
 * They are ordinary drag tools, which is the whole of what these cases have to
 * show: two points converted through the one adapter, and the run of text
 * between them left to the kernel.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

function toolFor(id: string): UiTool {
  const found = textMarkupTools.find((tool) => tool.id === id);
  if (found === undefined) throw new Error(`no tool ${id}`);
  return found;
}

function drag(
  tool: UiTool,
  from: readonly [number, number],
  to: readonly [number, number],
): RenderableCommand | undefined | Promise<RenderableCommand | undefined> {
  const started = tool.controller.begin(viewportPoint(from[0], from[1]));
  const moved = tool.controller.update(started, viewportPoint(to[0], to[1]));
  return tool.controller.commit(moved, 3, overlayTransform(PAGE));
}

describe('textMarkupTools', () => {
  it('sends the drag’s TWO ENDS in PDF space, not a rectangle', async () => {
    // The payload is where the selection starts and stops. A rectangle would
    // say *this region*, and the annotation is whole lines of text — the two
    // are different shapes and only one of them the kernel can resolve.
    expect(await drag(toolFor(HIGHLIGHT_TOOL_ID), [20, 20], [100, 30])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'highlight',
        // (20, 20) at zoom 2 on a page whose visible box starts at (50, 400).
        from: { x: 60, y: 390 },
        to: { x: 100, y: 385 },
        colour: [1, 0.9, 0.2],
        opacity: 1,
      },
    });
  });

  it('names its own subtype, which the panel then names apart', async () => {
    expect(await drag(toolFor(UNDERLINE_TOOL_ID), [20, 20], [100, 30])).toMatchObject({
      annotation: { type: 'underline' },
    });
    expect(await drag(toolFor(STRIKEOUT_TOOL_ID), [20, 20], [100, 30])).toMatchObject({
      annotation: { type: 'strikeout' },
    });
  });

  it('sends NOTHING for a click, rather than a command the kernel refuses', async () => {
    // The kernel refuses a degenerate selection anyway. Refusing here as well is
    // not a second opinion but a cheaper one: a stray click costs no round trip
    // and no version that never moved.
    expect(await drag(toolFor(HIGHLIGHT_TOOL_ID), [20, 20], [21, 20])).toBeUndefined();
  });

  it('previews a LINE, and only once the drag is one', () => {
    const { controller } = toolFor(HIGHLIGHT_TOOL_ID);
    const started = controller.begin(viewportPoint(20, 20));
    expect(controller.preview(controller.update(started, viewportPoint(21, 20)))).toBeUndefined();
    // A LINE RATHER THAN A RECTANGLE, because the annotation is not a region:
    // the box a person sweeps and the runs they get are different shapes, and a
    // rectangle would promise the one the kernel will not produce.
    expect(controller.preview(controller.update(started, viewportPoint(100, 30)))).toStrictEqual({
      shape: 'line',
      x1: 20,
      y1: 20,
      x2: 100,
      y2: 30,
    });
  });

  it('registers three tools with three ids', () => {
    expect(textMarkupTools.map((tool) => tool.id)).toStrictEqual([
      HIGHLIGHT_TOOL_ID,
      UNDERLINE_TOOL_ID,
      STRIKEOUT_TOOL_ID,
    ]);
  });
});
