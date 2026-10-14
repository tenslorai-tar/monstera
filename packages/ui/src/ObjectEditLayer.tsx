import { useLingui } from '@lingui/react';
import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import { type DocVersion, type MessageKey, toPdf, viewportPoint } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { CORNER_REACH } from './annotations/selectTool.js';
import { HANDLES, type Handle, type Pixels, handleAt, pixelsOf, rectOfPixels, resized } from './forms/fieldDesign.js';
import {
  OBJECT_EDIT_LAYER_LABEL,
  OBJECT_EDIT_NONE_ALL,
  OBJECT_EDIT_NONE_IMAGES,
  OBJECT_EDIT_NONE_SHAPES,
  OBJECT_EDIT_NONE_TEXT,
  OBJECT_EDIT_OUTLINE,
  OBJECT_EDIT_TRUNCATED,
  OBJECT_KIND_FORM,
  OBJECT_KIND_IMAGE,
  OBJECT_KIND_PATH,
  OBJECT_KIND_PICTURE,
  OBJECT_KIND_SHADING,
  OBJECT_KIND_TEXT,
  OBJECT_KIND_UNKNOWN,
} from './messages/en.js';
import {
  type EditableObject,
  type ObjectFilter,
  type ObjectKind,
  type ObjectPick,
  type PageObjects,
  placeCommand,
  shownBy,
} from './objectEditing.js';

/**
 * Edit object's mode, drawn over one page
 * ([ADR-0153](../../../docs/DECISIONS/0153-edit-object-is-a-mode-on-the-page-and-a-placed-picture-is-one-of-its-objects.md)).
 *
 * ## What it draws
 *
 * Every object of the chosen kind, OUTLINED in place, as Edit text outlines its blocks (ADR-0096). A press on an outline
 * selects it; a drag that starts on it moves it; a corner handle of the selected one resizes it, the opposite corner
 * held. A press on blank paper, or Escape, clears the selection, and Escape with nothing selected leaves the mode.
 *
 * ## The layer TAKES the pointer, where Edit text's does not
 *
 * Edit text's layer lets presses through so the text below still selects. Here a press on blank paper means *select
 * nothing*, which is a real outcome rather than a pass-through, so the layer is the mode's whole surface.
 *
 * ## What it knows, which is deliberately little
 *
 * Nothing here reads a client. The objects arrive from the application's read, and a move or a resize leaves as the
 * command `placeCommand` builds. The deltas are taken in PDF space through the page's one transform, so a turned page
 * moves an object the way the pointer went, and no screen arithmetic restates the transform.
 *
 * ## The outline moves; the drawing follows the redraw
 *
 * While a drag is in flight the outline follows the pointer. The object itself is drawn into the page's bitmap and
 * moves when the page redraws with the command applied — the select tool's behaviour for an annotation, and the reason
 * the outline is the thing that says where it will land.
 */

/** What the mode hands each page (the second value of the page list's one `editing` slot). */
export interface ObjectEditing {
  readonly mode: 'objects';
  /** The document version on screen; a new one is a new read. */
  readonly version: DocVersion;
  /** Which kinds are outlined. */
  readonly filter: ObjectFilter;
  /** Reads one page's objects, or `undefined` where the read was refused. */
  readonly read: (page: number) => Promise<PageObjects | undefined>;
  /** The selected object, wherever it is; each page draws it only when it is that page's, at that page's version. */
  readonly pick: ObjectPick | undefined;
  readonly onPick: (pick: ObjectPick | undefined) => void;
  /** Sends a move or a resize. */
  readonly onCommand: (command: DispatchableCommand) => void;
  /** Leaves the mode: Escape with nothing selected. */
  readonly onLeave: () => void;
}

/** How far the pointer must travel before a press becomes a drag: `selectTool`'s threshold, for its reason. */
const MINIMUM_DRAG = 4;

/** The smallest an outline is drawn, so a rule one point thin still has something to press. */
const MINIMUM_TARGET = 8;

const KIND_WORDS: Readonly<Record<ObjectKind, MessageKey>> = {
  unknown: OBJECT_KIND_UNKNOWN,
  text: OBJECT_KIND_TEXT,
  path: OBJECT_KIND_PATH,
  image: OBJECT_KIND_IMAGE,
  shading: OBJECT_KIND_SHADING,
  form: OBJECT_KIND_FORM,
  picture: OBJECT_KIND_PICTURE,
};

/** The word for each kind, for the outline's name and the Properties tab. */
export function kindWord(kind: ObjectKind): MessageKey {
  return KIND_WORDS[kind];
}

const NONE: Readonly<Record<ObjectFilter, MessageKey>> = {
  all: OBJECT_EDIT_NONE_ALL,
  text: OBJECT_EDIT_NONE_TEXT,
  images: OBJECT_EDIT_NONE_IMAGES,
  shapes: OBJECT_EDIT_NONE_SHAPES,
};

/** The least a resize leaves of a side, in pixels: `fieldDesign.ts`' rule, so a box is never turned inside out. */
const LEAST_SIDE = 2;

/**
 * A drag in flight: a move from where it was pressed, or a resize by one of the EIGHT handles (the owner's E6), each
 * moving the edges it names. The box at the press and the handle are held, and `fieldDesign.ts`' `resized` makes the
 * box — the rule Edit fields' handles take, so the two modes resize alike.
 */
type Drag =
  | { readonly kind: 'move'; readonly pointer: number; readonly from: readonly [number, number]; readonly to: readonly [number, number] }
  | {
      readonly kind: 'resize';
      readonly pointer: number;
      readonly handle: Handle;
      readonly start: Pixels;
      /** Where the handle was pressed, so a press that did not travel resizes nothing. */
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
    };

export interface ObjectEditLayerProps {
  /** Zero-based, as a command names it. */
  readonly page: number;
  readonly geometry: OverlayPage;
  /** The page's objects, or `undefined` while they are being read. */
  readonly objects: PageObjects | undefined;
  readonly filter: ObjectFilter;
  /** The selected object when it is on this page at the objects' version, otherwise `undefined`. */
  readonly pick: ObjectPick | undefined;
  readonly onPick: (pick: ObjectPick | undefined) => void;
  readonly onCommand: (command: DispatchableCommand) => void;
  readonly onLeave: () => void;
  /**
   * The drawn page's pixels in a box of the WINDOW's CSS pixels, or `undefined` where none are drawn (the owner's E5):
   * what a drag shows moving, taken once at the press. Absent, a drag moves the outline alone.
   */
  readonly pictureOf?: ((box: Pixels) => HTMLCanvasElement | undefined) | undefined;
}

export function ObjectEditLayer({
  page,
  geometry,
  objects,
  filter,
  pick,
  onPick,
  onCommand,
  onLeave,
  pictureOf,
}: ObjectEditLayerProps): ReactElement {
  const { _ } = useLingui();
  const transform = overlayTransform(geometry);
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();
  // WHAT A DRAG SHOWS MOVING (E5): the object's own pixels, copied once when the press begins, drawn at the box the
  // drag would put it in and stretched with it, and dropped with the drag. A press that does not travel never draws it.
  const [picture, setPicture] = useState<HTMLCanvasElement | undefined>();
  const begin = (next: Drag, object: EditableObject): void => {
    setDrag(next);
    const corner = layer.current?.getBoundingClientRect();
    const box = pixelsOf(object.box, transform);
    // DRAWN ONLY WHILE A DRAG IS IN FLIGHT, below, so the picture a finished drag left here is never shown again.
    setPicture(
      pictureOf === undefined || corner === undefined
        ? undefined
        : pictureOf({ x0: box.x0 + corner.left, y0: box.y0 + corner.top, x1: box.x1 + corner.left, y1: box.y1 + corner.top }),
    );
  };

  // WHAT SHOWS ON THIS PAGE (E3): the page's crop is the last window anything is drawn through, so an object placed past
  // the edge is outlined, picked and resized by the part inside it. One view of the objects, taken by every use below,
  // so an outline and the command its handles build cannot disagree about the box.
  const [cropLeft, cropBottom, cropRight, cropTop] = geometry.crop;
  const onPage = (object: EditableObject): EditableObject => {
    const box = {
      x0: Math.max(object.box.x0, Math.min(cropLeft, cropRight)),
      y0: Math.max(object.box.y0, Math.min(cropBottom, cropTop)),
      x1: Math.min(object.box.x1, Math.max(cropLeft, cropRight)),
      y1: Math.min(object.box.y1, Math.max(cropBottom, cropTop)),
    };
    // NOTHING INSIDE, or nothing cut: the object as read, so one wholly off the page keeps a box a person can find.
    if (box.x0 > box.x1 || box.y0 > box.y1) return object;
    const same = box.x0 === object.box.x0 && box.y0 === object.box.y0 && box.x1 === object.box.x1 && box.y1 === object.box.y1;
    return same ? object : { ...object, box };
  };
  const pageObjects = objects?.objects.map(onPage) ?? [];
  const shown = pageObjects.filter((object) => shownBy(filter, object));
  // THE PICK AS THIS PAGE'S READ HAS IT: the box comes from the read, so a moved object is outlined where it now is.
  const picked =
    pick === undefined || objects === undefined
      ? undefined
      : pageObjects.find((object) => object.source === pick.object.source && object.index === pick.object.index);

  /** The point an event names, in the layer's own pixels. */
  const pointOf = (event: React.PointerEvent): readonly [number, number] => {
    const corner = layer.current?.getBoundingClientRect();
    return corner === undefined ? [0, 0] : [event.clientX - corner.left, event.clientY - corner.top];
  };

  const select = (object: EditableObject | undefined): void => {
    onPick(object === undefined || objects === undefined ? undefined : { page, version: objects.version, object });
  };

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (pick === undefined) onLeave();
      else onPick(undefined);
    },
    [onLeave, onPick, pick],
  );

  const finish = (event: React.PointerEvent): void => {
    if (drag?.pointer !== event.pointerId || picked === undefined || objects === undefined) {
      setDrag(undefined);
      return;
    }
    const to = pointOf(event);
    setDrag(undefined);
    // A PRESS THAT DID NOT TRAVEL IS NOT A DRAG: clicking the selection must not send a zero-length placement.
    if (Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) < MINIMUM_DRAG) return;
    let target: AnnotationRect;
    if (drag.kind === 'move') {
      // THE DELTA IN PDF SPACE, from two points through the one converter (`selectTool`'s reason).
      const origin = toPdf(viewportPoint(drag.from[0], drag.from[1]), transform);
      const moved = toPdf(viewportPoint(to[0], to[1]), transform);
      const dx = moved.x - origin.x;
      const dy = moved.y - origin.y;
      target = { x0: picked.box.x0 + dx, y0: picked.box.y0 + dy, x1: picked.box.x1 + dx, y1: picked.box.y1 + dy };
    } else {
      target = rectOfPixels(resized(drag.start, drag.handle, to, LEAST_SIDE), transform);
    }
    const command = placeCommand({ page, version: objects.version, object: picked }, target);
    if (command !== undefined) onCommand(command);
  };

  /** The box an outline is drawn at: its own, or where the drag in flight would put it. */
  const drawnAt = (object: EditableObject): Pixels => {
    const box = pixelsOf(object.box, transform);
    if (drag === undefined || object !== picked) return box;
    if (drag.kind === 'move') {
      const dx = drag.to[0] - drag.from[0];
      const dy = drag.to[1] - drag.from[1];
      return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
    }
    return resized(drag.start, drag.handle, drag.to, LEAST_SIDE);
  };

  /** The CSS an outline is drawn with, grown about its centre to the smallest target a press can find. */
  const outlineStyle = (box: Pixels): React.CSSProperties => {
    const width = Math.max(box.x1 - box.x0, MINIMUM_TARGET);
    const height = Math.max(box.y1 - box.y0, MINIMUM_TARGET);
    return {
      left: (box.x0 + box.x1) / 2 - width / 2,
      top: (box.y0 + box.y1) / 2 - height / 2,
      width,
      height,
    };
  };

  return (
    <div
      aria-label={_(OBJECT_EDIT_LAYER_LABEL, { page: page + 1 })}
      className="m-object-edit-layer"
      data-object-edit-layer={String(page)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        // BLANK PAPER: a press that reached the layer itself and not an outline selects nothing.
        if (event.target === event.currentTarget && event.button === 0) select(undefined);
      }}
      onPointerMove={(event) => {
        if (drag?.pointer !== event.pointerId) return;
        setDrag({ ...drag, to: pointOf(event) });
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        setDrag(undefined);
      }}
      ref={layer}
      role="group"
    >
      {/* THE OBJECT ITSELF, MOVING (E5): under the outlines, so its handles stay on top, and out of reach of a press. */}
      {drag === undefined || picture === undefined || picked === undefined ? null : (
        <PicturePreview box={drawnAt(picked)} picture={picture} />
      )}
      {shown.map((object, position) => {
        const selected = object === picked;
        const box = drawnAt(object);
        return (
          <button
            aria-label={_(OBJECT_EDIT_OUTLINE, { kind: _(kindWord(object.kind)), position: position + 1, count: shown.length })}
            aria-pressed={selected}
            className={selected ? 'm-object m-object--selected' : 'm-object'}
            data-object={`${object.source}:${String(object.index)}`}
            data-object-kind={object.kind}
            key={`${object.source}:${String(object.index)}`}
            onClick={() => {
              // THE KEYBOARD'S PRESS: Enter or Space on a focused outline. A pointer press already selected it.
              if (!selected) select(object);
            }}
            onPointerDown={(event) => {
              // A SECONDARY PRESS SELECTS TOO, before the browser's context menu opens, so the menu it opens is the
              // object's — the page's menu reads the selection at the right-click.
              select(object);
              if (event.button !== 0) return;
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
              const at = pointOf(event);
              begin({ kind: 'move', pointer: event.pointerId, from: at, to: at }, object);
            }}
            style={outlineStyle(box)}
            type="button"
          />
        );
      })}
      {picked === undefined || !shownBy(filter, picked)
        ? null
        : HANDLES.map((handle) => {
            const at = handleAt(drawnAt(picked), handle);
            return (
              <span
                aria-hidden="true"
                className={`m-object-handle m-object-handle--${handle}`}
                data-object-handle={handle}
                key={handle}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  layer.current?.setPointerCapture(event.pointerId);
                  begin({ kind: 'resize', pointer: event.pointerId, handle, start: pixelsOf(picked.box, transform), from: at, to: at }, picked);
                }}
                style={{ left: at[0] - CORNER_REACH / 2, top: at[1] - CORNER_REACH / 2, width: CORNER_REACH, height: CORNER_REACH }}
              />
            );
          })}
      {objects === undefined ? null : shown.length === 0 || objects.truncated ? (
        <div className="m-page-mode__notes">
          {shown.length === 0 ? <p>{_(NONE[filter])}</p> : null}
          {objects.truncated ? <p>{_(OBJECT_EDIT_TRUNCATED)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A copy of the object's pixels at the box a drag would put it in. The copy is drawn into this canvas at its own size
 * and the canvas is stretched by its box, so a resize shows the object growing as the result will.
 */
function PicturePreview({ box, picture }: { readonly box: Pixels; readonly picture: HTMLCanvasElement }): ReactElement {
  return (
    <canvas
      aria-hidden="true"
      className="m-object-preview"
      data-object-preview=""
      height={picture.height}
      ref={(element) => {
        element?.getContext('2d')?.drawImage(picture, 0, 0);
      }}
      style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}
      width={picture.width}
    />
  );
}

/**
 * One page's object surface: reads the page's objects at the version on screen and draws {@link ObjectEditLayer}.
 *
 * `TextEditPage`'s rule: a read resolving after the version moved is discarded, because objects read at version 4
 * outlined over the page at version 5 would offer to move things that are not there.
 */
export function ObjectEditPage({
  page,
  geometry,
  editing,
  pictureOf,
}: {
  readonly page: number;
  readonly geometry: OverlayPage;
  readonly editing: ObjectEditing;
  /** The drawn page's pixels in a box of the window's pixels: what a drag shows moving (E5). */
  readonly pictureOf: (box: Pixels) => HTMLCanvasElement | undefined;
}): ReactElement {
  const [answer, setAnswer] = useState<{ readonly version: DocVersion; readonly objects: PageObjects | undefined }>();
  const { read, version } = editing;
  useEffect(() => {
    let current = true;
    void read(page).then((objects) => {
      if (current) setAnswer({ version, objects });
    });
    return () => {
      current = false;
    };
  }, [page, read, version]);

  const objects = answer?.version === version ? answer.objects : undefined;
  const { pick } = editing;
  return (
    <ObjectEditLayer
      filter={editing.filter}
      geometry={geometry}
      objects={objects}
      onCommand={editing.onCommand}
      onLeave={editing.onLeave}
      onPick={editing.onPick}
      page={page}
      pick={pick?.page === page && pick.version === objects?.version ? pick : undefined}
      pictureOf={pictureOf}
    />
  );
}
