// @vitest-environment happy-dom
import type { DispatchableCommand } from '@monstera/contract';
import { asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnnotationOverlay } from './AnnotationOverlay.js';
import type { OverlayPage } from './annotations/annotationSpace.js';
import { PLAIN_STYLE } from './annotations/annotationStyle.js';
import { selectTool } from './annotations/selectTool.js';
import { rectangleTool as buildRectangle } from './annotations/shapeTools.js';

/** The two tools these cases drive, built with the style that chooses nothing. */
const rectangleTool = buildRectangle(PLAIN_STYLE);
const polygonTool = buildPolygon(PLAIN_STYLE);
const polylineTool = buildPolyline(PLAIN_STYLE);
import { polygonTool as buildPolygon, polylineTool as buildPolyline } from './annotations/vertexTools.js';
import type { LookContext, MarkLook } from './markLook.js';
import type { LiveReading, UiTool } from './registries/tools.js';
import { pointerPath, readingAfter } from './registries/tools.js';

/**
 * The overlay, driven by pointer events — the wired-tools pair's **UI half**.
 *
 * A kernel proof that the command produces the document effect proves nothing
 * about whether any control sends it, and this is the other side: a drag on the
 * page dispatches exactly one `addAnnotation`, naming the page it was drawn on,
 * with the rectangle the drag described.
 *
 * ## The numbers are the pair's blind spot, so they are asserted here in full
 *
 * The rule's own warning is that each half can be correct in its own frame for
 * ever, because neither holds the other's number. So this case does not assert
 * *a command was sent*: it asserts the rectangle, in PDF user space, computed
 * from a drag in CSS pixels over a page with a crop origin and a zoom — which
 * is the same arithmetic `pageAnnotations.test.ts` reads back out of a real
 * document at the other end.
 *
 * ## happy-dom reports a zero-sized box, and the fixture says so out loud
 *
 * Nothing is laid out here, so `getBoundingClientRect` answers zeroes and a
 * client coordinate IS an overlay coordinate. That is convenient and it is also
 * the one thing these cases cannot check — whether the overlay is positioned
 * over the canvas is CSS, and `.m-page-slot`'s `position: relative` is what
 * makes it true.
 */

const PAGE: OverlayPage = { crop: [50, 100, 250, 400], rotation: 0, zoom: 2 };

/**
 * Renders an overlay and returns the surface, every command it sent, and every look it handed the holder and dropped.
 *
 * `moves` is what each command's dispatch answers: whether the version moved. The holder here records rather than
 * draws: what a held look looks like and when the page drops it are the page's (`heldOnPage`, `MarkLookLayer`).
 */
function mounted(
  tool: UiTool = rectangleTool,
  moves = true,
  onReading?: (page: number, reading: LiveReading | undefined) => void,
  lookContext?: LookContext,
  afterPaint: () => Promise<void> = () => Promise.resolve(),
): {
  readonly surface: Element;
  readonly sent: DispatchableCommand[];
  readonly holds: MarkLook[];
  readonly drops: MarkLook[];
} {
  const sent: DispatchableCommand[] = [];
  const holds: MarkLook[] = [];
  const drops: MarkLook[] = [];
  const { container } = render(
    <AnnotationOverlay
      afterPaint={afterPaint}
      geometry={PAGE}
      label="Draw on page 4"
      lookContext={lookContext}
      onCommand={(command): Promise<boolean> => {
        sent.push(command);
        return Promise.resolve(moves);
      }}
      onHold={(look) => {
        holds.push(look);
        return () => {
          drops.push(look);
        };
      }}
      onReading={onReading}
      page={3}
      tool={tool}
    />,
  );
  const surface = container.querySelector('[data-annotation-overlay]');
  if (surface === null) throw new Error('the overlay did not render a surface');
  return { surface, sent, holds, drops };
}

/** A held look's one outline as `[shape, x, y, width, height, colour]`, its numbers rounded to the pixel. */
function outlineOf(look: MarkLook): unknown {
  const [only, ...more] = look.parts;
  if (only?.part !== 'outline' || more.length > 0) return look.parts;
  return [only.shape, ...[only.box.x, only.box.y, only.box.width, only.box.height].map(Math.round), only.stroke.colour];
}

/** The preview of a gesture still being drawn: the overlay draws nothing else. */
function inFlightPreview(surface: Element): Element | null {
  return surface.querySelector('[data-annotation-preview]');
}

/**
 * One pointer event of the given type at a client position.
 *
 * Through `fireEvent` rather than `dispatchEvent`, because the two are not the
 * same thing here: `fireEvent` wraps the dispatch in `act`, so React's state
 * update and the re-render it causes have happened by the time the case looks.
 * A raw dispatch leaves the assertion reading the DOM as it was before the
 * event — which shows up as *nothing was dispatched* and is really *nothing has
 * rendered yet*.
 */
function pointer(surface: Element, type: string, x: number, y: number, button = 0): void {
  fireEvent(
    surface,
    // NO CLICK COUNT, as the platform sends none: measured on Chromium 151.0.7922.34, 2026-10-03, a double-click's
    // `pointerdown`s both carry `detail` 0. This helper used to write 2 there, which proved the overlay read a number
    // no real press carries, while the tools it was finishing could not be finished (F-C5).
    new window.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button, pointerId: 1 }),
  );
}

/**
 * One press: down then up at the same point, settled. A DOUBLE is what the platform sends for one: two presses, then
 * `dblclick` carrying the count.
 */
async function click(
  surface: Element,
  at: readonly [number, number],
  { double = false }: { double?: boolean } = {},
): Promise<void> {
  for (let press = 0; press < (double ? 2 : 1); press += 1) {
    pointer(surface, 'pointerdown', at[0], at[1]);
    pointer(surface, 'pointerup', at[0], at[1]);
  }
  if (double) fireEvent.dblClick(surface, { clientX: at[0], clientY: at[1], detail: 2 });
  await act(async () => {
    await Promise.resolve();
  });
}

/** A whole drag: down, move, up. */
/**
 * A whole drag, settled.
 *
 * **The await is not politeness.** `commit` may answer now or later, and the
 * overlay resolves it either way — so even a tool that answers from the gesture
 * alone dispatches a microtask after the pointer-up. A case that asserted
 * straight after would read `sent` before anything was in it, which is what
 * these three did the moment the platform gained a tool that has to ask.
 */
async function drag(
  surface: Element,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  pointer(surface, 'pointerdown', from[0], from[1]);
  pointer(surface, 'pointermove', to[0], to[1]);
  pointer(surface, 'pointerup', to[0], to[1]);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AnnotationOverlay', () => {
  it('dispatches exactly one addAnnotation, with the rectangle the drag described', async () => {
    const { surface, sent } = mounted();

    await drag(surface, [20, 20], [120, 80]);

    expect(sent).toStrictEqual([
      {
        kind: 'addAnnotation',
        page: 3,
        annotation: {
          type: 'square',
          rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
          colour: [0.85, 0.15, 0.15],
          opacity: 1,
          borderWidth: 2,
        },
      },
    ]);
  });

  it('sends nothing for a click that did not drag', () => {
    const { surface, sent } = mounted();
    pointer(surface, 'pointerdown', 40, 40);
    pointer(surface, 'pointerup', 40, 40);
    expect(sent).toStrictEqual([]);
  });

  it('ignores a non-primary button, so a right-click is still a context menu', () => {
    const { surface, sent } = mounted();
    pointer(surface, 'pointerdown', 20, 20, 2);
    pointer(surface, 'pointermove', 120, 80);
    pointer(surface, 'pointerup', 120, 80);
    expect(sent).toStrictEqual([]);
  });

  it('does not continue the last drag on the next click', async () => {
    // ASSERT THE CALL THAT WAS NOT MADE. If the gesture survived the pointer-up,
    // a later stray click would commit a second rectangle spanning from the
    // first drag's origin — and the state a correct implementation leaves is
    // the state a broken one leaves until something clicks again.
    const { surface, sent } = mounted();
    await drag(surface, [20, 20], [120, 80]);
    pointer(surface, 'pointerup', 200, 200);
    expect(sent).toHaveLength(1);
  });

  it('abandons the drag on Escape, which is the lifecycle\'s fourth phase', () => {
    const { surface, sent } = mounted();
    pointer(surface, 'pointerdown', 20, 20);
    pointer(surface, 'pointermove', 120, 80);
    fireEvent.keyDown(surface, { key: 'Escape' });
    pointer(surface, 'pointerup', 120, 80);
    expect(sent).toStrictEqual([]);
  });

  it('the Escape that abandons a drag is SPENT there, so the document’s listener does not also leave Focus (CR-COR-11)', () => {
    // THE APPLICATION'S SHORTCUTS LISTEN ON THE DOCUMENT, and in Focus mode Escape is `view.leave-focus`: one press would
    // drop the shape and bring the ribbon back.
    const heard: string[] = [];
    const listen = (event: KeyboardEvent): void => {
      heard.push(event.key);
    };
    document.addEventListener('keydown', listen);
    try {
      const { surface } = mounted();
      pointer(surface, 'pointerdown', 20, 20);
      pointer(surface, 'pointermove', 120, 80);
      fireEvent.keyDown(surface, { key: 'Escape' });
      expect(heard).toStrictEqual([]);
      pointer(surface, 'pointerup', 120, 80);
      // CONTROL: with nothing being drawn the overlay uses no key, and the same Escape reaches the document.
      fireEvent.keyDown(surface, { key: 'Escape' });
      expect(heard).toStrictEqual(['Escape']);
    } finally {
      document.removeEventListener('keydown', listen);
    }
  });

  it('abandons the drag when the pointer is cancelled', () => {
    const { surface, sent } = mounted();
    pointer(surface, 'pointerdown', 20, 20);
    pointer(surface, 'pointermove', 120, 80);
    pointer(surface, 'pointercancel', 120, 80);
    pointer(surface, 'pointerup', 120, 80);
    expect(sent).toStrictEqual([]);
  });

  it('draws a preview while the drag is in flight and nothing before it, and HOLDS the command’s FINAL LOOK at the release, in the same update', () => {
    const { surface, holds } = mounted();
    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();

    pointer(surface, 'pointerdown', 20, 20);
    pointer(surface, 'pointermove', 120, 80);

    const preview = surface.querySelector('[data-annotation-preview]');
    expect(preview?.getAttribute('x')).toBe('20');
    expect(preview?.getAttribute('y')).toBe('20');
    expect(preview?.getAttribute('width')).toBe('100');
    expect(preview?.getAttribute('height')).toBe('60');

    // THE RELEASE ENDS THE DRAG AND HOLDS THE LOOK AT ONCE, read before anything settles (R17, ADR-0257): this tool's
    // command is known at the release, and a render between the two drew nothing for the mark.
    pointer(surface, 'pointerup', 120, 80);
    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();
    // THE MARK'S OWN LOOK, from its command — the box the drag drew, in the rectangle's red, not the accent placeholder.
    expect(holds).toHaveLength(1);
    expect(holds.map(outlineOf)).toStrictEqual([['rect', 20, 20, 100, 60, [0.85, 0.15, 0.15]]]);
  });

  it('HOLDS the look ONCE and draws none of it itself: the page shows a held look until it draws the mark', async () => {
    const { surface, holds, drops } = mounted();
    await drag(surface, [20, 20], [120, 80]);
    await act(async () => {
      await Promise.resolve();
    });
    // ONCE, though the command is known at the release and again when its promise settles.
    expect(holds).toHaveLength(1);
    expect(drops).toStrictEqual([]);
    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();
  });

  it('a MOVE of the selection is drawn where the mark goes, while dragged and once let go (ADR-0166, item 14d)', async () => {
    // A selected mark at screen (20,20)–(100,100), dragged from inside it 20 px right. The in-flight shape and the
    // look held after the release are both at the mark's box moved, (40,20)–(120,100): before ADR-0166 both were the
    // box from the press to the pointer, (40,40)–(60,40), which is the ghost and then the jump the owner saw.
    const rect = { x0: 60, y0: 350, x1: 100, y1: 390 };
    const items = [
      {
        index: 1,
        rect,
        style: { colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
        kind: 'square' as const,
        contents: '',
        author: '',
        created: null,
        blend: 'normal' as const,
      },
    ];
    const select = selectTool({
      write: () => Promise.reject(new Error('this case types nothing')),
      wordsOf: () => Promise.reject(new Error('this case reads no words')),
      ask: () => Promise.reject(new Error('this case opens no dialog')),
      annotations: () => Promise.resolve(undefined),
      links: () => Promise.resolve(undefined),
      onSelectLink: () => undefined,
      selectedLink: () => undefined,
      onSelect: () => undefined,
      selected: () => ({ page: 3, version: asDocVersion(7), items }),
    });
    const { surface, sent, holds } = mounted(select, true, undefined, { selected: items });
    const boxOf = (element: Element | null | undefined): string[] =>
      ['x', 'y', 'width', 'height'].map((name) => element?.querySelector('rect')?.getAttribute(name) ?? '');

    pointer(surface, 'pointerdown', 40, 40);
    pointer(surface, 'pointermove', 60, 40);
    const flying = inFlightPreview(surface);
    expect(flying?.getAttribute('data-annotation-preview')).toBe('boxes');
    expect(boxOf(flying)).toStrictEqual(['40', '20', '80', '80']);

    pointer(surface, 'pointerup', 60, 40);
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toMatchObject([{ kind: 'placeAnnotation', placements: [{ index: 1, rect: { x0: 70, x1: 110 } }] }]);
    // HELD IN THE MARK'S OWN RED AT ITS NEW BOX, and the page told to leave the mark out until it draws the move.
    expect(holds.map(outlineOf)).toStrictEqual([['rect', 40, 20, 80, 80, [1, 0, 0]]]);
    expect(holds.map((look) => look.leaves)).toStrictEqual([1]);
  });

  it('a MEASUREMENT’s end dragged draws its live reading and REPORTS it, held until the page is drawn from the result (B1)', async () => {
    // A distance on screen (20,100) to (200,98), an inch per 72 points; its right end dragged to (240,98).
    const scale = { perPoint: 1 / 72, unit: 'in' } as const;
    const items = [
      {
        index: 1,
        rect: { x0: 55, y0: 340, x1: 155, y1: 360 },
        style: { colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
        kind: 'measure-distance' as const,
        contents: '1.3 in',
        author: '',
        created: null,
        blend: 'normal' as const,
        points: [
          { x: 60, y: 350 },
          { x: 150, y: 351 },
        ],
        measured: { kind: 'measure-distance' as const, scale },
      },
    ];
    const select = selectTool({
      write: () => Promise.reject(new Error('this case types nothing')),
      wordsOf: () => Promise.reject(new Error('this case reads no words')),
      ask: () => Promise.reject(new Error('this case opens no dialog')),
      annotations: () => Promise.resolve(undefined),
      links: () => Promise.resolve(undefined),
      onSelectLink: () => undefined,
      selectedLink: () => undefined,
      onSelect: () => undefined,
      selected: () => ({ page: 3, version: asDocVersion(7), items }),
    });
    const reported: [number, LiveReading | undefined][] = [];
    const { surface, sent, holds } = mounted(
      select,
      true,
      (page, reading) => {
        reported.push([page, reading]);
      },
      { selected: items },
    );
    pointer(surface, 'pointerdown', 200, 98);
    pointer(surface, 'pointermove', 240, 98);
    const caption = surface.querySelector('[data-annotation-caption]');
    // THE END MOVES TO PDF x 170: 110 points long, 1.53 inches, where the stored words say 1.3 (90 points).
    expect(caption?.textContent).toBe('1.5 in');
    expect(reported.at(-1)).toStrictEqual([3, { page: 3, index: 1, text: '1.5 in' }]);

    pointer(surface, 'pointerup', 240, 98);
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toMatchObject([{ kind: 'reshapeAnnotation', index: 1 }]);
    // THE HELD LOOK CARRIES THE READING after the release, so the page goes on reporting it to the Comment until it draws
    // the file's new words; and it leaves the mark out, as the drag did.
    expect(holds).toMatchObject([{ leaves: 1, reading: { index: 1, text: '1.5 in' } }]);
  });

  it('readingAfter: a reading replaces the one held, and NONE clears only a reading of its own page', () => {
    const held = { page: 3, index: 1, text: '2.4 in' };
    expect(readingAfter(undefined, 3, held)).toBe(held);
    expect(readingAfter(held, 3, undefined)).toBeUndefined();
    // CONTROL: another page's overlay reporting none, as one mounting during the drag does, leaves the drag's reading.
    expect(readingAfter(held, 5, undefined)).toBe(held);
  });

  it('SENDS a held look’s command only once the look has been painted, so its answer cannot keep the look off the screen', async () => {
    let painted: () => void = () => undefined;
    const paint = new Promise<void>((resolve) => {
      painted = resolve;
    });
    const { surface, sent, holds } = mounted(rectangleTool, true, undefined, undefined, () => paint);
    await drag(surface, [20, 20], [120, 80]);
    await act(async () => {
      await Promise.resolve();
    });
    // HELD, AND NOT YET SENT: the frame that paints the look has not been.
    expect(holds).toHaveLength(1);
    expect(sent).toStrictEqual([]);
    await act(async () => {
      painted();
      await paint;
      await Promise.resolve();
    });
    expect(sent).toMatchObject([{ kind: 'addAnnotation' }]);
  });

  it('drops the look at once when the command did not move the version, since nothing was made', async () => {
    const { surface, holds, drops } = mounted(rectangleTool, false);
    await drag(surface, [20, 20], [120, 80]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(drops).toStrictEqual(holds);
    // CONTROL: one was held, so the drop is of a look and not of nothing.
    expect(holds).toHaveLength(1);
  });

  it('dispatches whatever the ACTIVE tool commits, knowing nothing about rectangles', async () => {
    // THE DISPATCHER PROPERTY. Adding the nineteenth tool must not change this
    // file, and the case that says so is one whose controller is not the
    // rectangle's: the overlay calls begin, update and commit and sends what
    // comes back.
    const other: UiTool = {
      id: 'annotate.other',
      hint: messageKey('test.hint.other'),
      controller: {
        ...pointerPath,
        commit: (_gesture, page) => Promise.resolve({ kind: 'duplicatePage', pages: [page] }),
        preview: () => undefined,
      },
    };
    const { surface, sent } = mounted(other);

    await drag(surface, [20, 20], [120, 80]);

    expect(sent).toStrictEqual([{ kind: 'duplicatePage', pages: [3] }]);
  });

  it('KEEPS A GESTURE ITS TOOL HAS NOT COMPLETED, across the release', async () => {
    // THE PLATFORM HALF OF ADR-0042, on a real DOM. `vertexTools.test.ts`
    // reproduces this sequence to drive the tools; this is the case that says
    // the reproduction describes what the overlay does, and without it those
    // tools would be proven against a lifecycle nothing implements.
    //
    // Three separate presses, none of them a double: the polygon's `complete`
    // stays false, so the overlay must not clear the gesture and must not
    // commit. An overlay that still ended every gesture at pointer-up sends the
    // first press's command here — a one-vertex polygon, which is nothing —
    // and the preview would be gone.
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    await click(surface, [120, 80]);

    expect(sent).toStrictEqual([]);
    // AND THE STATE IS STILL THERE, which is the half `sent` cannot show: an
    // overlay that dropped the gesture and sent nothing would satisfy the line
    // above perfectly.
    expect(surface.querySelector('[data-annotation-preview="path"]')).not.toBeNull();
  });

  it('and commits it on the press the tool DOES complete', async () => {
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    await click(surface, [120, 80], { double: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polygon' } });
    // CLEARED, so the next press starts a new shape rather than continuing this
    // one. The multi-press path is the only place in this component that keeps
    // a gesture, and a completion that forgot to clear would make every polygon
    // after the first inherit the last one's corners. The IN-FLIGHT preview: the released shape is
    // held separately until the page redraws, and is not a gesture.
    expect(inFlightPreview(surface)).toBeNull();
  });

  it('a double-click on a shape with TOO FEW corners keeps the drawing, and the shape goes on (F-C5)', async () => {
    // A POLYGON NEEDS THREE. Two corners and a double-click used to finish it and commit nothing, which threw away
    // what the person drew.
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20], { double: true });

    expect(sent).toStrictEqual([]);
    expect(surface.querySelector('[data-annotation-preview="path"]')).not.toBeNull();

    // AND THE DOUBLE-CLICK IS NOT CARRIED FORWARD: the next single press adds a corner and finishes nothing.
    await click(surface, [120, 80]);
    expect(sent).toStrictEqual([]);
    await click(surface, [20, 80], { double: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polygon' } });
  });

  it('ESCAPE FINISHES AND KEEPS a shape there is enough of (the owner’s item 14b)', async () => {
    // THREE CORNERS, enough for a polygon: Escape used to drop them all, and the owner asked that it keep the shape.
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    await click(surface, [120, 80]);
    fireEvent.keyDown(surface, { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polygon' } });
    expect(inFlightPreview(surface)).toBeNull();
  });

  it('ENTER FINISHES a shape there is enough of, and keeps drawing one there is not', async () => {
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    // TWO CORNERS: not yet a polygon, so Enter keeps the drawing, as a double-click does.
    fireEvent.keyDown(surface, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toStrictEqual([]);
    expect(surface.querySelector('[data-annotation-preview="path"]')).not.toBeNull();
    await click(surface, [120, 80]);
    fireEvent.keyDown(surface, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polygon' } });
  });

  it('ENTER FINISHES CONNECTED LINES, which drew for ever in the owner’s recording', async () => {
    // AN OPEN SHAPE has no first corner to come back to, so a key and a double-click are the only finishes it has.
    const { surface, sent } = mounted(polylineTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 40]);
    await click(surface, [60, 90]);
    fireEvent.keyDown(surface, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polyline' } });
    expect((sent[0] as { annotation: { points: unknown[] } }).annotation.points).toHaveLength(3);
  });

  it('A DOUBLE-CLICK ON THE FIRST CORNER closes the shape and starts no other (the owner’s item 14b)', async () => {
    // THE OWNER'S RECORDING: the area closed on its first point, and the double-click's second press began a new
    // shape. The first press closes this one; the second press and the `dblclick` after it must leave nothing live.
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    await click(surface, [120, 80]);
    await click(surface, [20, 20], { double: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'polygon' } });
    // NO LIVE SHAPE: the committed one is held until the page redraws, which is not a gesture.
    expect(inFlightPreview(surface)).toBeNull();
    // AND THE NEXT SHAPE is a fresh one: three corners and Escape send a polygon of exactly those three. A corner the
    // double-click left behind would be a fourth, so the count is what only the correct path produces.
    await click(surface, [200, 200]);
    await click(surface, [300, 200]);
    await click(surface, [300, 300]);
    fireEvent.keyDown(surface, { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent).toHaveLength(2);
    const second = sent[1];
    expect(second?.kind === 'addAnnotation' && second.annotation.type === 'polygon' ? second.annotation.points : []).toHaveLength(3);
  });

  it('abandons a half-drawn multi-press gesture on Escape when it is too few corners to keep', async () => {
    // CANCELLING IS STILL THE ABSENCE OF A MEMBER (ADR-0042 Decision 4), and a
    // half-drawn polygon is what makes that worth asserting rather than
    // assuming: it is the first gesture a person can be left holding, and the
    // argument that dropping the value is enough had never been tested against
    // a gesture that survives a release.
    const { surface, sent } = mounted(polygonTool);
    await click(surface, [20, 20]);
    await click(surface, [120, 20]);
    fireEvent.keyDown(surface, { key: 'Escape' });

    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();
    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a drag tool still ends at its release, unchanged by any of this', async () => {
    // The partner every case above needs. `complete` defaults to true in
    // `pointerPath`, and a build whose default flipped would keep every
    // rectangle alive for ever — the three cases above would all still pass,
    // because none of them uses a drag tool.
    const { surface, sent } = mounted();
    await drag(surface, [20, 20], [120, 80]);

    expect(sent).toHaveLength(1);
    expect(inFlightPreview(surface)).toBeNull();
  });

  it('names the surface and the tool on the element, for the projections that look', () => {
    const { surface } = mounted();
    expect(surface.getAttribute('aria-label')).toBe('Draw on page 4');
    expect(surface.getAttribute('data-tool')).toBe(rectangleTool.id);
  });

  it('captures the pointer, so a drag past the page edge keeps its events', () => {
    // Without capture the rectangle freezes at the boundary and the pointer-up
    // lands elsewhere, so the gesture never ends and the next click continues
    // it. Dragging past the edge is ordinary — it is how a rectangle reaches
    // the margin — and the kernel accepts a rectangle that only overlaps.
    const { surface } = mounted();
    const capture = vi.fn();
    Object.defineProperty(surface, 'setPointerCapture', { value: capture, writable: true });
    pointer(surface, 'pointerdown', 20, 20);
    expect(capture).toHaveBeenCalledWith(1);
  });

  describe('the tool’s pointer over the page (ADR-0201)', () => {
    /** A tool that answers a resize arrow only over the left half of the page, as a stand-in for a hit test. */
    const reaching: UiTool = {
      ...rectangleTool,
      id: 'test.reaching',
      controller: { ...rectangleTool.controller, pointer: (at) => (at.x < 100 ? 'resize-ew' : undefined) },
    };

    it('writes what the tool says as data-pointer while no gesture is in flight, and takes it away when it says nothing', () => {
      const { surface } = mounted(reaching);
      pointer(surface, 'pointermove', 40, 40);
      expect(surface.getAttribute('data-pointer')).toBe('resize-ew');
      pointer(surface, 'pointermove', 160, 40);
      expect(surface.hasAttribute('data-pointer')).toBe(false);
    });

    it('HOLDS during a drag: the press chose the arrow, and the pointer moving off the reach does not change it', () => {
      const { surface } = mounted(reaching);
      Object.defineProperty(surface, 'setPointerCapture', { value: vi.fn(), writable: true });
      pointer(surface, 'pointermove', 40, 40);
      pointer(surface, 'pointerdown', 40, 40);
      pointer(surface, 'pointermove', 160, 60);
      expect(surface.getAttribute('data-pointer')).toBe('resize-ew');
    });

    it('is taken away when the pointer leaves the page; CONTROL: a tool that says nothing never sets it', () => {
      const { surface } = mounted(reaching);
      pointer(surface, 'pointermove', 40, 40);
      // React builds `onPointerLeave` from the platform's `pointerout` (a leave to nowhere has no `relatedTarget`).
      pointer(surface, 'pointerout', 40, 40);
      expect(surface.hasAttribute('data-pointer')).toBe(false);
      const plain = mounted(rectangleTool);
      pointer(plain.surface, 'pointermove', 40, 40);
      expect(plain.surface.hasAttribute('data-pointer')).toBe(false);
    });
  });
});
