import { useLingui } from '@lingui/react';
import type { AnnotationRect } from '@monstera/contract';
import type React from 'react';
import { type ReactElement, useRef, useState } from 'react';

import type { OverlayPage } from '../annotations/annotationSpace.js';
import { overlayTransform } from '../annotations/annotationSpace.js';
import { CORNER_REACH } from '../annotations/selectTool.js';
import { FIELD_DESIGN_BOX, FIELD_DESIGN_LAYER_LABEL } from '../messages/en.js';
import {
  HANDLES,
  type Handle,
  type Pixels,
  handleAt,
  marqueeOf,
  marqueeTakes,
  moved,
  movedRect,
  pixelsOf,
  rectOfPixels,
  resized,
} from './fieldDesign.js';
import type { ListedField } from './fieldFill.js';
import { type SelectMode, modeOf } from './fieldSelection.js';

/** How far the pointer must travel before a press becomes a drag: `selectTool`'s threshold, for its reason. */
const MINIMUM_DRAG = 4;

/** The smallest a resize leaves a field, in CSS pixels: a box a pointer can still find. */
const LEAST = 8;

/**
 * *Edit fields* as the page list carries it: the third value of the one slot Edit text and Edit object share, so the
 * three never hold together. The selection is the application's one field selection (`fieldSelection.ts`), which the
 * page reads as its own indices.
 */
export interface FieldEditing {
  readonly mode: 'fields';
  readonly onSelect: (page: number, index: number, mode: SelectMode) => void;
  readonly onMarquee: (page: number, indices: readonly number[], adding: boolean) => void;
  readonly onClear: () => void;
  readonly onPlace: (page: number, placements: readonly FieldPlacement[]) => void;
}

/** One field's new place, by its position in this page's widget walk. */
export interface FieldPlacement {
  readonly index: number;
  readonly rect: AnnotationRect;
}

export interface FieldDesignLayerProps {
  /** Zero-based, as a command names it. */
  readonly page: number;
  readonly geometry: OverlayPage;
  /** This page's fields, from the one list the Fields panel reads too. */
  readonly fields: readonly ListedField[];
  /** The places in this page's walk that are selected. */
  readonly selected: ReadonlySet<number>;
  /** A press on a field's box: a plain press selects it alone, Ctrl toggles it, Shift takes a run. */
  readonly onSelect: (index: number, mode: SelectMode) => void;
  /** A marquee on empty paper: the fields it overlaps, added to the selection when a modifier was held. */
  readonly onMarquee: (indices: readonly number[], adding: boolean) => void;
  /** A press on empty paper that swept nothing. */
  readonly onClear: () => void;
  /** A move or a resize: every field that changed place, as one command. */
  readonly onPlace: (placements: readonly FieldPlacement[]) => void;
}

/** A gesture in flight, in the layer's own pixels. */
type Drag =
  | {
      readonly kind: 'move';
      readonly pointer: number;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      /** The fields the move carries, decided at the press. */
      readonly carried: readonly number[];
    }
  | {
      readonly kind: 'resize';
      readonly pointer: number;
      readonly index: number;
      readonly handle: Handle;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
    }
  | {
      readonly kind: 'marquee';
      readonly pointer: number;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly adding: boolean;
    };

/**
 * *Edit fields* on one page (ADR-0226 Decision 7): every field a box with its name, a press selects, a drag moves the
 * selection, eight handles resize the one selected field, and a drag on empty paper selects what it sweeps.
 *
 * ## Every gesture is an existing command
 *
 * A move and a resize are `editFormFields` with a `rect` (the caller sends {@link FieldDesignLayerProps.onPlace}); the
 * keys (arrows, Delete, copy, paste, duplicate) are registered commands that read the same selection, so this layer
 * holds no key handling of its own and the shortcut map knows every one of them.
 *
 * ## The fill layer is not under this
 *
 * While the mode is on the page mounts this and not the form layer (`PageList`'s `editing`), so a press here never
 * fills, and a press in filling never selects.
 */
export function FieldDesignLayer({
  page,
  geometry,
  fields,
  selected,
  onSelect,
  onMarquee,
  onClear,
  onPlace,
}: FieldDesignLayerProps): ReactElement {
  const { _ } = useLingui();
  const transform = overlayTransform(geometry);
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();

  const placed = fields.flatMap((field) => (field.rect === null ? [] : [{ field, box: pixelsOf(field.rect, transform) }]));
  const onlySelected = selected.size === 1 ? placed.find(({ field }) => selected.has(field.index)) : undefined;

  const pointOf = (event: React.PointerEvent): readonly [number, number] => {
    const corner = layer.current?.getBoundingClientRect();
    return corner === undefined ? [0, 0] : [event.clientX - corner.left, event.clientY - corner.top];
  };

  /** Where a box is drawn while a gesture is in flight. */
  const drawnAt = (index: number, box: Pixels): Pixels => {
    if (drag?.kind === 'move' && drag.carried.includes(index)) {
      return moved(box, drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]);
    }
    if (drag?.kind === 'resize' && drag.index === index) {
      // THE HANDLE FOLLOWS THE POINTER BY ITS TRAVEL, so a press a few pixels off the handle's centre does not jump.
      const at = handleAt(box, drag.handle);
      return resized(box, drag.handle, [at[0] + drag.to[0] - drag.from[0], at[1] + drag.to[1] - drag.from[1]], LEAST);
    }
    return box;
  };

  const finish = (event: React.PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    const to = pointOf(event);
    setDrag(undefined);
    const travelled = Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) >= MINIMUM_DRAG;
    if (drag.kind === 'marquee') {
      // A PRESS ON EMPTY PAPER THAT SWEPT NOTHING clears the selection; a sweep takes what it overlaps.
      if (!travelled) {
        onClear();
        return;
      }
      onMarquee(
        marqueeTakes(
          marqueeOf(drag.from, to),
          placed.map(({ field, box }) => ({ index: field.index, box })),
        ),
        drag.adding,
      );
      return;
    }
    // A PRESS THAT DID NOT TRAVEL IS NOT A DRAG: clicking the selection must not send a zero-length placement.
    if (!travelled) return;
    if (drag.kind === 'move') {
      onPlace(
        placed
          .filter(({ field }) => drag.carried.includes(field.index))
          .flatMap(({ field }) => (field.rect === null ? [] : [{ index: field.index, rect: movedRect(field.rect, drag.from, to, transform) }])),
      );
      return;
    }
    const target = placed.find(({ field }) => field.index === drag.index);
    if (target === undefined) return;
    const at = handleAt(target.box, drag.handle);
    const box = resized(target.box, drag.handle, [at[0] + to[0] - drag.from[0], at[1] + to[1] - drag.from[1]], LEAST);
    onPlace([{ index: drag.index, rect: rectOfPixels(box, transform) }]);
  };

  return (
    <div
      aria-label={_(FIELD_DESIGN_LAYER_LABEL, { page: page + 1 })}
      className="m-field-design-layer"
      data-field-design-layer={String(page)}
      onPointerDown={(event) => {
        // EMPTY PAPER: a press that reached the layer itself and not a box starts a marquee.
        if (event.target !== event.currentTarget || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = pointOf(event);
        setDrag({ kind: 'marquee', pointer: event.pointerId, from: at, to: at, adding: event.shiftKey || event.ctrlKey || event.metaKey });
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
      {placed.map(({ field, box }) => {
        const chosen = selected.has(field.index);
        const at = drawnAt(field.index, box);
        return (
          <button
            aria-label={_(FIELD_DESIGN_BOX, { name: field.name })}
            aria-pressed={chosen}
            className={chosen ? 'm-field-box m-field-box--selected' : 'm-field-box'}
            data-field-box={String(field.index)}
            key={field.index}
            onClick={(event) => {
              // THE KEYBOARD'S PRESS: Enter or Space on a focused box (`detail` 0). A pointer press already selected it.
              if (event.detail === 0) onSelect(field.index, modeOf(event));
            }}
            onPointerDown={(event) => {
              const mode = modeOf(event);
              // A SECONDARY PRESS SELECTS TOO, before the menu opens, so the menu is this field's; one on a field
              // already selected keeps the selection, so the menu acts on all of it.
              if (!chosen || mode !== 'replace') onSelect(field.index, mode);
              if (event.button !== 0 || mode !== 'replace') return;
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
              const from = pointOf(event);
              // WHAT THE MOVE CARRIES is decided now: the selection on this page when this box is in it, else this box.
              const carried = chosen ? placed.filter((each) => selected.has(each.field.index)).map((each) => each.field.index) : [field.index];
              setDrag({ kind: 'move', pointer: event.pointerId, from, to: from, carried });
            }}
            style={{ left: at.x0, top: at.y0, width: at.x1 - at.x0, height: at.y1 - at.y0 }}
            type="button"
          >
            <span className="m-field-box__name">{field.name}</span>
          </button>
        );
      })}
      {onlySelected === undefined
        ? null
        : HANDLES.map((handle) => {
            const [x, y] = handleAt(drawnAt(onlySelected.field.index, onlySelected.box), handle);
            return (
              <span
                aria-hidden="true"
                className={`m-field-handle m-field-handle--${handle}`}
                data-field-handle={handle}
                key={handle}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  layer.current?.setPointerCapture(event.pointerId);
                  const from = pointOf(event);
                  setDrag({ kind: 'resize', pointer: event.pointerId, index: onlySelected.field.index, handle, from, to: from });
                }}
                style={{ left: x - CORNER_REACH / 2, top: y - CORNER_REACH / 2, width: CORNER_REACH, height: CORNER_REACH }}
              />
            );
          })}
      {drag?.kind === 'marquee' ? (
        <div
          aria-hidden="true"
          className="m-field-marquee"
          style={(() => {
            const box = marqueeOf(drag.from, drag.to);
            return { left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
          })()}
        />
      ) : null}
    </div>
  );
}
