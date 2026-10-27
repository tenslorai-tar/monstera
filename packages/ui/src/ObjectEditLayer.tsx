import { useLingui } from '@lingui/react';
import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import { type DocVersion, type MessageKey, toPdf, viewportPoint } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { CORNER_REACH } from './annotations/selectTool.js';
import { type Handle, type Pixels, handleAt, pixelsOf, rectOfPixels } from './forms/fieldDesign.js';
import type { LookAt } from './markLook.js';
import {
  OBJECT_EDIT_FINDING,
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
} from './messages/en.js';
import {
  type EditableObject,
  type ObjectFilter,
  type ObjectKind,
  type ObjectPick,
  type PageObjects,
  handlesOf,
  isBackdrop,
  liftedLook,
  objectAt,
  pickingOrder,
  placeCommand,
  resizedBy,
  shownBy,
} from './objectEditing.js';
import { type PaperPaint, paperAround } from './paperAround.js';
import { useSettledRead } from './useSettledPages.js';

/**
 * Edit object's mode, drawn over one page
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)).
 *
 * ## What it draws
 *
 * Every object of the chosen kind, OUTLINED in place. A press on an outline selects it, answered here from the outlines
 * already read, with no trip to the helper; a drag that starts on it moves it; a handle of the selected one resizes it,
 * the opposite side held — a text block by its corners alone, since its words keep their proportions. A press on blank
 * paper, or Escape, clears the selection, and Escape with nothing selected leaves the mode.
 *
 * ## The layer TAKES the pointer, where Edit text's does not
 *
 * Here a press on blank paper means *select nothing*, which is a real outcome rather than a pass-through, so the layer
 * is the mode's whole surface.
 *
 * ## A drag moves the object's own pixels (Decision 9)
 *
 * At the press the object is LIFTED: its pixels copied off the drawn page, and the paper round it read. While the drag
 * is in flight the paper covers the place it left and the copy follows the pointer, stretched with a resize. At the
 * release the same two are held as the edit's final look (`liftedLook`, ADR-0257) until the page draws the result, so
 * nothing on screen jumps back to where the object was while the edit is written.
 *
 * ## What it knows, which is deliberately little
 *
 * Nothing here reads a client. The objects arrive from the application's read, and a move or a resize leaves as the
 * command `placeCommand` builds. The deltas are taken in PDF space through the page's one transform, so a turned page
 * moves an object the way the pointer went.
 */

/** A command sent with the final look it holds until the page draws it, and what to let go when the look leaves. */
export interface HeldEdit {
  readonly look: LookAt;
  readonly dropped: () => void;
}

/** What the mode hands each page (a value of the page list's one `editing` slot). */
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
  /** Sends a move or a resize, with the look it holds meanwhile where the object could be lifted. */
  readonly onCommand: (command: DispatchableCommand, held: HeldEdit | undefined) => void;
  /** Leaves the mode: Escape with nothing selected. */
  readonly onLeave: () => void;
}

/** How far the pointer must travel before a press becomes a drag: `selectTool`'s threshold, for its reason. */
const MINIMUM_DRAG = 4;

/** The smallest an outline is drawn, so a rule one point thin still has something to press. */
const MINIMUM_TARGET = 8;

/** The least a resize leaves of a side, in pixels: `fieldDesign.ts`' rule, so a box is never turned inside out. */
const LEAST_SIDE = 2;

const KIND_WORDS: Readonly<Record<ObjectKind, MessageKey>> = {
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

/** A drag in flight: a move from where it was pressed, or a resize by one of the handles. */
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

/** The object as it was lifted at the press: its pixels, and the paper round the place it leaves. */
interface Lift {
  readonly picture: HTMLCanvasElement | undefined;
  /** The same pixels as an address a held look can draw, made off the press while the pointer travels. */
  readonly address: Promise<string | undefined>;
  readonly paper: PaperPaint | undefined;
}

/** The canvas's pixels as a `blob:` address, or `undefined` where it could not be encoded. */
function addressOf(canvas: HTMLCanvasElement | undefined): Promise<string | undefined> {
  if (canvas === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    // AN ENCODER THAT FAILS answers `null`, and the edit is sent with no look rather than waiting on one.
    canvas.toBlob((blob) => {
      resolve(blob === null ? undefined : URL.createObjectURL(blob));
    });
  });
}

/** Lets go of a lift no look will hold: its address, once made, is no longer drawn by anything. */
function letGo(lift: Lift | undefined): void {
  void lift?.address.then((address) => {
    if (address !== undefined) URL.revokeObjectURL(address);
  });
}

export interface ObjectEditLayerProps {
  /** Zero-based, as a command names it. */
  readonly page: number;
  readonly geometry: OverlayPage;
  /** The page's objects, or `undefined` while they are being read or where the read was refused. */
  readonly objects: PageObjects | undefined;
  /** Whether the page's objects are being read, which the page says (Decision 9): a read can take a moment. */
  readonly finding: boolean;
  readonly filter: ObjectFilter;
  /** The selected object when it is on this page at the objects' version, otherwise `undefined`. */
  readonly pick: ObjectPick | undefined;
  readonly onPick: (pick: ObjectPick | undefined) => void;
  readonly onCommand: ObjectEditing['onCommand'];
  readonly onLeave: () => void;
  /** The drawn page's pixels in a box of the WINDOW's CSS pixels, or `undefined` where none are drawn: what is lifted. */
  readonly pictureOf?: ((box: Pixels) => HTMLCanvasElement | undefined) | undefined;
  /** The drawn page's colour at a point in this layer's pixels: the paper laid over the place a lifted object left. */
  readonly paperAt?: ((x: number, y: number) => string | undefined) | undefined;
}

export function ObjectEditLayer({
  page,
  geometry,
  objects,
  finding,
  filter,
  pick,
  onPick,
  onCommand,
  onLeave,
  pictureOf,
  paperAt,
}: ObjectEditLayerProps): ReactElement {
  const { _ } = useLingui();
  const transform = overlayTransform(geometry);
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();
  const [lift, setLift] = useState<Lift | undefined>();

  /** Lifts the object at the press: its pixels copied and the paper round it read, once, whether or not it travels. */
  const begin = (next: Drag, object: EditableObject): void => {
    setDrag(next);
    const corner = layer.current?.getBoundingClientRect();
    const box = pixelsOf(object.box, transform);
    const picture =
      pictureOf === undefined || corner === undefined
        ? undefined
        : pictureOf({ x0: box.x0 + corner.left, y0: box.y0 + corner.top, x1: box.x1 + corner.left, y1: box.y1 + corner.top });
    const paper = paperAt === undefined ? undefined : paperAround({ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }, paperAt);
    setLift({ picture, paper, address: addressOf(picture) });
  };

  // WHAT SHOWS ON THIS PAGE: the page's crop is the last window anything is drawn through, so an object placed past the
  // edge is outlined, picked and resized by the part inside it. One view of the objects, taken by every use below, so an
  // outline and the command its handles build cannot disagree about the box.
  const [cropLeft, cropBottom, cropRight, cropTop] = geometry.crop;
  const sheet = { x0: Math.min(cropLeft, cropRight), y0: Math.min(cropBottom, cropTop), x1: Math.max(cropLeft, cropRight), y1: Math.max(cropBottom, cropTop) };
  const onPage = (object: EditableObject): EditableObject => {
    const box = {
      x0: Math.max(object.box.x0, sheet.x0),
      y0: Math.max(object.box.y0, sheet.y0),
      x1: Math.min(object.box.x1, sheet.x1),
      y1: Math.min(object.box.y1, sheet.y1),
    };
    // NOTHING INSIDE, or nothing cut: the object as read, so one wholly off the page keeps a box a person can find.
    if (box.x0 > box.x1 || box.y0 > box.y1) return object;
    const same = box.x0 === object.box.x0 && box.y0 === object.box.y0 && box.x1 === object.box.x1 && box.y1 === object.box.y1;
    return same ? object : { ...object, box };
  };
  const pageObjects = objects?.objects.map(onPage) ?? [];
  // IN PICKING ORDER, bottom first: the outlines stack as they are drawn, so a page-sized backdrop drawn last in the walk
  // would lie over every small object and take its press.
  const shown = pickingOrder(pageObjects, sheet).filter((object) => shownBy(filter, object));
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

  /** The topmost backdrop the filter outlines under a point in the layer's pixels, for an Alt-press. */
  const backdropAt = (at: readonly [number, number]): EditableObject | undefined =>
    objectAt(
      shown.filter((object) => isBackdrop(object, sheet)),
      filter,
      toPdf(viewportPoint(at[0], at[1]), transform),
      sheet,
    );

  const pickOf = (object: EditableObject): ObjectPick | undefined =>
    objects === undefined ? undefined : { page, version: objects.version, object, listed: objects.listed };

  const select = (object: EditableObject | undefined): void => {
    onPick(object === undefined ? undefined : pickOf(object));
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (pick === undefined) onLeave();
    else onPick(undefined);
  };

  const finish = (event: React.PointerEvent): void => {
    const lifted = lift;
    setLift(undefined);
    setDrag(undefined);
    if (drag?.pointer !== event.pointerId || picked === undefined) {
      letGo(lifted);
      return;
    }
    const to = pointOf(event);
    const travelled = Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) >= MINIMUM_DRAG;
    // A PRESS THAT DID NOT TRAVEL IS NOT A DRAG: clicking the selection must not send a zero-length placement.
    const target = travelled ? targetOf(drag, to, picked) : undefined;
    const sent = pickOf(picked);
    const command = sent === undefined || target === undefined ? undefined : placeCommand(sent, target);
    // NOTHING LIFTED, nothing held: paper over the old place with nothing at the new one would show the object gone.
    if (command === undefined || lifted?.picture === undefined) {
      letGo(lifted);
      if (command !== undefined) onCommand(command, undefined);
      return;
    }
    // THE LOOK NEEDS THE ADDRESS, encoded while the pointer travelled: by the release it has nearly always resolved.
    void lifted.address.then((address) => {
      if (address === undefined) {
        onCommand(command, undefined);
        return;
      }
      onCommand(command, {
        look: liftedLook(picked, target, address, lifted.paper),
        dropped: () => {
          URL.revokeObjectURL(address);
        },
      });
    });
  };

  /** The box a drag puts the picked object at, in PDF space. */
  const targetOf = (current: Drag, to: readonly [number, number], object: EditableObject): AnnotationRect => {
    if (current.kind === 'resize') return rectOfPixels(resizedBy(object, current.start, current.handle, to, LEAST_SIDE), transform);
    // THE DELTA IN PDF SPACE, from two points through the one converter (`selectTool`'s reason).
    const origin = toPdf(viewportPoint(current.from[0], current.from[1]), transform);
    const moved = toPdf(viewportPoint(to[0], to[1]), transform);
    const dx = moved.x - origin.x;
    const dy = moved.y - origin.y;
    return { x0: object.box.x0 + dx, y0: object.box.y0 + dy, x1: object.box.x1 + dx, y1: object.box.y1 + dy };
  };

  /** The box an outline is drawn at: its own, or where the drag in flight would put it. */
  const drawnAt = (object: EditableObject): Pixels => {
    const box = pixelsOf(object.box, transform);
    if (drag === undefined || object !== picked) return box;
    if (drag.kind === 'resize') return resizedBy(object, drag.start, drag.handle, drag.to, LEAST_SIDE);
    const dx = drag.to[0] - drag.from[0];
    const dy = drag.to[1] - drag.from[1];
    return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
  };

  /** The CSS an outline is drawn with, grown about its centre to the smallest target a press can find. */
  const outlineStyle = (box: Pixels): React.CSSProperties => {
    const width = Math.max(box.x1 - box.x0, MINIMUM_TARGET);
    const height = Math.max(box.y1 - box.y0, MINIMUM_TARGET);
    return { left: (box.x0 + box.x1) / 2 - width / 2, top: (box.y0 + box.y1) / 2 - height / 2, width, height };
  };

  // THE LIFT SHOWS ONLY ONCE THE POINTER HAS TRAVELLED, so a press that only selects never covers anything.
  const lifting =
    drag !== undefined && lift !== undefined && picked !== undefined && Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) >= MINIMUM_DRAG
      ? { lift, from: pixelsOf(picked.box, transform), to: drawnAt(picked) }
      : undefined;

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
        letGo(lift);
        setLift(undefined);
        setDrag(undefined);
      }}
      ref={layer}
      role="group"
    >
      {/* THE OBJECT LIFTED: under the outlines, so its handles stay on top, and out of reach of a press. A placed
          picture is an annotation and keeps its place in the page's drawing until the page draws it moved. */}
      {lifting?.lift.paper === undefined || picked?.source === 'stamp' ? null : (
        <div aria-hidden="true" className="m-object-lift" data-object-left="" style={{ ...boxStyle(lifting.from), ...lifting.lift.paper }} />
      )}
      {lifting?.lift.picture === undefined ? null : <LiftedPicture box={lifting.to} picture={lifting.lift.picture} />}
      {shown.map((object, position) => {
        const selected = object === picked;
        const box = drawnAt(object);
        return (
          <button
            aria-label={_(OBJECT_EDIT_OUTLINE, { kind: _(kindWord(object.kind)), position: position + 1, count: shown.length })}
            aria-pressed={selected}
            className={['m-object', selected ? 'm-object--selected' : '', isBackdrop(object, sheet) ? 'm-object--backdrop' : '']
              .filter((name) => name !== '')
              .join(' ')}
            data-object={`${object.source}:${String(object.index)}`}
            data-object-kind={object.kind}
            key={`${object.source}:${String(object.index)}`}
            onClick={() => {
              // THE KEYBOARD'S PRESS: Enter or Space on a focused outline. A pointer press already selected it.
              if (!selected) select(object);
            }}
            onPointerDown={(event) => {
              // ALT REACHES THE BACKDROP under the pointer, which no plain press over a smaller object can.
              const at = pointOf(event);
              const chosen = event.altKey ? (backdropAt(at) ?? object) : object;
              // A SECONDARY PRESS SELECTS TOO, before the browser's context menu opens, so the menu it opens is the
              // object's — the page's menu reads the selection at the right-click.
              select(chosen);
              if (event.button !== 0) return;
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
              begin({ kind: 'move', pointer: event.pointerId, from: at, to: at }, chosen);
            }}
            style={outlineStyle(box)}
            type="button"
          />
        );
      })}
      {picked === undefined || !shownBy(filter, picked)
        ? null
        : handlesOf(picked).map((handle) => {
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
      {objects === undefined ? (
        finding ? (
          <div className="m-page-mode__notes">
            <p data-object-finding="">{_(OBJECT_EDIT_FINDING)}</p>
          </div>
        ) : null
      ) : shown.length === 0 || objects.truncated ? (
        <div className="m-page-mode__notes">
          {shown.length === 0 ? <p>{_(NONE[filter])}</p> : null}
          {objects.truncated ? <p>{_(OBJECT_EDIT_TRUNCATED)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function boxStyle(box: Pixels): { left: number; top: number; width: number; height: number } {
  return { left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/**
 * The lifted pixels at the box a drag would put the object in. The copy is drawn into this canvas at its own size and
 * the canvas is stretched by its box, so a resize shows the object growing as the result will.
 */
function LiftedPicture({ box, picture }: { readonly box: Pixels; readonly picture: HTMLCanvasElement }): ReactElement {
  return (
    <canvas
      aria-hidden="true"
      className="m-object-lift"
      data-object-lifted=""
      height={picture.height}
      ref={(element) => {
        element?.getContext('2d')?.drawImage(picture, 0, 0);
      }}
      style={boxStyle(box)}
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
  paperAt,
  paused,
}: {
  readonly page: number;
  readonly geometry: OverlayPage;
  readonly editing: ObjectEditing;
  readonly pictureOf: (box: Pixels) => HTMLCanvasElement | undefined;
  readonly paperAt: (x: number, y: number) => string | undefined;
  /** Whether no scroll is moving, before which the page's objects are not read (`useSettledRead`). */
  readonly paused: boolean;
}): ReactElement {
  const [answer, setAnswer] = useState<{ readonly version: DocVersion; readonly objects: PageObjects | undefined }>();
  const { read, version } = editing;
  const reads = useSettledRead(paused, version);
  useEffect(() => {
    if (!reads) return;
    let current = true;
    void read(page).then((objects) => {
      if (current) setAnswer({ version, objects });
    });
    return () => {
      current = false;
    };
  }, [page, read, reads, version]);

  const objects = answer?.version === version ? answer.objects : undefined;
  const { pick } = editing;
  return (
    <ObjectEditLayer
      filter={editing.filter}
      finding={answer?.version !== version}
      geometry={geometry}
      objects={objects}
      onCommand={editing.onCommand}
      onLeave={editing.onLeave}
      onPick={editing.onPick}
      page={page}
      paperAt={paperAt}
      pick={pick?.page === page && pick.version === objects?.version ? pick : undefined}
      pictureOf={pictureOf}
    />
  );
}
