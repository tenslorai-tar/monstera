import { asDocVersion, viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import type { ErasableAnnotation } from './eraserTool.js';
import type { AnnotationSelection } from './selectTool.js';
import { SELECT_TOOL_ID, selectTool } from './selectTool.js';

/**
 * The select tool's controller, driven without a DOM.
 *
 * The subject is which annotations it picked — and, as often, which it did not.
 * Every case drives a whole gesture, because the click and the marquee are the
 * same gesture told apart by how far it travelled.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The sibling files' fixture: a non-zero crop origin and a zoom that is not
  // 1, so a controller passing pixels through unconverted fails rather than
  // coincides. The visible box starts at (50, 400) and one CSS pixel is half a
  // point.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

const VERSION = asDocVersion(7);

/** PDF x 60–100, y 350–390 — screen (20,20) to (100,100). */
const A: ErasableAnnotation = { page: 3, index: 1, rect: { x0: 60, y0: 350, x1: 100, y1: 390 } };
/** PDF x 160–200, y 150–190 — screen (220,420) to (300,500). */
const B: ErasableAnnotation = { page: 3, index: 2, rect: { x0: 160, y0: 150, x1: 200, y1: 190 } };

function selecting(annotations: readonly ErasableAnnotation[] | undefined): {
  readonly drag: (
    from: readonly [number, number],
    to?: readonly [number, number],
    page?: number,
  ) => Promise<void>;
  readonly chosen: (AnnotationSelection | undefined)[];
} {
  const chosen: (AnnotationSelection | undefined)[] = [];
  const tool = selectTool({
    annotations: () =>
      Promise.resolve(annotations === undefined ? undefined : { version: VERSION, annotations }),
    onSelect: (selection) => {
      chosen.push(selection);
    },
  });
  return {
    drag: async (from, to = from, page = 3): Promise<void> => {
      const { controller } = tool;
      const started = controller.begin(viewportPoint(from[0], from[1]));
      const moved = controller.update(started, viewportPoint(to[0], to[1]));
      await controller.commit(moved, page, overlayTransform(PAGE));
    },
    chosen,
  };
}

describe('selectTool', () => {
  it('picks the annotation under a click, with the version the read carried', async () => {
    const { drag, chosen } = selecting([A, B]);
    await drag([40, 40]);
    expect(chosen).toStrictEqual([
      { page: 3, version: VERSION, items: [{ index: 1, rect: A.rect }] },
    ]);
  });

  it('picks EVERYTHING a marquee touches, which is what multi means here', async () => {
    // No modifier key is involved, and that is the design rather than a gap:
    // `Gesture` records what the pointer did, not what was held down while it
    // did it. A sweep across both boxes is how two are chosen.
    const { drag, chosen } = selecting([A, B]);
    await drag([10, 10], [400, 600]);
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([1, 2]);
  });

  it('TOUCHES rather than contains, so a big annotation is still reachable', async () => {
    // The separating case for the overlap rule. This marquee lies entirely
    // inside A's box and contains neither corner of it: a containment test
    // picks nothing, which reads as the tool being broken rather than as a rule.
    const { drag, chosen } = selecting([A, B]);
    await drag([40, 40], [60, 60]);
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([1]);
  });

  it('picks the TOPMOST of two that overlap, agreeing with the eraser', async () => {
    // Both tools must pick the same mark from the same pixel, or clicking to
    // select and clicking to erase disagree about what is under the pointer.
    const { drag, chosen } = selecting([
      { ...A, index: 4 },
      { ...A, index: 5 },
    ]);
    await drag([40, 40]);
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([5]);
  });

  it('clears on a click that hits nothing, rather than leaving the old one', async () => {
    // *Nothing is selected* is a real outcome and the dependency is called with
    // it. A tool that simply did not call would leave boxes on the page after a
    // click that visibly missed everything.
    const { drag, chosen } = selecting([A]);
    await drag([400, 20]);
    expect(chosen).toStrictEqual([undefined]);
  });

  it('ignores annotations on another page', async () => {
    const { drag, chosen } = selecting([{ ...A, page: 2 }]);
    await drag([40, 40]);
    expect(chosen).toStrictEqual([undefined]);
  });

  it('skips one whose page displays no region', async () => {
    // `rect: null` is *no place*, not *the whole page*. A marquee that swept the
    // page would otherwise collect it, and the selection would carry an item a
    // layer cannot draw.
    const { drag, chosen } = selecting([{ page: 3, index: 0, rect: null }]);
    await drag([0, 0], [500, 700]);
    expect(chosen).toStrictEqual([undefined]);
  });

  it('clears when there is no document, or the read was refused', async () => {
    // Cleared rather than left alone: whatever it named came from a document
    // that is now closed or unreadable.
    const { drag, chosen } = selecting(undefined);
    await drag([40, 40]);
    expect(chosen).toStrictEqual([undefined]);
  });

  it('produces NO command, ever', async () => {
    // Selecting changes nothing about the document. A command here would put a
    // version bump behind a click that was only meant to point at something —
    // and would then invalidate the selection it had just made.
    const tool = selectTool({
      annotations: () => Promise.resolve({ version: VERSION, annotations: [A] }),
      onSelect: () => undefined,
    });
    const started = tool.controller.begin(viewportPoint(40, 40));
    expect(await tool.controller.commit(started, 3, overlayTransform(PAGE))).toBeUndefined();
  });

  it('previews the marquee once the gesture is one, and not before', () => {
    const tool = selectTool({
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
    });
    const started = tool.controller.begin(viewportPoint(10, 10));
    // BELOW THE THRESHOLD the gesture is still a click, and a one-pixel
    // rectangle under the pointer would show a region about to be ignored.
    expect(tool.controller.preview(tool.controller.update(started, viewportPoint(12, 10)))).toBeUndefined();
    expect(tool.controller.preview(tool.controller.update(started, viewportPoint(60, 50)))).toStrictEqual({
      shape: 'rect',
      x: 10,
      y: 10,
      width: 50,
      height: 40,
    });
  });

  it('claims the id its command selects', () => {
    const tool = selectTool({
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
    });
    expect(tool.id).toBe(SELECT_TOOL_ID);
  });
});
