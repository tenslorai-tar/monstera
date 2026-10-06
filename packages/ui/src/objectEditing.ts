import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import {
  MAX_OBJECT_SCALE,
  MAX_PAGE_COORDINATE,
  MIN_OBJECT_SCALE,
  keepsTheAnnotationWalk,
  keepsTheObjectWalk,
} from '@monstera/contract';
import type { DocVersion } from '@monstera/shared';

/**
 * Edit object's mode, as data and the commands it builds
 * ([ADR-0153](../../../docs/DECISIONS/0153-edit-object-is-a-mode-on-the-page-and-a-placed-picture-is-one-of-its-objects.md)).
 *
 * Nothing here reads a client or draws. The objects arrive from the application's read, a press on the page arrives as
 * two points in PDF space, and what leaves is a command — so every rule about which object a press names, and which
 * writer moves it, is a function a case can call.
 */

/** The ribbon menu's four filters (Decision 2). */
export type ObjectFilter = 'all' | 'text' | 'images' | 'shapes';

/** The filters in the menu's order, the one list the four commands are built from. */
export const OBJECT_FILTERS: readonly ObjectFilter[] = ['all', 'text', 'images', 'shapes'];

/**
 * What an object is, as a person names it. The page's own kinds as `document.pageObjects` answers them, and `picture`
 * for a stamp the annotation walk calls `pictured` — a picture placed with *Comment › Image* (Decision 3).
 */
export type ObjectKind = 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form' | 'picture';

/** A fill, as PDFium answers it, or `null` where it would not say — never an invented black. */
export interface ObjectFill {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * One thing on the page the mode can select, named against the walk that holds it. `content` is PDFium's object walk,
 * `stamp` the annotation walk, and the two are never joined: an index means nothing outside its own walk.
 */
export interface EditableObject {
  readonly source: 'content' | 'stamp';
  readonly index: number;
  readonly kind: ObjectKind;
  /** Its box in PDF space. */
  readonly box: AnnotationRect;
  /** Its fill, for page content; `null` for a picture and where PDFium would not say. */
  readonly fill: ObjectFill | null;
}

/** One page's objects at the version both reads answered at, page content first and stamps after. */
export interface PageObjects {
  readonly version: DocVersion;
  readonly objects: readonly EditableObject[];
  /** Whether the engine's walk stopped at its bound, so the page holds more than is outlined. */
  readonly truncated: boolean;
}

/** The one selected object: on one page, at one version (Decision 4). */
export interface ObjectPick {
  readonly page: number;
  readonly version: DocVersion;
  readonly object: EditableObject;
}

/** Which kinds each filter outlines (Decision 2's table). */
const SHOWN: Readonly<Record<ObjectFilter, ReadonlySet<ObjectKind>>> = {
  all: new Set(['unknown', 'text', 'path', 'image', 'shading', 'form', 'picture']),
  text: new Set(['text']),
  images: new Set(['image', 'picture']),
  shapes: new Set(['path', 'shading']),
};

/** Whether `filter` outlines `object`. */
export function shownBy(filter: ObjectFilter, object: EditableObject): boolean {
  return SHOWN[filter].has(object.kind);
}

/**
 * The object a press at `point` names under `filter`: the TOPMOST one containing it, which is the last in the list —
 * page content in its own drawing order, then stamps, which are drawn over the page. `undefined` on blank paper.
 */
export function objectAt(
  objects: readonly EditableObject[],
  filter: ObjectFilter,
  point: { readonly x: number; readonly y: number },
): EditableObject | undefined {
  return objects.findLast(
    (object) =>
      shownBy(filter, object) &&
      point.x >= object.box.x0 &&
      point.x <= object.box.x1 &&
      point.y >= object.box.y0 &&
      point.y <= object.box.y1,
  );
}

/** A coordinate held inside what a placement may carry. */
function bounded(value: number): number {
  return Math.min(Math.max(value, -MAX_PAGE_COORDINATE), MAX_PAGE_COORDINATE);
}

/** A scale held inside what a placement may carry. */
function scaled(value: number): number {
  return Math.min(Math.max(value, MIN_OBJECT_SCALE), MAX_OBJECT_SCALE);
}

/**
 * The command that puts the picked object at `target`, a box in PDF space — a move when only its corner changed, a
 * resize when its size did. `undefined` when it would change nothing, so a press that did not travel sends no version.
 *
 * **Page content scales about its own lower-left corner and then moves** (`placeObject`), so the scale is the two
 * sizes' ratio and the move is the corners' difference. A side with no extent — a rule one point tall drawn as a
 * line — keeps its scale at one on that axis, since no factor turns zero into a size.
 */
export function placeCommand(pick: ObjectPick, target: AnnotationRect): DispatchableCommand | undefined {
  const { object } = pick;
  const from = object.box;
  if (from.x0 === target.x0 && from.y0 === target.y0 && from.x1 === target.x1 && from.y1 === target.y1) return undefined;
  if (object.source === 'stamp') {
    return {
      kind: 'placeAnnotation',
      page: pick.page,
      placements: [{ index: object.index, rect: target }],
      version: pick.version,
    };
  }
  const width = from.x1 - from.x0;
  const height = from.y1 - from.y0;
  return {
    kind: 'placePageObject',
    page: pick.page,
    index: object.index,
    moveBy: { x: bounded(target.x0 - from.x0), y: bounded(target.y0 - from.y0) },
    scaleBy: {
      x: width > 0 ? scaled((target.x1 - target.x0) / width) : 1,
      y: height > 0 ? scaled((target.y1 - target.y0) / height) : 1,
    },
    version: pick.version,
  };
}

/** The command that removes the picked object, by the writer that holds it. */
export function removeCommand(pick: ObjectPick): DispatchableCommand {
  const { object } = pick;
  return object.source === 'stamp'
    ? { kind: 'removeAnnotation', page: pick.page, indices: [object.index], version: pick.version }
    : { kind: 'deletePageObjects', page: pick.page, indices: [object.index], version: pick.version };
}

/** Whether the picked object has a fill a person may change: page content whose fill PDFium describes. */
export function recolourable(pick: ObjectPick): boolean {
  return pick.object.source === 'content' && pick.object.fill !== null && pick.object.kind !== 'image';
}

/** The command that fills the picked object with `colour`, or `undefined` where it has no fill to change. */
export function recolourCommand(pick: ObjectPick, colour: ObjectFill): DispatchableCommand | undefined {
  if (!recolourable(pick)) return undefined;
  return {
    kind: 'recolorPageObjects',
    page: pick.page,
    indices: [pick.object.index],
    colour,
    version: pick.version,
  };
}

/**
 * The pick after `command` produced `produced`: kept, at the new version, when the command keeps the walk its object
 * is in and was built from this pick; otherwise dropped (Decision 4). The page's next read then draws it where the
 * command put it, so nothing here recomputes a box.
 */
export function carryPick(
  current: ObjectPick | undefined,
  command: DispatchableCommand,
  produced: DocVersion,
): ObjectPick | undefined {
  if (current === undefined) return undefined;
  // THE WALK THE OBJECT IS IN DECIDES: a placement of a stamp keeps the annotation walk and says nothing of PDFium's.
  const kept =
    current.object.source === 'stamp'
      ? keepsTheAnnotationWalk(command)
        ? command
        : undefined
      : keepsTheObjectWalk(command)
        ? command
        : undefined;
  if (kept?.page !== current.page || kept.version !== current.version) return undefined;
  return { ...current, version: produced };
}
