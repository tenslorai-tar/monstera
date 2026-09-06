// @vitest-environment happy-dom
import type { RenderableCommand } from '@monstera/contract';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnnotationOverlay } from './AnnotationOverlay.js';
import type { OverlayPage } from './annotations/annotationSpace.js';
import { rectangleTool } from './annotations/shapeTools.js';
import type { UiTool } from './registries/tools.js';
import { pointerPath } from './registries/tools.js';

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

/** Renders an overlay and returns the surface plus every command it sent. */
function mounted(tool: UiTool = rectangleTool): {
  readonly surface: Element;
  readonly sent: RenderableCommand[];
} {
  const sent: RenderableCommand[] = [];
  const { container } = render(
    <AnnotationOverlay
      geometry={PAGE}
      label="Draw on page 4"
      onCommand={(command): void => {
        sent.push(command);
      }}
      page={3}
      tool={tool}
    />,
  );
  const surface = container.querySelector('[data-annotation-overlay]');
  if (surface === null) throw new Error('the overlay did not render a surface');
  return { surface, sent };
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
    new window.PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button,
      pointerId: 1,
    }),
  );
}

/** A whole drag: down, move, up. */
function drag(surface: Element, from: readonly [number, number], to: readonly [number, number]): void {
  pointer(surface, 'pointerdown', from[0], from[1]);
  pointer(surface, 'pointermove', to[0], to[1]);
  pointer(surface, 'pointerup', to[0], to[1]);
}

describe('AnnotationOverlay', () => {
  it('dispatches exactly one addAnnotation, with the rectangle the drag described', () => {
    const { surface, sent } = mounted();

    drag(surface, [20, 20], [120, 80]);

    expect(sent).toStrictEqual([
      {
        kind: 'addAnnotation',
        page: 3,
        annotation: {
          type: 'square',
          rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
          colour: [0.85, 0.15, 0.15],
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

  it('does not continue the last drag on the next click', () => {
    // ASSERT THE CALL THAT WAS NOT MADE. If the gesture survived the pointer-up,
    // a later stray click would commit a second rectangle spanning from the
    // first drag's origin — and the state a correct implementation leaves is
    // the state a broken one leaves until something clicks again.
    const { surface, sent } = mounted();
    drag(surface, [20, 20], [120, 80]);
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

  it('abandons the drag when the pointer is cancelled', () => {
    const { surface, sent } = mounted();
    pointer(surface, 'pointerdown', 20, 20);
    pointer(surface, 'pointermove', 120, 80);
    pointer(surface, 'pointercancel', 120, 80);
    pointer(surface, 'pointerup', 120, 80);
    expect(sent).toStrictEqual([]);
  });

  it('draws a preview while the drag is in flight and nothing before it', () => {
    const { surface } = mounted();
    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();

    pointer(surface, 'pointerdown', 20, 20);
    pointer(surface, 'pointermove', 120, 80);

    const preview = surface.querySelector('[data-annotation-preview]');
    expect(preview?.getAttribute('x')).toBe('20');
    expect(preview?.getAttribute('y')).toBe('20');
    expect(preview?.getAttribute('width')).toBe('100');
    expect(preview?.getAttribute('height')).toBe('60');

    pointer(surface, 'pointerup', 120, 80);
    expect(surface.querySelector('[data-annotation-preview]')).toBeNull();
  });

  it('dispatches whatever the ACTIVE tool commits, knowing nothing about rectangles', () => {
    // THE DISPATCHER PROPERTY. Adding the nineteenth tool must not change this
    // file, and the case that says so is one whose controller is not the
    // rectangle's: the overlay calls begin, update and commit and sends what
    // comes back.
    const other: UiTool = {
      id: 'annotate.other',
      controller: {
        ...pointerPath,
        commit: (_gesture, page) => ({ kind: 'duplicatePage', page }),
        preview: () => undefined,
      },
    };
    const { surface, sent } = mounted(other);

    drag(surface, [20, 20], [120, 80]);

    expect(sent).toStrictEqual([{ kind: 'duplicatePage', page: 3 }]);
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
});
