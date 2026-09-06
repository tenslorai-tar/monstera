import type { AnnotationRect, RenderableCommand } from '@monstera/contract';
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
const A_RECT: AnnotationRect = { x0: 60, y0: 350, x1: 100, y1: 390 };
const A: ErasableAnnotation = { page: 3, index: 1, rect: A_RECT };
/** PDF x 160–200, y 150–190 — screen (220,420) to (300,500). */
const B_RECT: AnnotationRect = { x0: 160, y0: 150, x1: 200, y1: 190 };
const B: ErasableAnnotation = { page: 3, index: 2, rect: B_RECT };

function selecting(
  annotations: readonly ErasableAnnotation[] | undefined,
  selected?: AnnotationSelection,
): {
  readonly drag: (
    from: readonly [number, number],
    to?: readonly [number, number],
    page?: number,
  ) => Promise<RenderableCommand | undefined>;
  readonly chosen: (AnnotationSelection | undefined)[];
} {
  const chosen: (AnnotationSelection | undefined)[] = [];
  const tool = selectTool({
    annotations: () =>
      Promise.resolve(annotations === undefined ? undefined : { version: VERSION, annotations }),
    onSelect: (selection) => {
      chosen.push(selection);
    },
    selected: () => selected,
  });
  return {
    drag: async (from, to = from, page = 3): Promise<RenderableCommand | undefined> => {
      const { controller } = tool;
      const started = controller.begin(viewportPoint(from[0], from[1]));
      const moved = controller.update(started, viewportPoint(to[0], to[1]));
      return controller.commit(moved, page, overlayTransform(PAGE));
    },
    chosen,
  };
}

describe('selectTool', () => {
  it('picks the annotation under a click, with the version the read carried', async () => {
    const { drag, chosen } = selecting([A, B]);
    await drag([40, 40]);
    expect(chosen).toStrictEqual([
      { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT }] },
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
      selected: () => undefined,
    });
    const started = tool.controller.begin(viewportPoint(40, 40));
    expect(await tool.controller.commit(started, 3, overlayTransform(PAGE))).toBeUndefined();
  });

  it('previews the marquee once the gesture is one, and not before', () => {
    const tool = selectTool({
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
      selected: () => undefined,
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

  it('MOVES the selection when the drag starts inside it', async () => {
    // A drag that begins on something already selected is an edit, not a pick.
    // Asked before the read, because what is selected is state this tool holds.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT }] };
    const { drag, chosen } = selecting([A, B], selected);
    // (40, 40) is inside A; (60, 40) is 20 pixels right, which at zoom 2 is 10
    // points in PDF space and nothing at all vertically.
    expect(await drag([40, 40], [60, 40])).toStrictEqual({
      kind: 'placeAnnotation',
      page: 3,
      placements: [{ index: 1, rect: { x0: 70, y0: 350, x1: 110, y1: 390 } }],
      version: VERSION,
    });
    // AND IT DID NOT ALSO RE-SELECT. Testing for a marquee first is the wrong
    // order and its symptom is exactly this: the drag would replace the
    // selection with whatever it swept.
    expect(chosen).toStrictEqual([]);
  });

  it('moves EVERY selected annotation by the same delta', async () => {
    const selected = {
      page: 3,
      version: VERSION,
      items: [
        { index: 1, rect: A_RECT },
        { index: 2, rect: B_RECT },
      ],
    };
    const { drag } = selecting([A, B], selected);
    const command = await drag([40, 40], [60, 40]);
    expect(command).toMatchObject({
      placements: [
        { index: 1, rect: { x0: 70, y0: 350, x1: 110, y1: 390 } },
        { index: 2, rect: { x0: 170, y0: 150, x1: 210, y1: 190 } },
      ],
    });
  });

  it('RESIZES the one whose corner was grabbed, keeping the opposite corner', async () => {
    // A's box is screen (20,20)–(100,100). Grabbing the bottom-right corner and
    // dragging to (140, 140) must keep (20, 20) fixed — an implementation that
    // used the drag's own two ends would produce the box (100,100)–(140,140),
    // which is a different rectangle entirely.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT }] };
    const { drag } = selecting([A], selected);
    expect(await drag([100, 100], [140, 140])).toStrictEqual({
      kind: 'placeAnnotation',
      page: 3,
      placements: [{ index: 1, rect: { x0: 60, y0: 330, x1: 120, y1: 390 } }],
      version: VERSION,
    });
  });

  it('resizes only that one, even when several are selected', async () => {
    // Grabbing a handle means *make this that size*. Scaling four marks from one
    // corner is a different operation, and nobody asked for it by taking hold of
    // a corner.
    const selected = {
      page: 3,
      version: VERSION,
      items: [
        { index: 1, rect: A_RECT },
        { index: 2, rect: B_RECT },
      ],
    };
    const { drag } = selecting([A, B], selected);
    const command = await drag([100, 100], [140, 140]);
    expect((command as unknown as { placements: unknown[] }).placements).toHaveLength(1);
  });

  it('CLICKING a selected annotation re-selects rather than moving it by nothing', async () => {
    // A press that did not travel is not a drag. Without this the tool commits a
    // zero-length placement — a version bump, an undo entry and a document that
    // is byte-identical — every time somebody clicks what is already selected.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT }] };
    const { drag, chosen } = selecting([A], selected);
    expect(await drag([40, 40])).toBeUndefined();
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([1]);
  });

  it('marquees when the drag starts OUTSIDE the selection', async () => {
    // The control for the two above: the same tool, the same selection, a press
    // that begins on empty paper. If this produced a placement the tool would
    // have become impossible to select with once anything was selected.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT }] };
    const { drag, chosen } = selecting([A, B], selected);
    expect(await drag([200, 400], [400, 600])).toBeUndefined();
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([2]);
  });

  it('ignores a selection belonging to another page', async () => {
    const selected = { page: 9, version: VERSION, items: [{ index: 1, rect: A_RECT }] };
    const { drag } = selecting([A], selected);
    expect(await drag([40, 40], [60, 40])).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    const tool = selectTool({
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
      selected: () => undefined,
    });
    expect(tool.id).toBe(SELECT_TOOL_ID);
  });
});
