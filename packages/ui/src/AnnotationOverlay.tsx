import type { DispatchableCommand } from '@monstera/contract';
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
   *
   * Resolves whether the document's version moved, which is what decides how long the drawn shape
   * stays on this overlay ({@link drawnWith}).
   */
  readonly onCommand: (command: DispatchableCommand) => Promise<boolean>;
  /**
   * The view the page underneath was last drawn from: an identity, compared and never read.
   *
   * ## Why the overlay is told this
   *
   * A committed shape becomes part of the page only when the page redraws from the version the
   * command produced, which is a reparse and a raster after the release. The overlay used to clear
   * its preview at the release, so the shape vanished for that whole interval and then reappeared
   * drawn by the page. It now keeps the shape until the page has been drawn from a NEWER view than
   * the one under it at the release, and drops it at once when the command did not move the version.
   */
  readonly drawnWith: unknown;
  /** The accessible name for the drawing surface, resolved by the caller. */
  readonly label: string;
}

export function AnnotationOverlay({
  tool,
  page,
  geometry,
  onCommand,
  drawnWith,
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
   * A released shape whose command is in flight or landed, and the view the page was drawn from at
   * the release. Shown while the page is still that drawing ({@link AnnotationOverlayProps.drawnWith}).
   */
  const [committed, setCommitted] = useState<{ readonly preview: ToolPreview; readonly since: unknown } | undefined>(
    undefined,
  );

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
      // A PRESS WHILE A GESTURE IS LIVE EXTENDS IT, rather than starting a new
      // one. This line used to be `begin` unconditionally, which is the first of
      // the three reasons a polygon could not be expressed: the second vertex
      // discarded the first (ADR-0042).
      //
      // A gesture is live only when a tool said it was not complete at the last
      // release, so for the eight tools that end at a release this branch is
      // never taken — `up` has always cleared the state before the next press.
      setGesture((current) =>
        current === undefined
          ? tool.controller.begin(at)
          : {
              ...tool.controller.update(current, at),
              presses: [...current.presses, at],
            },
      );
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

  /**
   * A gesture at a release, or at a double-click: kept while the tool says it is not complete, committed once it is.
   * One path for both, so a double-click finishes a shape exactly as the release that completes it would.
   */
  const release = useCallback(
    (finished: Gesture): void => {
      if (!tool.controller.complete(finished)) {
        // THE GESTURE SURVIVES THE RELEASE. Kept rather than cleared, and
        // `commit` is not called — so the next press extends this one
        // (ADR-0042 Decision 2). The state is still a value this component
        // holds, so Escape and `pointercancel` still abandon it. A double-click
        // the tool did not take as a finish is not carried forward: kept, it
        // would end the gesture at the next release, however many presses on.
        setGesture(finished.done ? { ...finished, done: false } : finished);
        return;
      }
      // THE GESTURE IS CLEARED, whatever the commit decides. A commit that
      // produced nothing and a commit that produced a command both end the
      // drag, and leaving the state behind on one path is how the next click
      // continues the last rectangle.
      setGesture(undefined);
      // EVERYTHING THE COMMAND IS BUILT FROM IS READ NOW, before any await.
      // `page` and the geometry are this render's, and a tool that opens a
      // dialog resolves after the person has answered — by which time the
      // reader may have scrolled, zoomed or switched tools. Reading them here
      // means the command describes the gesture that was actually drawn.
      //
      // The transform in particular: `overlayTransform(geometry)` is derived
      // from the zoom on screen, and resolving it after an await would place
      // the annotation using a scale the drag never happened at.
      const transform = overlayTransform(geometry);
      // THE SHAPE AS RELEASED, and the drawing under it now: held only once there is a command, and
      // only for a tool that previews at all.
      const shape = tool.controller.preview(finished);
      const released = shape === undefined ? undefined : { preview: shape, since: drawnWith };
      // `Promise.resolve` OVER THE UNION. `commit` may answer now or later, and
      // this is the one line that does not care which — a synchronous answer
      // still lands a microtask later, which is why the overlay's own cases
      // settle before asserting rather than reading the DOM straight after the
      // pointer-up.
      void Promise.resolve(tool.controller.commit(finished, page, transform)).then(async (command) => {
        // `undefined` IS AN OUTCOME, and now it is two of them: a click that
        // did not drag produces no annotation from a tool that draws a shape
        // (the typewriter's click asks for words instead), and so does a
        // dismissed dialog.
        // Both mean *there is nothing to send*, which is why the gate is the
        // absence of a value rather than a flag somebody checks.
        if (command === undefined) return;
        if (released !== undefined) setCommitted(released);
        const moved = await onCommand(command);
        // A REFUSED COMMAND MADE NOTHING, so nothing may stay drawn as if it had. Only this shape is
        // dropped: a later release may already hold the slot.
        if (!moved) setCommitted((current) => (current === released ? undefined : current));
      });
    },
    [drawnWith, geometry, onCommand, page, tool],
  );

  const up = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (gesture === undefined) return;
      const at = pointAt(event);
      if (at === undefined) {
        // NO POINT MEANS NO SURFACE TO MEASURE AGAINST, and the gesture is
        // dropped rather than kept: there is nothing to extend it with and
        // nothing to commit. Cleared here rather than before the check, so the
        // multi-press path below is the only other place that decides.
        setGesture(undefined);
        return;
      }
      release(tool.controller.update(gesture, at));
    },
    [gesture, pointAt, release, tool],
  );

  /**
   * A double-click finishes a live gesture (F-C5).
   *
   * **The click count is read where the platform puts it.** A pointer event carries none: measured on Chromium
   * 151.0.7922.34, 2026-10-03, a double-click's two `pointerdown`s both carry `detail` 0, while `mousedown`, `click`
   * and `dblclick` carry 1 and then 2. This read `detail` on the press until then, so no polygon, cloud, connected
   * lines, area or perimeter could be finished by a double-click. `dblclick` arrives after the second release, which
   * has already added that press to the gesture and kept it; it is then released as finished, the tool deciding what
   * a finish with too few vertices makes.
   */
  const doubled = useCallback((): void => {
    if (gesture === undefined) return;
    release({ ...gesture, done: true });
  }, [gesture, release]);

  const cancel = useCallback((): void => {
    setGesture(undefined);
  }, []);

  /**
   * Enter and Escape on a gesture that outlives its releases — a polygon, a cloud, connected lines, an area or a
   * perimeter, between presses (the owner's item 14b).
   *
   * **Enter finishes**, by the same path as a double-click: the tool decides, so a shape with too few corners is kept
   * drawing rather than thrown away. **Escape finishes and keeps** a shape there is enough of, which is what the owner
   * asked for; with too few corners to be the shape, there is nothing to keep, and it abandons. **During a drag** —
   * the pointer still down, the rectangle or the line half drawn — Escape abandons as it always did, and Enter is
   * nothing: those gestures end at their release.
   */
  const pressed = useRef(false);
  const keyed = useCallback(
    (key: string): boolean => {
      if (gesture === undefined) return false;
      if (pressed.current) {
        if (key !== 'Escape') return false;
        cancel();
        return true;
      }
      const finished = { ...gesture, done: true };
      if (key === 'Enter') {
        release(finished);
        return true;
      }
      if (key !== 'Escape') return false;
      if (tool.controller.complete(finished)) release(finished);
      else cancel();
      return true;
    },
    [cancel, gesture, release, tool],
  );

  const preview = gesture === undefined ? undefined : tool.controller.preview(gesture);
  // DERIVED, not cleared by an effect: once the page has been drawn from a newer view, the shape is
  // in its pixels and this stops rendering it in the same render that carries the new drawing.
  const held = committed !== undefined && committed.since === drawnWith ? committed.preview : undefined;

  return (
    <svg
      aria-label={label}
      className="m-annotation-overlay"
      data-annotation-overlay={String(page)}
      data-tool={tool.id}
      // THE TOOL'S OWN POINTER (`UiTool.cursor`); the drawing tools say nothing and draw with the crosshair.
      data-cursor={tool.cursor ?? 'crosshair'}
      onKeyDown={(event): void => {
        // ESCAPE AND ENTER END A GESTURE where the state lives (§6's lifecycle), and are taken from the page's own
        // keys only when they did: a key the drawing did not use still reaches whatever else listens for it.
        if (keyed(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDoubleClick={doubled}
      onPointerCancel={(): void => {
        pressed.current = false;
        cancel();
      }}
      onPointerDown={(event): void => {
        if (event.button === 0) pressed.current = true;
        down(event);
      }}
      onPointerMove={move}
      onPointerUp={(event): void => {
        pressed.current = false;
        up(event);
      }}
      ref={surface}
      // A DRAWING SURFACE, and it is focusable so Escape reaches it and so a
      // keyboard user is told the page has become one. What it is NOT is a
      // control that can be operated from the keyboard — drawing a rectangle by
      // arrow keys is the select tool's arrow-nudge, which is its own row — so
      // this claims no role it cannot honour.
      role="application"
      tabIndex={0}
    >
      {held === undefined ? null : (
        <g data-annotation-held="true">
          <Preview preview={held} />
        </g>
      )}
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
