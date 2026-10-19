import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import {
  MAX_OBJECT_SCALE,
  MAX_PAGE_COORDINATE,
  MIN_OBJECT_SCALE,
  blockEditOf,
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
  /**
   * Its place among the page's objects of its own kind, in the walk's order: how a picture, a form or a shape is found
   * in the page's content to be moved where it is drawn (ADR-0240). 0 for a stamp, whose walk is the annotations'.
   */
  readonly ordinal: number;
  readonly kind: ObjectKind;
  /**
   * What SHOWS of it, in PDF space: the box its clip lets through (E3). Every outline, handle and hit test takes this, so
   * a picture placed larger than its window is picked where it is seen.
   */
  readonly box: AnnotationRect;
  /**
   * The engine's own box for it, as if unclipped: what a command names the object by and scales it about. Equal to
   * `box` where nothing narrows it. Required, so no reader can take the shown box for the engine's by leaving it out.
   */
  readonly drawn: AnnotationRect;
  /**
   * The walk indices it stands for, ascending (ADR-0242): one for a picture, a shape or a lone text object, and every
   * text object of a block, so a press on one letter picks the block and a command names all of it. `index` is the
   * first. Required, so a command built from it cannot name one letter of a block by forgetting the rest.
   */
  readonly members: readonly number[];
  /** How far its own matrix turns it, degrees counter-clockwise, as PDFium reads it; absent is upright (E6). */
  readonly turn?: number;
  /** How a block's text is set, as the block read Edit text opens answers it (E6, ADR-0242); text in a block only. */
  readonly look?: ObjectTextLook;
  /**
   * The block as Edit text reads it — its lines of runs and its words — so a placement is sent to the operator writer as
   * a block edit that carries the words as they were (ADR-0240's correction of 2026-10-19); text in a block only.
   */
  readonly block?: ObjectTextBlock;
  /** Its fill, for page content; `null` for a picture and where PDFium would not say. */
  readonly fill: ObjectFill | null;
}

/** A text block as its edit names it: each line's run indices, which lines wrap softly, and its words as read. */
export interface ObjectTextBlock {
  readonly lines: readonly (readonly number[])[];
  readonly soft: readonly boolean[];
  readonly text: string;
}

/** A block's text as Properties shows it: its size in points and its style, from the block's own base style. */
export interface ObjectTextLook {
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly family: 'serif' | 'sans' | 'mono';
}

/** One page's objects at the version both reads answered at, page content first and stamps after. */
export interface PageObjects {
  readonly version: DocVersion;
  readonly objects: readonly EditableObject[];
  /** Whether the engine's walk stopped at its bound, so the page holds more than is outlined. */
  readonly truncated: boolean;
  /** How many objects the engine's walk answered: a block is one outline for several of them (ADR-0242). */
  readonly walked: number;
}

/** The one selected object: on one page, at one version (Decision 4). */
export interface ObjectPick {
  readonly page: number;
  readonly version: DocVersion;
  readonly object: EditableObject;
  /** How many objects PDFium's walk holds on that page: where Bring forward has no further place (ADR-0244). */
  readonly walked: number;
  /**
   * A text block placed by the operator writer, whose objects the placement renumbered (ADR-0240's correction of
   * 2026-10-19): the selection is the block with these words in the next read of the page, and is no selection until
   * that read finds it — a command built from it would name the old objects.
   */
  readonly relocate?: { readonly text: string };
}

/**
 * A pick waiting to be found again ({@link ObjectPick.relocate}) resolved against `read`, the page's objects at its
 * version: the one text block with its words, or no selection where none or several are.
 */
export function relocatePick(current: ObjectPick | undefined, read: PageObjects, page: number): ObjectPick | undefined {
  if (current?.relocate === undefined || current.page !== page || current.version !== read.version) return current;
  const { text } = current.relocate;
  const found = read.objects.filter((object) => object.kind === 'text' && object.block?.text === text);
  const [only, ...more] = found;
  return only === undefined || more.length > 0 ? undefined : { page, version: read.version, object: only, walked: read.walked };
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

/** How much of the page an object must cover to be its BACKDROP (E9): nine tenths of the page's area. */
const BACKDROP_SHARE = 0.9;

/**
 * Whether `object` is a backdrop of `page`, its crop box: it covers nine tenths of the page or more. A full-page fill
 * or a form holding the whole page is drawn behind what a person means to pick, whatever its place in the walk.
 */
export function isBackdrop(object: EditableObject, page: AnnotationRect): boolean {
  const width = Math.min(object.box.x1, page.x1) - Math.max(object.box.x0, page.x0);
  const height = Math.min(object.box.y1, page.y1) - Math.max(object.box.y0, page.y0);
  const area = (page.x1 - page.x0) * (page.y1 - page.y0);
  return width > 0 && height > 0 && area > 0 && width * height >= BACKDROP_SHARE * area;
}

/**
 * The order a press finds the page's objects in, BOTTOM FIRST (the owner's E9): its backdrops, then everything else in
 * its drawing order, page content then stamps. A page-sized fill drawn after the small objects on it lay over them and
 * took every press; under this order it is found only where nothing else is. The layer draws its outlines in this
 * order and {@link objectAt} reads it, so the two cannot disagree about what a press names.
 */
export function pickingOrder(objects: readonly EditableObject[], page: AnnotationRect): readonly EditableObject[] {
  return [...objects.filter((object) => isBackdrop(object, page)), ...objects.filter((object) => !isBackdrop(object, page))];
}

/**
 * The object a press at `point` names under `filter`: the TOPMOST one containing it in {@link pickingOrder}, so a
 * backdrop only where nothing else is. `undefined` on blank paper.
 */
export function objectAt(
  objects: readonly EditableObject[],
  filter: ObjectFilter,
  point: { readonly x: number; readonly y: number },
  page: AnnotationRect,
): EditableObject | undefined {
  return pickingOrder(objects, page).findLast(
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
  const scaleBy = {
    x: width > 0 ? scaled((target.x1 - target.x0) / width) : 1,
    y: height > 0 ? scaled((target.y1 - target.y0) / height) : 1,
  };
  // THE TARGET IS FOR WHAT SHOWS, and both engines scale about the corner of the box they hold, the unclipped one. So
  // the move is the shown corner's travel, less what scaling about the engine's corner already carried it:
  // p' = s·p + drawn·(1 − s) + move puts the shown corner at the target's exactly. Nothing narrowed: drawn is the box.
  const drawn = object.drawn;
  return placementOf(pick, {
    moveBy: {
      x: bounded(target.x0 - from.x0 + (from.x0 - drawn.x0) * (1 - scaleBy.x)),
      y: bounded(target.y0 - from.y0 + (from.y0 - drawn.y0) * (1 - scaleBy.y)),
    },
    scaleBy,
  });
}

/** Whether the picked object can be turned: page content, whose commands carry a turn (ADR-0243). A stamp's cannot. */
export function turnable(object: EditableObject): boolean {
  return object.source === 'content';
}

/**
 * The command that turns the picked object by `degrees`, counter-clockwise as PDF measures them, about the centre of
 * what SHOWS of it; `undefined` for no turn, or for an object that cannot be turned.
 *
 * Both engines turn about the centre of the box THEY hold (ADR-0243), which for a clipped picture is not the centre of
 * its window. A turn R about c that should have been about v leaves every point R(c − v) − (c − v) away, so the command
 * moves it back by exactly that: (R − I)(c − v). Nothing clipped: c is v, and there is no move.
 */
export function turnCommand(pick: ObjectPick, degrees: number): DispatchableCommand | undefined {
  if (degrees === 0 || !turnable(pick.object)) return undefined;
  const { box, drawn } = pick.object;
  const dx = (drawn.x0 + drawn.x1) / 2 - (box.x0 + box.x1) / 2;
  const dy = (drawn.y0 + drawn.y1) / 2 - (box.y0 + box.y1) / 2;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return placementOf(pick, {
    moveBy: { x: bounded(dx * cos - dy * sin - dx), y: bounded(dx * sin + dy * cos - dy) },
    scaleBy: { x: 1, y: 1 },
    rotateBy: Math.max(-360, Math.min(360, degrees)),
  });
}

/** A placement of the picked page content, sent as the command of the writer that holds it. */
function placementOf(
  pick: ObjectPick,
  intent: {
    readonly moveBy: { readonly x: number; readonly y: number };
    readonly scaleBy: { readonly x: number; readonly y: number };
    readonly rotateBy?: number;
  },
): DispatchableCommand {
  const { object } = pick;
  const drawn = object.drawn;
  const placement = { page: pick.page, index: object.index, ...intent, version: pick.version };
  // A PICTURE, A FORM OR A SHAPE IS MOVED WHERE IT IS DRAWN (ADR-0240, the owner's E1): PDFium's route writes the page's
  // text again, and a font it cannot write back refused the move. Text, and what PDFium alone names, keep its route.
  if (object.kind === 'image' || object.kind === 'form' || object.kind === 'path') {
    return {
      kind: 'placeDrawnObject',
      ...placement,
      object: object.kind,
      ordinal: object.ordinal,
      // THE ENGINE'S OWN BOX, which is how the kernel knows the object it finds in the content is the one listed.
      box: { left: drawn.x0, bottom: drawn.y0, right: drawn.x1, top: drawn.y1 },
    };
  }
  // A BLOCK OF TEXT IS PLACED BY THE OPERATOR WRITER (ADR-0240's and ADR-0242's corrections of 2026-10-19): its words
  // carried as they were under one `cm`, about the box its objects make together by the one placement matrix, so no font
  // is written again and a font PDFium cannot write back refuses nothing. One undo step, as the group was.
  if (object.kind === 'text' && object.block !== undefined) {
    const { block } = object;
    return {
      kind: 'editTextOperators',
      page: pick.page,
      ...blockEditOf([
        {
          lines: block.lines.map((line) => [...line]),
          soft: [...block.soft],
          text: block.text,
          place: {
            about: {
              box: { left: drawn.x0, bottom: drawn.y0, right: drawn.x1, top: drawn.y1 },
              moveBy: intent.moveBy,
              scaleBy: intent.scaleBy,
              ...(intent.rotateBy === undefined || intent.rotateBy === 0 ? {} : { rotateBy: intent.rotateBy }),
            },
          },
        },
      ]),
      fit: 'reflow',
      version: pick.version,
    };
  }
  // A LONE TEXT OBJECT, in no block the read answered, keeps PDFium's route (the block read was refused), and a group
  // without its block likewise; stated in ADR-0240's correction.
  const [first, second, ...rest] = object.members;
  if (first !== undefined && second !== undefined) {
    const { index: _index, ...group } = placement;
    return {
      kind: 'placePageObjects',
      ...group,
      indices: [first, second, ...rest],
      box: { left: drawn.x0, bottom: drawn.y0, right: drawn.x1, top: drawn.y1 },
    };
  }
  return { kind: 'placePageObject', ...placement };
}

/** The command that removes the picked object, by the writer that holds it: every member of a block. */
export function removeCommand(pick: ObjectPick): DispatchableCommand {
  const { object } = pick;
  return object.source === 'stamp'
    ? { kind: 'removeAnnotation', page: pick.page, indices: [object.index], version: pick.version }
    : { kind: 'deletePageObjects', page: pick.page, indices: [...object.members], version: pick.version };
}

/**
 * The command that moves the picked object one place `toward` the front or the back (ADR-0244), or `undefined` where it
 * has no neighbour that way, or is not one object of page content: a placed picture is the annotation writer's, and a
 * block is several objects a single step would pull apart.
 */
export function arrangeCommand(pick: ObjectPick, toward: 'forward' | 'backward'): DispatchableCommand | undefined {
  const { object } = pick;
  if (object.source !== 'content' || object.members.length !== 1) return undefined;
  if (toward === 'forward' ? object.index + 1 >= pick.walked : object.index === 0) return undefined;
  return { kind: 'arrangePageObject', page: pick.page, index: object.index, toward, version: pick.version };
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
    indices: [...pick.object.members],
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
  /** The version the command was sent at, where the command lane moved it on from the one it was composed at. */
  sentAt?: DocVersion,
): ObjectPick | undefined {
  if (current === undefined) return undefined;
  // A TEXT BLOCK THE OPERATOR WRITER PLACED (ADR-0240's correction of 2026-10-19) is renumbered by the placement, so the
  // selection follows its words to the next read rather than its old indices (`relocatePick`).
  if (command.kind === 'editTextOperators') {
    const { block } = current.object;
    if (block === undefined || command.page !== current.page || (sentAt ?? command.version) !== current.version) return undefined;
    return { ...current, version: produced, relocate: { text: block.text } };
  }
  // AN ARRANGEMENT OF THIS OBJECT says where it went (ADR-0244 Decision 2): the selection follows it there. One of
  // another object moved this one's index, and drops it as any change to the walk does.
  if (command.kind === 'arrangePageObject') {
    const mine = current.object.source === 'content' && command.page === current.page && command.index === current.object.index;
    if (!mine || (sentAt ?? command.version) !== current.version) return undefined;
    const at = command.toward === 'forward' ? command.index + 1 : command.index - 1;
    return { ...current, version: produced, object: { ...current.object, index: at, members: [at] } };
  }
  // THE WALK THE OBJECT IS IN DECIDES: a placement of a stamp keeps the annotation walk and says nothing of PDFium's.
  const kept =
    current.object.source === 'stamp'
      ? keepsTheAnnotationWalk(command)
        ? command
        : undefined
      : keepsTheObjectWalk(command)
        ? command
        : undefined;
  if (kept?.page !== current.page || (sentAt ?? kept.version) !== current.version) return undefined;
  return { ...current, version: produced };
}
