import type { AnnotationRect, RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { MINIMUM_BOX, PLACE_IMAGE_TOOL_ID, placeImageTool } from './placeImageTool.js';

/**
 * The place-image tool, driven without a DOM.
 *
 * ## What is asserted is the CALL, for `snapshotTool.test.ts`' reason
 *
 * This tool answers no `RenderableCommand`, so a case reading only `commit`'s
 * return would pass for a tool that did nothing: `undefined` is both the
 * correct answer and what a dead control gives. Every case here reads what
 * reached `onPlaceImage`, and the one that reads the return value asserts it
 * *stays* undefined — which is a separate claim, and a different one from the
 * snapshot's. A snapshot has nothing to log; this has something to log and the
 * renderer may not construct it, because `placeImage` carries an image and
 * `renderableCommandSchema` has it removed
 * ([ADR-0044](../../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
 *
 * The kernel half of the pair is `pageAnnotations.test.ts`' `applyPlaceImage`
 * block, which reads the written `/Stamp` back with pdf-lib. Neither half
 * counts alone.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The fixture every file in this directory shares: a non-zero origin and a
  // zoom that is not 1, so a tool passing pixels through would fail rather
  // than coincide.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** What one drag sent, or nothing if it sent nothing. */
function dragged(
  from: readonly [number, number],
  to: readonly [number, number],
): {
  readonly sent: readonly { page: number; rect: AnnotationRect }[];
  readonly command: RenderableCommand | undefined;
  readonly tool: UiTool;
} {
  const sent: { page: number; rect: AnnotationRect }[] = [];
  const tool = placeImageTool({
    onPlaceImage: (page, rect) => {
      sent.push({ page, rect });
    },
  });
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  const command = controller.commit(moved, 3, overlayTransform(PAGE)) as
    | RenderableCommand
    | undefined;
  return { sent, command, tool };
}

describe('the place-image tool', () => {
  it('sends the box it was dragged over, converted by the one adapter', () => {
    // (20, 20) at zoom 2 on a page whose visible box starts at (50, 400) is
    // (60, 390) — the conversion every file in this directory asserts, and the
    // reason an image placed over a region and a rectangle drawn over it carry
    // the same numbers.
    expect(dragged([20, 20], [120, 80]).sent).toStrictEqual([
      { page: 3, rect: { x0: 60, y0: 390, x1: 110, y1: 360 } },
    ]);
  });

  it('SENDS NOTHING TO THE COMMAND BUS, because this side cannot build that command', () => {
    // Not because there is nothing to undo — there is, and main's command
    // reaches the log like every other one. `placeImage` carries an image, so
    // `renderableCommandSchema` withholds it and this side could not construct
    // one if it wanted to.
    const { command, sent } = dragged([20, 20], [120, 80]);
    expect(command).toBeUndefined();
    // AND THE CALL WAS MADE, which is what stops the line above from passing
    // for a tool that does nothing: both halves are `undefined` for a dead
    // control and only one of them is for a working one.
    expect(sent).toHaveLength(1);
  });

  it('refuses a drag that did not travel in BOTH axes', () => {
    // A box flat in one direction has no area to draw an image into, and
    // refusing here is what keeps a slip from opening a file dialog. A line
    // tool's single-axis minimum would send both of these.
    expect(dragged([20, 20], [120, 20 + MINIMUM_BOX - 1]).sent).toStrictEqual([]);
    expect(dragged([20, 20], [20 + MINIMUM_BOX - 1, 120]).sent).toStrictEqual([]);
  });

  it('CONTROL: a drag just past the minimum in both axes IS sent', () => {
    // The partner the refusals need: a minimum written the wrong way round
    // refuses every drag, and the two cases above read as rigour while the tool
    // does nothing at all.
    expect(dragged([20, 20], [20 + MINIMUM_BOX + 1, 20 + MINIMUM_BOX + 1]).sent).toHaveLength(1);
  });

  it('previews the box as a rectangle', () => {
    const tool = placeImageTool({ onPlaceImage: () => undefined });
    const started = tool.controller.begin(viewportPoint(120, 80));
    const moved = tool.controller.update(started, viewportPoint(20, 20));
    // DRAGGED UP AND LEFT, so the preview's own normalisation is what is being
    // read: a rectangle with a negative width draws nothing in SVG.
    expect(tool.controller.preview(moved)).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
    });
  });

  it('sends an UNORDERED rectangle, because the kernel normalises', () => {
    // The rule is stated once, in `placedRect`, and a tool that ordered here
    // would be a second place it lives — agreeing today and diverging the first
    // time either changes.
    expect(dragged([120, 80], [20, 20]).sent[0]?.rect).toStrictEqual({
      x0: 110,
      y0: 360,
      x1: 60,
      y1: 390,
    });
  });

  it('claims the id its command selects', () => {
    expect(dragged([20, 20], [120, 80]).tool.id).toBe(PLACE_IMAGE_TOOL_ID);
  });
});
