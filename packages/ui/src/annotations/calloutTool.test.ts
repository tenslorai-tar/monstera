import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CALLOUT_DIALOG_ID } from '../dialogs/callout.js';
import type { Gesture, UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import { CALLOUT_TOOL_ID, calloutTool } from './calloutTool.js';

/**
 * The callout's controller — the first tool whose gesture really spans two
 * presses, driven without a DOM.
 *
 * The cases have to build a two-press gesture by hand, which is what the
 * overlay does: `begin` on the first press, `update` on each move, and a second
 * press that extends the same gesture rather than starting one.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

function built(answer: unknown): { readonly tool: UiTool; readonly asked: string[] } {
  const asked: string[] = [];
  const tool = calloutTool({
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(answer);
    },
    style: PLAIN_STYLE,
  });
  return { tool, asked };
}

/**
 * The gesture the overlay would have built: a press, a release, a second press
 * and a drag.
 *
 * `presses` is extended by hand exactly as `AnnotationOverlay`'s `down` does,
 * because that is the platform half this tool depends on — a case that called
 * `begin` twice would be testing a gesture the overlay never produces.
 */
function twoPress(
  tool: UiTool,
  at: readonly [number, number],
  then: readonly [number, number],
  to: readonly [number, number],
): Gesture {
  const { controller } = tool;
  const first = controller.begin(viewportPoint(at[0], at[1]));
  const second: Gesture = {
    ...controller.update(first, viewportPoint(then[0], then[1])),
    presses: [...first.presses, viewportPoint(then[0], then[1])],
  };
  return controller.update(second, viewportPoint(to[0], to[1]));
}

function commit(
  tool: UiTool,
  gesture: Gesture,
): RenderableCommand | undefined | Promise<RenderableCommand | undefined> {
  return tool.controller.commit(gesture, 3, overlayTransform(PAGE));
}

describe('calloutTool', () => {
  it('does NOT finish at the first release, which is the whole gesture', async () => {
    // Answering `true` here is what every other drag tool does and is exactly
    // what would make this impossible: the gesture would commit when the point
    // was pressed and the note's box would never be drawn.
    const { tool } = built({ text: 'see this' });
    const first = tool.controller.begin(viewportPoint(20, 20));
    expect(tool.controller.complete(first)).toBe(false);
    expect(await commit(tool, first)).toBeUndefined();
  });

  it('finishes at the SECOND release, and carries the point and the box', async () => {
    const { tool, asked } = built({ text: 'see this' });
    const gesture = twoPress(tool, [20, 20], [100, 100], [180, 140]);
    expect(tool.controller.complete(gesture)).toBe(true);
    expect(await commit(tool, gesture)).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'callout',
        // THE FIRST PRESS IS WHAT IT POINTS AT — (20, 20) at zoom 2 over a box
        // starting at (50, 400) is (60, 390) — and the SECOND PRESS is the
        // box's corner. A tool reading `startOf` for both would put the note on
        // top of the thing it is meant to be talking about.
        at: { x: 60, y: 390 },
        rect: { x0: 100, y0: 350, x1: 140, y1: 330 },
        text: 'see this',
        colour: [0.85, 0.15, 0.15],
        opacity: 1,
        fontSize: 12,
      },
    });
    expect(asked).toStrictEqual([CALLOUT_DIALOG_ID]);
  });

  it('sends nothing, and ASKS NOTHING, when the second press did not drag', async () => {
    // A note with no box is a callout pointing at something and saying it
    // nowhere. Asserted on `asked` as well, so a tool that opened the dialog and
    // then discarded the answer is not mistaken for this.
    const { tool, asked } = built({ text: 'see this' });
    expect(await commit(tool, twoPress(tool, [20, 20], [100, 100], [102, 101]))).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });

  it('sends nothing when the dialog is dismissed', async () => {
    const { tool } = built(undefined);
    expect(await commit(tool, twoPress(tool, [20, 20], [100, 100], [180, 140]))).toBeUndefined();
  });

  it('previews the LEADER first and the BOX after, one shape at a time', () => {
    const { tool } = built(undefined);
    const aiming = tool.controller.update(
      tool.controller.begin(viewportPoint(20, 20)),
      viewportPoint(60, 70),
    );
    // While one press has happened the line is what is being aimed.
    expect(tool.controller.preview(aiming)).toStrictEqual({
      shape: 'line',
      x1: 20,
      y1: 20,
      x2: 60,
      y2: 70,
    });
    // Once the box is being dragged the leader is settled and the box is what
    // is moving. The preview union has no member carrying both, and adding one
    // for this tool would put a tool's composition in the overlay's switch.
    expect(tool.controller.preview(twoPress(tool, [20, 20], [100, 100], [180, 140]))).toStrictEqual(
      { shape: 'rect', x: 100, y: 100, width: 80, height: 40 },
    );
  });

  it('claims the id its command selects', () => {
    expect(built(undefined).tool.id).toBe(CALLOUT_TOOL_ID);
  });
});
