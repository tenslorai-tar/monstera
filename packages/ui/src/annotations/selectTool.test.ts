import type { AnnotationRect, AnnotationWordsStyle, DispatchableCommand } from '@monstera/contract';
import { asDocVersion, viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import type { ErasableAnnotation } from './eraserTool.js';
import type { PageLinkOnPage } from '../usePageLinks.js';
import type { AnnotationSelection, LinkSelection } from './selectTool.js';
import { SELECT_TOOL_ID, carrySelection, selectTool, selectionOfNewest, selectionOfPage } from './selectTool.js';

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

/** The style the selection carries through to the comment styles panel. */
const PLAIN = { colour: [1, 0, 0], opacity: 1, borderWidth: 2 } as const;
/**
 * Everything the walk answers beside a handle and a box.
 *
 * One constant rather than three fields repeated at a dozen sites, so what the
 * selection carries can grow without this file gaining a dozen edits. None of
 * these cases reads any of it — they are about which boxes a marquee picks.
 */
const CARRIED = { style: PLAIN, kind: 'square', contents: '', author: '', created: null, blend: 'normal' } as const;

/** What a reopen needs, REFUSING BY NAME: these cases select, and a case that reached the page writer fails at it. */
const NO_REOPEN = {
  write: () => Promise.reject(new Error('this case types nothing')),
  wordsOf: () => Promise.reject(new Error('this case reads no words')),
  ask: () => Promise.reject(new Error('this case opens no dialog')),
} as const;

/** No links on any page, and none selected: these cases are about annotations. */
const NO_LINKS = {
  links: () => Promise.resolve(undefined),
  onSelectLink: () => undefined,
  selectedLink: () => undefined,
} as const;

/** PDF x 60–100, y 350–390 — screen (20,20) to (100,100). */
const A_RECT: AnnotationRect = { x0: 60, y0: 350, x1: 100, y1: 390 };
const A: ErasableAnnotation = { page: 3, index: 1, rect: A_RECT, ...CARRIED };
/** PDF x 160–200, y 150–190 — screen (220,420) to (300,500). */
const B_RECT: AnnotationRect = { x0: 160, y0: 150, x1: 200, y1: 190 };
const B: ErasableAnnotation = { page: 3, index: 2, rect: B_RECT, ...CARRIED };

function selecting(
  annotations: readonly ErasableAnnotation[] | undefined,
  selected?: AnnotationSelection,
): {
  readonly drag: (
    from: readonly [number, number],
    to?: readonly [number, number],
    page?: number,
  ) => Promise<DispatchableCommand | undefined>;
  readonly chosen: (AnnotationSelection | undefined)[];
} {
  const chosen: (AnnotationSelection | undefined)[] = [];
  const tool = selectTool({
    ...NO_REOPEN, ...NO_LINKS,
    annotations: () =>
      Promise.resolve(annotations === undefined ? undefined : { version: VERSION, annotations }),
    onSelect: (selection) => {
      chosen.push(selection);
    },
    selected: () => selected,
  });
  return {
    drag: async (from, to = from, page = 3): Promise<DispatchableCommand | undefined> => {
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
      { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] },
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
    const { drag, chosen } = selecting([{ page: 3, index: 0, rect: null, ...CARRIED }]);
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
      ...NO_REOPEN, ...NO_LINKS,
      annotations: () => Promise.resolve({ version: VERSION, annotations: [A] }),
      onSelect: () => undefined,
      selected: () => undefined,
    });
    const started = tool.controller.begin(viewportPoint(40, 40));
    expect(await tool.controller.commit(started, 3, overlayTransform(PAGE))).toBeUndefined();
  });

  it('previews the marquee once the gesture is one, and not before', () => {
    const tool = selectTool({
      ...NO_REOPEN, ...NO_LINKS,
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
      selected: () => undefined,
    });
    const started = tool.controller.begin(viewportPoint(10, 10));
    // BELOW THE THRESHOLD the gesture is still a click, and a one-pixel
    // rectangle under the pointer would show a region about to be ignored.
    expect(tool.controller.preview(tool.controller.update(started, viewportPoint(12, 10)), 3, overlayTransform(PAGE))).toBeUndefined();
    expect(tool.controller.preview(tool.controller.update(started, viewportPoint(60, 50)), 3, overlayTransform(PAGE))).toStrictEqual({
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
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
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
        { index: 1, rect: A_RECT, ...CARRIED },
        { index: 2, rect: B_RECT, ...CARRIED },
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
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const { drag } = selecting([A], selected);
    expect(await drag([100, 100], [140, 140])).toStrictEqual({
      kind: 'placeAnnotation',
      page: 3,
      placements: [{ index: 1, rect: { x0: 60, y0: 330, x1: 120, y1: 390 } }],
      version: VERSION,
    });
  });

  it('a SIDE midpoint pulls that edge alone, the other three kept — CONTROL: a line has no side handle, so the same press moves it', async () => {
    // A's right edge midpoint is screen (100, 60). Dragging it to (140, 70) moves x1 only: the y of the drag is NOT used,
    // so the box does not grow downwards as well.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const { drag } = selecting([A], selected);
    expect(await drag([100, 60], [140, 70])).toStrictEqual({
      kind: 'placeAnnotation',
      page: 3,
      placements: [{ index: 1, rect: { x0: 60, y0: 350, x1: 120, y1: 390 } }],
      version: VERSION,
    });
    const asLine = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED, kind: 'line' as const }] };
    const control = selecting([A], asLine);
    expect(await control.drag([100, 60], [140, 70])).toStrictEqual({
      kind: 'placeAnnotation',
      page: 3,
      placements: [{ index: 1, rect: { x0: 80, y0: 345, x1: 120, y1: 385 } }],
      version: VERSION,
    });
  });

  describe('the pointer says what a press would do (ADR-0201)', () => {
    const selected: AnnotationSelection = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const toolOver = (sel: AnnotationSelection | undefined) =>
      selectTool({
        ...NO_REOPEN, ...NO_LINKS,
        annotations: () => Promise.resolve({ version: VERSION, annotations: [A] }),
        onSelect: () => undefined,
        selected: () => sel,
      });
    const pointerAt = (x: number, y: number, sel: AnnotationSelection | undefined = selected, page = 3) =>
      toolOver(sel).controller.pointer(viewportPoint(x, y), page, overlayTransform(PAGE));

    it('names the right arrow for each corner and each edge of a selected box (screen (20,20)–(100,100)), and move inside it', () => {
      // CORNERS: top-left and bottom-right pull along one diagonal, top-right and bottom-left along the other.
      expect(pointerAt(20, 20)).toBe('resize-nwse');
      expect(pointerAt(100, 100)).toBe('resize-nwse');
      expect(pointerAt(100, 20)).toBe('resize-nesw');
      expect(pointerAt(20, 100)).toBe('resize-nesw');
      // EDGES: the top and bottom midpoints pull vertically, the left and right ones sideways.
      expect(pointerAt(60, 20)).toBe('resize-ns');
      expect(pointerAt(60, 100)).toBe('resize-ns');
      expect(pointerAt(20, 60)).toBe('resize-ew');
      expect(pointerAt(100, 60)).toBe('resize-ew');
      expect(pointerAt(45, 45)).toBe('move');
    });

    it('says NOTHING outside the selection, with no selection, and for a selection on another page — the tool’s own arrow', () => {
      expect(pointerAt(300, 300)).toBeUndefined();
      // `pointerAt`'s default would stand in for an `undefined`, so this asks the tool directly.
      expect(toolOver(undefined).controller.pointer(viewportPoint(40, 40), 3, overlayTransform(PAGE))).toBeUndefined();
      expect(pointerAt(40, 40, selected, 4)).toBeUndefined();
    });

    it('CONTROL: a line has no edge handle, so the same point is a move — and so the pointer follows the hit test, not the geometry', () => {
      const line: AnnotationSelection = { ...selected, items: [{ index: 1, rect: A_RECT, ...CARRIED, kind: 'line' as const }] };
      expect(pointerAt(100, 60, line)).toBe('move');
      expect(pointerAt(100, 100, line)).toBe('resize-nwse');
    });

    it('AGREES WITH THE PRESS: dragging from a point the pointer calls a resize changes a size, and from one it calls a move changes none', async () => {
      const resized = selecting([A], selected);
      const widthOf = (command: DispatchableCommand | undefined): number => {
        if (command?.kind !== 'placeAnnotation') throw new Error('expected a placement');
        const placed = command.placements[0];
        if (placed === undefined || !('rect' in placed)) throw new Error('expected a rect');
        return placed.rect.x1 - placed.rect.x0;
      };
      expect(widthOf(await resized.drag([100, 60], [140, 60]))).toBe(60);
      expect(pointerAt(100, 60)).toBe('resize-ew');
      const moved = selecting([A], selected);
      expect(widthOf(await moved.drag([45, 45], [85, 45]))).toBe(40);
      expect(pointerAt(45, 45)).toBe('move');
    });
  });

  it('PREVIEWS a move and a resize where the release will put the marks (ADR-0166) — CONTROL: a marquee stays one', () => {
    const selected = {
      page: 3,
      version: VERSION,
      items: [
        { index: 1, rect: A_RECT, ...CARRIED },
        { index: 2, rect: B_RECT, ...CARRIED },
      ],
    };
    const tool = selectTool({
      ...NO_REOPEN, ...NO_LINKS,
      annotations: () => Promise.resolve({ version: VERSION, annotations: [A, B] }),
      onSelect: () => undefined,
      selected: () => selected,
    });
    const { controller } = tool;
    const previewOf = (from: readonly [number, number], to: readonly [number, number]): unknown =>
      controller.preview(
        controller.update(controller.begin(viewportPoint(from[0], from[1])), viewportPoint(to[0], to[1])),
        3,
        overlayTransform(PAGE),
      );
    // A MOVE, from inside A: BOTH boxes, each 20 px right of where it is — A at (20,20)–(100,100), B at
    // (220,420)–(300,500). The box from the press to the pointer, (40,40)–(60,40), is what was drawn before.
    expect(previewOf([40, 40], [60, 40])).toStrictEqual({
      shape: 'boxes',
      boxes: [
        { x: 40, y: 20, width: 80, height: 80 },
        { x: 240, y: 420, width: 80, height: 80 },
      ],
    });
    // A RESIZE by A's bottom-right corner to (140, 140): A alone, its top-left kept.
    expect(previewOf([100, 100], [140, 140])).toStrictEqual({
      shape: 'boxes',
      boxes: [{ x: 20, y: 20, width: 120, height: 120 }],
    });
    // CONTROL: a drag that starts on neither is a marquee, drawn as the box it sweeps.
    expect(previewOf([150, 150], [190, 180])).toStrictEqual({ shape: 'rect', x: 150, y: 150, width: 40, height: 30 });
  });

  it('resizes only that one, even when several are selected', async () => {
    // Grabbing a handle means *make this that size*. Scaling four marks from one
    // corner is a different operation, and nobody asked for it by taking hold of
    // a corner.
    const selected = {
      page: 3,
      version: VERSION,
      items: [
        { index: 1, rect: A_RECT, ...CARRIED },
        { index: 2, rect: B_RECT, ...CARRIED },
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
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const { drag, chosen } = selecting([A], selected);
    expect(await drag([40, 40])).toBeUndefined();
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([1]);
  });

  it('marquees when the drag starts OUTSIDE the selection', async () => {
    // The control for the two above: the same tool, the same selection, a press
    // that begins on empty paper. If this produced a placement the tool would
    // have become impossible to select with once anything was selected.
    const selected = { page: 3, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const { drag, chosen } = selecting([A, B], selected);
    expect(await drag([200, 400], [400, 600])).toBeUndefined();
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([2]);
  });

  it('ignores a selection belonging to another page', async () => {
    const selected = { page: 9, version: VERSION, items: [{ index: 1, rect: A_RECT, ...CARRIED }] };
    const { drag } = selecting([A], selected);
    expect(await drag([40, 40], [60, 40])).toBeUndefined();
  });

  it('a DOUBLE-CLICK on a text mark opens its words in its own box and sends the edit; on a square it opens nothing', async () => {
    // The first click has selected the mark; the second, with no gesture in flight, is `reopen` (ADR-0154
    // Decision 3). The square is the control: a mark whose words are its comment is Edit comment's, so the same
    // double-click there must ask the page for nothing.
    const typed: AnnotationWordsStyle = { fontSize: 11, colour: [0, 0, 0], font: 'sans', direction: 'left-to-right' };
    const words: ErasableAnnotation = { ...A, kind: 'typewriter', contents: 'Due Friday', typed };
    const asked: unknown[] = [];
    const tool = selectTool({
      ...NO_REOPEN, ...NO_LINKS,
      write: (request) => {
        asked.push(request);
        return Promise.resolve('Due Monday');
      },
      wordsOf: (mark) => Promise.resolve({ kind: 'words', text: mark.contents }),
      annotations: () => Promise.resolve({ version: VERSION, annotations: [words, B] }),
      onSelect: () => undefined,
      selected: () => undefined,
    });
    expect(await tool.controller.reopen(viewportPoint(40, 40), 3, overlayTransform(PAGE))).toStrictEqual({
      kind: 'editAnnotationText',
      page: 3,
      index: 1,
      text: 'Due Monday',
      version: VERSION,
    });
    expect(asked).toMatchObject([{ box: A_RECT, initial: 'Due Friday', style: typed }]);
    expect(await tool.controller.reopen(viewportPoint(260, 460), 3, overlayTransform(PAGE))).toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it('claims the id its command selects', () => {
    const tool = selectTool({
      ...NO_REOPEN, ...NO_LINKS,
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
      selected: () => undefined,
    });
    expect(tool.id).toBe(SELECT_TOOL_ID);
  });
});

describe('carrySelection (ADR-0102)', () => {
  const BEFORE = asDocVersion(7);
  const AFTER = asDocVersion(8);
  const BOX = { x0: 10, y0: 10, x1: 20, y1: 20 };
  const picked: AnnotationSelection = {
    page: 1,
    version: BEFORE,
    items: [{ index: 2, rect: BOX, ...CARRIED }],
  };
  /** The walk after a restyle: the same marks, the picked one now blue and saying something. */
  const walk = {
    version: AFTER,
    annotations: [
      { page: 1, index: 1, rect: BOX, ...CARRIED },
      {
        page: 1,
        index: 2,
        rect: BOX,
        style: { colour: [0, 0, 1], opacity: 0.4, borderWidth: 2 },
        kind: 'square',
        contents: 'done',
        author: 'Sam Okafor',
        created: '2026-09-24T09:38:00.000Z',
        blend: 'multiply',
      },
      { page: 2, index: 2, rect: BOX, ...CARRIED },
    ],
  } as const;

  it('names the SAME index at the new version, with every field read from the new walk', () => {
    expect(carrySelection(picked, { page: 1, version: BEFORE }, AFTER, walk)).toStrictEqual({
      page: 1,
      version: AFTER,
      items: [
        {
          index: 2,
          rect: BOX,
          style: { colour: [0, 0, 1], opacity: 0.4, borderWidth: 2 },
          kind: 'square',
          contents: 'done',
          author: 'Sam Okafor',
          created: '2026-09-24T09:38:00.000Z',
          blend: 'multiply',
        },
      ],
    });
  });

  it('DROPS it when the read answers any other version, because something else moved the document', () => {
    expect(carrySelection(picked, { page: 1, version: BEFORE }, AFTER, { ...walk, version: asDocVersion(9) })).toBeUndefined();
    expect(carrySelection(picked, { page: 1, version: BEFORE }, AFTER, undefined)).toBeUndefined();
  });

  it('DROPS it when the walk no longer answers a picked index', () => {
    const shorter = { ...walk, annotations: walk.annotations.filter((entry) => entry.index !== 2 || entry.page !== 1) };
    expect(carrySelection(picked, { page: 1, version: BEFORE }, AFTER, shorter)).toBeUndefined();
  });

  it('LEAVES ALONE a selection other than the one the command was composed from', () => {
    // A person who picked something else while the command was in flight keeps what they picked; the
    // version check in `App` then decides whether it still describes the document.
    const other: AnnotationSelection = { ...picked, version: asDocVersion(6) };
    expect(carrySelection(other, { page: 1, version: BEFORE }, AFTER, walk)).toBe(other);
    const elsewhere: AnnotationSelection = { ...picked, page: 2 };
    expect(carrySelection(elsewhere, { page: 1, version: BEFORE }, AFTER, walk)).toBe(elsewhere);
  });
});

describe('selectionOfPage (ADR-0107, Edit › Select all)', () => {
  const VERSION = asDocVersion(4);

  it('selects every mark ON THE PAGE that draws a region, at the walk’s own version', () => {
    const walk = {
      version: VERSION,
      annotations: [A, B, { ...A, page: 4, index: 1 }, { ...B, index: 3, rect: null }],
    };
    expect(selectionOfPage(walk, 3)).toStrictEqual({
      page: 3,
      version: VERSION,
      items: [
        { index: 1, rect: A_RECT, ...CARRIED },
        { index: 2, rect: B_RECT, ...CARRIED },
      ],
    });
  });

  it('CONTROL: a page with no drawable mark is NOTHING selected — never an empty selection', () => {
    const walk = { version: VERSION, annotations: [A, { ...B, page: 5, rect: null }] };
    expect(selectionOfPage(walk, 5)).toBeUndefined();
    expect(selectionOfPage(walk, 9)).toBeUndefined();
  });
});

describe('selectionOfNewest (ADR-0133, the signature just placed)', () => {
  const VERSION = asDocVersion(6);

  it('selects the page’s HIGHEST index, which is the mark just added, and only it', () => {
    // THE NEWER MARK IS LISTED FIRST and another page holds a higher index still, so a rule taking the last entry or
    // the highest index anywhere selects the wrong one.
    const walk = { version: VERSION, annotations: [B, A, { ...A, page: 4, index: 9 }] };
    expect(selectionOfNewest(walk, 3)).toStrictEqual({
      page: 3,
      version: VERSION,
      items: [{ index: 2, rect: B_RECT, ...CARRIED }],
    });
  });

  it('CONTROL: a page with no mark is nothing selected', () => {
    expect(selectionOfNewest({ version: VERSION, annotations: [A] }, 5)).toBeUndefined();
  });
});

describe('a line’s ENDS and a polygon’s CORNERS are its handles (the owner’s O8)', () => {
  /**
   * A distance nearly flat, as a hand draws one: PDF (60,350) to (150,351), on screen (20,100) to (200,98). Its box,
   * which carries the label, is taller than the line, so a box corner and an end are different places.
   */
  const DISTANCE_ITEM = {
    index: 1,
    rect: { x0: 55, y0: 340, x1: 155, y1: 360 },
    ...CARRIED,
    kind: 'measure-distance',
    points: [
      { x: 60, y: 350 },
      { x: 150, y: 351 },
    ],
  } as const;
  const SELECTED: AnnotationSelection = { page: 3, version: VERSION, items: [DISTANCE_ITEM] };

  it('dragging an END moves that end alone, to the point released on, by points and not by a box', async () => {
    const { drag } = selecting([], SELECTED);
    expect(await drag([200, 98], [240, 98])).toStrictEqual({
      kind: 'reshapeAnnotation',
      page: 3,
      index: 1,
      points: [{ x: 60, y: 350 }, { x: 170, y: 351 }],
      version: VERSION,
    });
  });

  it('CONTROL: the box’s corner is no handle on a line; a press there inside the box MOVES it, keeping its size', async () => {
    const { drag } = selecting([], SELECTED);
    const command = await drag([208, 82], [228, 82]);
    if (command?.kind !== 'placeAnnotation') throw new Error('expected a placement');
    const [placed] = command.placements;
    if (placed === undefined || !('rect' in placed)) throw new Error('expected a move by its box');
    expect(placed.rect.x1 - placed.rect.x0).toBe(100);
    expect(placed.rect.x0).toBe(65);
  });

  it('the preview of an end being dragged is the line’s OUTLINE where it goes, never a tinted box', () => {
    const tool = selectTool({ ...NO_REOPEN, ...NO_LINKS, annotations: () => Promise.resolve(undefined), onSelect: () => undefined, selected: () => SELECTED });
    const started = tool.controller.begin(viewportPoint(200, 98));
    const preview = tool.controller.preview(tool.controller.update(started, viewportPoint(240, 98)), 3, overlayTransform(PAGE));
    expect(preview).toStrictEqual({ shape: 'boxes', boxes: [], paths: [{ points: [[20, 100], [240, 98]], closed: false }] });
    // AND A MOVE BY THE BOX previews the outline too, carried by the move.
    const moving = tool.controller.update(tool.controller.begin(viewportPoint(100, 99)), viewportPoint(120, 99));
    expect(tool.controller.preview(moving, 3, overlayTransform(PAGE))).toMatchObject({ boxes: [], paths: [{ points: [[40, 100], [220, 98]] }] });
    // THE POINTER says a press on an end moves it.
    expect(tool.controller.pointer(viewportPoint(20, 100), 3, overlayTransform(PAGE))).toBe('move');
  });
});

describe('the select tool and a LINK (the owner’s O6(c): selected, moved and resized like a box)', () => {
  const LINKS_AT = asDocVersion(8);
  /**
   * A web link in the ENGINE's frame, at scale 1 from the crop's top-left: on `PAGE` (crop origin 50,100 top 400, zoom 2)
   * it is drawn at screen (200,20) to (300,60), which is PDF x 150 to 200, y 370 to 390. Clear of A, so a click on it
   * reaches no mark.
   */
  const LINK: PageLinkOnPage = { kind: 'external', uri: 'https://example.org/', bounds: { x0: 100, y0: 10, x1: 150, y1: 30 }, outline: 'thin' };
  /** A page link drawn exactly where A is, screen (20,20) to (100,100): what a mark over a link looks like. */
  const UNDER_A: PageLinkOnPage = { kind: 'internal', page: 0, bounds: { x0: 10, y0: 10, x1: 50, y1: 50 }, outline: 'thin' };

  function linking(links: readonly PageLinkOnPage[], selectedLink?: LinkSelection) {
    const chosen: (AnnotationSelection | undefined)[] = [];
    const chosenLinks: (LinkSelection | undefined)[] = [];
    const asked: number[] = [];
    const tool = selectTool({
      ...NO_REOPEN,
      annotations: () => Promise.resolve({ version: VERSION, annotations: [A] }),
      onSelect: (selection) => {
        chosen.push(selection);
      },
      selected: () => undefined,
      links: (page) => {
        asked.push(page);
        return Promise.resolve({ version: LINKS_AT, links });
      },
      onSelectLink: (selection) => {
        chosenLinks.push(selection);
      },
      selectedLink: () => selectedLink,
    });
    const drag = async (from: readonly [number, number], to = from, page = 3): Promise<DispatchableCommand | undefined> => {
      const started = tool.controller.begin(viewportPoint(from[0], from[1]));
      return tool.controller.commit(tool.controller.update(started, viewportPoint(to[0], to[1])), page, overlayTransform(PAGE));
    };
    return { drag, chosen, chosenLinks, asked, tool };
  }
  const SELECTED: LinkSelection = { page: 3, version: LINKS_AT, index: 1, link: LINK };

  it('a click on a link where no mark is SELECTS the link, by its place at the version its page was read at', async () => {
    const { drag, chosen, chosenLinks, asked } = linking([UNDER_A, LINK]);
    expect(await drag([250, 40])).toBeUndefined();
    expect(chosenLinks).toStrictEqual([{ page: 3, version: LINKS_AT, index: 1, link: LINK }]);
    expect(chosen).toStrictEqual([undefined]);
    expect(asked).toStrictEqual([3]);
  });

  it('CONTROL: a click on a mark drawn over a link picks the MARK, and no link', async () => {
    const { drag, chosen, chosenLinks } = linking([UNDER_A, LINK]);
    await drag([40, 40]);
    expect(chosen[0]?.items.map((item) => item.index)).toStrictEqual([1]);
    expect(chosenLinks).toStrictEqual([undefined]);
  });

  it('a marquee picks marks only, and a click on nothing clears the link', async () => {
    const swept = linking([LINK]);
    await swept.drag([10, 10], [400, 600]);
    expect(swept.chosenLinks).toStrictEqual([undefined]);
    const missed = linking([LINK], SELECTED);
    await missed.drag([400, 300]);
    expect(missed.chosenLinks).toStrictEqual([undefined]);
  });

  it('a DRAG inside the selected link MOVES it: one editLink, its place, its version, the rectangle moved in PDF space', async () => {
    const { drag } = linking([LINK], SELECTED);
    // +20,+20 screen pixels at zoom 2 is +10 across and 10 DOWN the page, which is −10 in PDF y.
    expect(await drag([250, 40], [270, 60])).toStrictEqual({
      kind: 'editLink',
      page: 3,
      index: 1,
      rect: { x0: 160, y0: 360, x1: 210, y1: 380 },
      version: LINKS_AT,
    });
  });

  it('a CORNER resizes it from the opposite corner, and a SIDE pulls that edge alone', async () => {
    expect(await linking([LINK], SELECTED).drag([300, 60], [320, 80])).toMatchObject({
      kind: 'editLink',
      rect: { x0: 150, y0: 360, x1: 210, y1: 390 },
    });
    expect(await linking([LINK], SELECTED).drag([300, 40], [340, 40])).toMatchObject({
      kind: 'editLink',
      rect: { x0: 150, y0: 370, x1: 220, y1: 390 },
    });
  });

  it('CONTROL: a press on the selected link that does not travel, or a drag of it on another page, sends nothing', async () => {
    expect(await linking([LINK], SELECTED).drag([250, 40])).toBeUndefined();
    expect(await linking([LINK], SELECTED).drag([250, 40], [270, 60], 2)).toBeUndefined();
  });

  it('the pointer says what a press on the selected link would do', () => {
    const { tool } = linking([LINK], SELECTED);
    const at = (x: number, y: number) => tool.controller.pointer(viewportPoint(x, y), 3, overlayTransform(PAGE));
    expect(at(250, 40)).toBe('move');
    expect(at(300, 60)).toBe('resize-nwse');
    expect(at(300, 40)).toBe('resize-ew');
    expect(at(400, 300)).toBeUndefined();
  });
});
