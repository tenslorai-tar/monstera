import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import { RECTANGLE_TOOL_ID, rectangleTool } from './rectangleTool.js';

/**
 * The rectangle tool's controller, driven without a DOM.
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

const { controller } = rectangleTool;

/** Drives a whole drag and returns whatever `commit` decided. */
function drag(
  from: readonly [number, number],
  to: readonly [number, number],
  page = 3,
): ReturnType<typeof controller.commit> {
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('the rectangle tool', () => {
  it('is registered under the id its command uses', () => {
    // The two registries are joined by this value and by nothing else, so an
    // id that merely resembled the command's would select nothing, silently.
    expect(rectangleTool.id).toBe(RECTANGLE_TOOL_ID);
  });

  it('commits an addAnnotation naming the page it was drawn on', () => {
    // THE PAGE COMES FROM THE OVERLAY, which is the slot the pointer went down
    // on — so a fixture at page 0 would let an implementation that sent a
    // literal zero pass. That is the exact defect the rotate shipped with.
    expect(drag([20, 20], [120, 80], 3)).toStrictEqual({
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

  it('carries the corners in the order they were dragged', () => {
    // A drag that ran up and to the left is the same rectangle by its other
    // diagonal, and the kernel is what orders it. An implementation that
    // ordered here as well would answer identically for both directions, and
    // the disagreement about a degenerate drag would live in two places.
    const command = drag([120, 80], [20, 20]);
    expect(command?.kind === 'addAnnotation' ? command.annotation.rect : undefined).toStrictEqual({
      x0: 110,
      y0: 360,
      x1: 60,
      y1: 390,
    });
  });

  it('commits nothing for a click that did not drag', () => {
    expect(drag([40, 40], [40, 40])).toBeUndefined();
  });

  it('commits nothing for a drag shorter than the threshold on EITHER axis', () => {
    // BOTH AXES, not the diagonal: 40 by 1 is a distance of 40, which a
    // distance test accepts, and it is a line nobody meant to draw.
    expect(drag([40, 40], [80, 41])).toBeUndefined();
    expect(drag([40, 40], [41, 80])).toBeUndefined();
  });

  it('CONTROL: a drag past the threshold on both axes does commit', () => {
    // Without this, the two cases above are satisfied by a controller that
    // commits nothing at all.
    expect(drag([40, 40], [80, 80])).not.toBeUndefined();
  });

  it('previews nothing until the gesture would commit', () => {
    // The same threshold rather than a second one: a preview that appeared for
    // a drag the tool then discards is a control that showed something and did
    // nothing.
    const started = controller.begin(viewportPoint(40, 40));
    expect(controller.preview(started)).toBeUndefined();
    expect(controller.preview(controller.update(started, viewportPoint(42, 42)))).toBeUndefined();
  });

  it('previews the box in the overlay\'s own pixels, ordered', () => {
    // ORDERED HERE and unordered in the command, which is not an inconsistency:
    // a preview is a box on screen and SVG has no meaning for a negative width,
    // where the command's rectangle is a pair of document corners.
    const started = controller.begin(viewportPoint(120, 80));
    const preview = controller.preview(controller.update(started, viewportPoint(20, 20)));
    expect(preview).toStrictEqual({ shape: 'rect', x: 20, y: 20, width: 100, height: 60 });
  });

  it('does not mutate the gesture it was given', () => {
    // A controller that wrote through its argument would make two pages sharing
    // this object share a drag — and the registry hands the same object to
    // every page's overlay.
    const started = controller.begin(viewportPoint(10, 10));
    controller.update(started, viewportPoint(90, 90));
    expect(started.to).toStrictEqual(viewportPoint(10, 10));
  });
});
