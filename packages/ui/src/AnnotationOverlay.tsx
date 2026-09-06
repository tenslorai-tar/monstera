import type { RenderableCommand } from '@monstera/contract';
import type { ViewportPoint } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform, pointerOn } from './annotations/annotationSpace.js';
import type { Gesture, ToolPreview, UiTool } from './registries/tools.js';

/**
 * The annotation overlay — §6's *dispatcher, never a monolithic switch stack*.
 *
 * ## What it knows, which is deliberately almost nothing
 *
 * It knows how to turn pointer events into points on a page, and it knows the
 * page's transform. It does not know what any tool draws, what any tool
 * commits, or that a rectangle exists: it calls `begin`, `update`, `commit` and
 * `preview` on whichever controller the registry handed it. Adding the
 * nineteenth tool changes this file not at all, which is what makes the tools
 * row a registry rather than a place features are wired.
 *
 * ## One overlay per PAGE, not one per document
 *
 * A gesture belongs to the page it started on, and a scroller shows several
 * pages at once. Mounting one overlay over the whole scroller would mean
 * deciding which page a pointer is over from geometry the slots already know,
 * and a drag that crossed a page boundary would have no answer at all. One per
 * slot makes *which page* structural: the element the pointer went down on is
 * the page, and a drag that leaves it is still that page's.
 *
 * ## Pointer capture, and why the drag survives leaving the page
 *
 * `setPointerCapture` sends every later event for that pointer here whatever it
 * is over. Without it a drag that ran past the page's edge would stop getting
 * moves — the rectangle would freeze at the boundary and the pointer-up would
 * land somewhere else entirely, so the gesture would never end and the next
 * click would continue it. Dragging past the edge is ordinary: it is how a
 * person draws a rectangle that reaches the margin, and the kernel accepts a
 * rectangle that overlaps the page.
 *
 * ## It is present only when a tool is
 *
 * With no tool selected there is no overlay element at all, rather than a
 * transparent one that ignores events. An element over the page that passed
 * everything through is a thing that can go wrong silently — text selection,
 * link clicks and the loupe all live underneath it — and *absent* is
 * checkable in a way *inert* is not.
 */
export interface AnnotationOverlayProps {
  /** The tool driving this overlay. The overlay is not rendered without one. */
  readonly tool: UiTool;
  /** Which page this overlay sits on, zero-based, as a command names it. */
  readonly page: number;
  /** The page as drawn, for the transform. */
  readonly geometry: OverlayPage;
  /**
   * Sends the command a completed gesture produced.
   *
   * The overlay never reaches a client itself: dispatching is
   * `applyDocumentCommand`'s job, which already reports a declined command and
   * raises invariant 18's dialog. A second dispatch path here would be the
   * second opinion B3a spends its time on, on the one question every mutation
   * asks.
   */
  readonly onCommand: (command: RenderableCommand) => void;
  /** The accessible name for the drawing surface, resolved by the caller. */
  readonly label: string;
}

export function AnnotationOverlay({
  tool,
  page,
  geometry,
  onCommand,
  label,
}: AnnotationOverlayProps): ReactElement {
  const surface = useRef<SVGSVGElement>(null);
  /**
   * The gesture in flight, or `undefined` for none.
   *
   * The overlay owns it, which is what makes `cancel` the absence of a
   * controller member: dropping this is cancelling. `registries/tools.ts` has
   * the argument.
   */
  const [gesture, setGesture] = useState<Gesture | undefined>(undefined);

  /**
   * Where the pointer is, in the overlay's own box.
   *
   * `annotationSpace.ts`' `pointerOn` measures from an element's client
   * rectangle, and the element is this surface — which is laid out exactly over
   * the page's canvas, so its box IS the page on screen.
   */
  const pointAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): ViewportPoint | undefined => {
      const element = surface.current;
      if (element === null) return undefined;
      return pointerOn(element, event.clientX, event.clientY);
    },
    [],
  );

  const down = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      // THE PRIMARY BUTTON ONLY. A right-click is a context menu and a middle
      // click is a scroll gesture in every application this one replaces;
      // starting a rectangle on either is a control doing something nobody
      // asked for.
      if (event.button !== 0) return;
      const at = pointAt(event);
      if (at === undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture(tool.controller.begin(at));
    },
    [pointAt, tool],
  );

  const move = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (gesture === undefined) return;
      const at = pointAt(event);
      if (at === undefined) return;
      setGesture(tool.controller.update(gesture, at));
    },
    [gesture, pointAt, tool],
  );

  const up = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (gesture === undefined) return;
      const at = pointAt(event);
      // THE GESTURE IS CLEARED FIRST, whatever the commit decides. A commit
      // that produced nothing and a commit that produced a command both end the
      // drag, and leaving the state behind on one path is how the next click
      // continues the last rectangle.
      setGesture(undefined);
      if (at === undefined) return;
      const finished = tool.controller.update(gesture, at);
      const command = tool.controller.commit(finished, page, overlayTransform(geometry));
      // `undefined` IS AN OUTCOME. A click that did not drag produces no
      // annotation, which is what a person expects from a click.
      if (command !== undefined) onCommand(command);
    },
    [geometry, gesture, onCommand, page, pointAt, tool],
  );

  const cancel = useCallback((): void => {
    setGesture(undefined);
  }, []);

  const preview = gesture === undefined ? undefined : tool.controller.preview(gesture);

  return (
    <svg
      aria-label={label}
      className="m-annotation-overlay"
      data-annotation-overlay={String(page)}
      data-tool={tool.id}
      onKeyDown={(event): void => {
        // ESCAPE ABANDONS THE DRAG, which is the fourth phase of §6's
        // lifecycle arriving where the state lives.
        if (event.key === 'Escape') cancel();
      }}
      onPointerCancel={cancel}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      ref={surface}
      // A DRAWING SURFACE, and it is focusable so Escape reaches it and so a
      // keyboard user is told the page has become one. What it is NOT is a
      // control that can be operated from the keyboard — drawing a rectangle by
      // arrow keys is the select tool's arrow-nudge, which is its own row — so
      // this claims no role it cannot honour.
      role="application"
      tabIndex={0}
    >
      {preview === undefined ? null : <Preview preview={preview} />}
    </svg>
  );
}

/**
 * The one place that knows how a preview shape is drawn.
 *
 * THE OVERLAY'S ONLY SWITCH, and it is the dispatcher's own job rather than the
 * monolithic stack §6 forbids: it maps a shape description to an SVG element
 * and knows nothing about which tool produced one or what it will become. A
 * member added to `ToolPreview` is a branch here and a compile error until it
 * is written, which is what the exhaustiveness check below is for.
 *
 * `data-annotation-preview` carries the shape rather than merely existing, so a
 * case can assert *an ellipse was previewed* without reading the tag name — a
 * tool that drew the right box with the wrong shape would otherwise pass.
 */
function Preview({ preview }: { readonly preview: ToolPreview }): ReactElement {
  switch (preview.shape) {
    case 'rect':
      return (
        <rect
          className="m-annotation-preview"
          data-annotation-preview="rect"
          height={preview.height}
          width={preview.width}
          x={preview.x}
          y={preview.y}
        />
      );
    case 'ellipse':
      // INSCRIBED IN THE SAME BOX the rectangle would occupy, which is what
      // `/Subtype /Circle` means: the annotation's `/Rect` is the bounding box
      // and the ellipse touches its four edges.
      return (
        <ellipse
          className="m-annotation-preview"
          cx={preview.x + preview.width / 2}
          cy={preview.y + preview.height / 2}
          data-annotation-preview="ellipse"
          rx={preview.width / 2}
          ry={preview.height / 2}
        />
      );
    case 'line':
      return (
        <line
          className="m-annotation-preview"
          data-annotation-preview="line"
          x1={preview.x1}
          x2={preview.x2}
          y1={preview.y1}
          y2={preview.y2}
        />
      );
    case 'path':
      // A POLYLINE AND NOT A `<path>`, because the points are already a list
      // and `points` takes one. Building a `d` string would be this component
      // deciding on a path grammar for a shape that has no curves in it.
      return (
        <polyline
          className="m-annotation-preview m-annotation-stroke"
          data-annotation-preview="path"
          points={preview.points.map(([x, y]) => `${String(x)},${String(y)}`).join(' ')}
        />
      );
    default: {
      // A MEMBER ADDED WITHOUT A BRANCH IS A COMPILE ERROR, which is the point
      // of the union: the alternative is a runtime fall-through that renders
      // nothing and looks like a tool that did not fire.
      const unhandled: never = preview;
      return unhandled;
    }
  }
}
