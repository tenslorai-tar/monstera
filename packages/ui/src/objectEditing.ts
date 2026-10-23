import type { AnnotationRect, DispatchableCommand, ListedObject } from '@monstera/contract';
import {
  MAX_OBJECT_SCALE,
  MAX_PAGE_COORDINATE,
  MIN_OBJECT_SCALE,
  arrangeNeighbourOf,
  blockEditOf,
  keepsTheAnnotationWalk,
} from '@monstera/contract';
import type { DocVersion, PageTransform } from '@monstera/shared';

import { HANDLES, type Handle, type Pixels, pixelsOf, resized } from './forms/fieldDesign.js';
import type { LookAt, LookBox } from './markLook.js';
import type { PaperPaint } from './paperAround.js';

/**
 * Edit object's mode, as data and the commands it builds
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)).
 *
 * Nothing here reads a client or draws. The objects arrive from the application's read, a press on the page arrives as
 * a point in PDF space, and what leaves is a command — so every rule about which object a press names, and which writer
 * edits it, is a function a case can call.
 *
 * ## Three kinds of thing, three writers (Decision 1)
 *
 * A picture, a shape or a group of the page's content is `drawn`, named by its kind and its place among its kind and
 * edited by `editDrawnObject`. A text block is `text`, the block Edit text opens, edited by the operator writer
 * (`editTextOperators`). A picture placed with Comment › Image is a `stamp`, edited by the annotation commands. The walks
 * are never joined: each object is named against the walk that holds it.
 */

/** The ribbon menu's four filters (Decision 8). */
export type ObjectFilter = 'all' | 'text' | 'images' | 'shapes';

/** The filters in the menu's order, the one list the four commands are built from. */
export const OBJECT_FILTERS: readonly ObjectFilter[] = ['all', 'text', 'images', 'shapes'];

/** What an object is, as a person names it: the page's own kinds, a text block, and a placed picture. */
export type ObjectKind = 'text' | 'path' | 'image' | 'shading' | 'form' | 'picture';

/** A colour in 0 to 255, as the commands carry one. */
export interface ObjectColour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A text block as its edit names it: each line's run indices, which lines wrap softly, and its words as read. */
export interface ObjectTextBlock {
  readonly lines: readonly (readonly number[])[];
  readonly soft: readonly boolean[];
  readonly text: string;
}

interface ObjectBase {
  /** Its index in the walk that holds it: PDFium's for page content, the annotation walk's for a stamp. */
  readonly index: number;
  /**
   * What SHOWS of it, in PDF space: the box its clip lets through. Every outline, handle and hit test takes this, so a
   * picture placed larger than its window is picked where it is seen.
   */
  readonly box: AnnotationRect;
}

/** One thing on the page the mode can select. */
export type EditableObject =
  | (ObjectBase & {
      readonly source: 'drawn';
      readonly kind: 'path' | 'image' | 'shading' | 'form';
      /** Its place among the page's objects of its kind, in PDFium's order: how the writer finds it (Decision 2). */
      readonly ordinal: number;
      /** The engine's own box, as if unclipped: what the command names it by and scales it about. */
      readonly drawn: AnnotationRect;
      /** Its fill, where PDFium describes one: what Properties shows for a shape. */
      readonly fill: ObjectColour | null;
    })
  | (ObjectBase & {
      readonly source: 'text';
      readonly kind: 'text';
      /** The PDFium indices its runs begin with, ascending: what a neighbour is found past. */
      readonly indices: readonly number[];
      readonly block: ObjectTextBlock;
      /** Its words' colour, as the block's base style reads it. */
      readonly fill: ObjectColour;
    })
  | (ObjectBase & { readonly source: 'stamp'; readonly kind: 'picture' });

/** One page's objects at the version every read answered at, page content first and stamps after. */
export interface PageObjects {
  readonly version: DocVersion;
  readonly objects: readonly EditableObject[];
  /** PDFium's listing of the page, every object in its order: what an arrange finds its neighbour in. */
  readonly listed: readonly ListedObject[];
  /** Whether the engine's walk stopped at its bound, so the page holds more than is outlined. */
  readonly truncated: boolean;
}

/** The one selected object: on one page, at one version, with the listing it was picked from. */
export interface ObjectPick {
  readonly page: number;
  readonly version: DocVersion;
  readonly object: EditableObject;
  readonly listed: readonly ListedObject[];
  /**
   * A text block an operator edit renumbered: the selection is the block with these words in the next read of the page,
   * and is no selection until that read finds it — a command built from it would name the old objects.
   */
  readonly relocate?: { readonly text: string };
  /**
   * Carried across an edit, so its object is described as it was BEFORE the edit: no selection until the next read of
   * the page gives it the object as it is now ({@link refreshPick}).
   */
  readonly readAgain?: true;
}

/** Whether a pick names its object as it is now, so a command may be built from it: read, and not waiting for a read. */
export function settled(pick: ObjectPick): boolean {
  return pick.relocate === undefined && pick.readAgain === undefined;
}

/**
 * The pick as `read`, the page's objects at the pick's version, describes it. A pick carried across an edit
 * ({@link carryPick}) names the object by where it is in its walk and still holds the box it had BEFORE the edit; every
 * command is built from the box, and a writer refuses an object that is not where its command says, so the pick takes
 * the read's object before anything is built from it.
 *
 * - A pick waiting to be found again ({@link ObjectPick.relocate}) is the one text block with its words, or no selection
 *   where none or several are.
 * - Any other is the object of the same source, kind and place in its walk, or no selection where the read has none.
 *
 * A pick on another page, or at another version, is answered as it is.
 */
export function refreshPick(current: ObjectPick | undefined, read: PageObjects, page: number): ObjectPick | undefined {
  if (current?.page !== page || current.version !== read.version) return current;
  if (current.relocate !== undefined) {
    const { text } = current.relocate;
    const found = read.objects.filter((object) => object.source === 'text' && object.block.text === text);
    const [only, ...more] = found;
    return only === undefined || more.length > 0 ? undefined : { page, version: read.version, object: only, listed: read.listed };
  }
  const was = current.object;
  const found = read.objects.find(
    (object) =>
      object.source === was.source &&
      object.index === was.index &&
      object.kind === was.kind &&
      (object.source !== 'drawn' || was.source !== 'drawn' || object.ordinal === was.ordinal),
  );
  return found === undefined ? undefined : { page, version: read.version, object: found, listed: read.listed };
}

/** Which kinds each filter outlines (ADR-0153 Decision 2's table, kept by ADR-0264). */
const SHOWN: Readonly<Record<ObjectFilter, ReadonlySet<ObjectKind>>> = {
  all: new Set(['text', 'path', 'image', 'shading', 'form', 'picture']),
  text: new Set(['text']),
  images: new Set(['image', 'picture']),
  shapes: new Set(['path', 'shading']),
};

/** Whether `filter` outlines `object`. */
export function shownBy(filter: ObjectFilter, object: EditableObject): boolean {
  return SHOWN[filter].has(object.kind);
}

/** Whether a filter outlines text, and so needs the page's text blocks read (Images and Shapes do not). */
export function showsText(filter: ObjectFilter): boolean {
  return SHOWN[filter].has('text');
}

/**
 * The page a queue of object reads runs next: the page on show, else the one nearest it, so the page a person is
 * looking at is outlined first rather than after the pages mounted around it (Decision 9).
 */
export function nextRead(waiting: readonly number[], onShow: number): number | undefined {
  return [...waiting].sort((a, b) => Math.abs(a - onShow) - Math.abs(b - onShow) || a - b)[0];
}

/**
 * A queue that runs one page's object read at a time, the page on show first ({@link nextRead}): every page laid out asks
 * at once, and the document's reads run one after another in its lane anyway, so holding them here costs nothing and
 * lets the page a person is looking at go first.
 *
 * @param onShow the page on show when a read is chosen, read then and not when the queue was made
 */
export function createReadQueue(onShow: () => number): <T>(page: number, read: () => Promise<T>) => Promise<T> {
  const waiting: { readonly page: number; readonly start: () => void }[] = [];
  let running = false;
  const runNext = (): void => {
    if (running) return;
    const page = nextRead(
      waiting.map((each) => each.page),
      onShow(),
    );
    const at = waiting.findIndex((each) => each.page === page);
    const [next] = at < 0 ? [] : waiting.splice(at, 1);
    if (next === undefined) return;
    running = true;
    next.start();
  };
  return <T>(page: number, read: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push({
        page,
        start: () => {
          read()
            .then(resolve, reject)
            .finally(() => {
              running = false;
              runNext();
            });
        },
      });
      // CHOSEN AFTER THIS TICK, so every page laid out in the same render has asked before one is chosen: started at once,
      // the first page to ask — the top of the list — would go first whatever is on show.
      queueMicrotask(runNext);
    });
}

/** How much of the page an object must cover to be its BACKDROP: nine tenths of the page's area. */
const BACKDROP_SHARE = 0.9;

/**
 * Whether `object` is a backdrop of `page`, its crop box: it covers nine tenths of the page or more. A full-page fill
 * or a group holding the whole page is drawn behind what a person means to pick, whatever its place in the walk.
 */
export function isBackdrop(object: EditableObject, page: AnnotationRect): boolean {
  const width = Math.min(object.box.x1, page.x1) - Math.max(object.box.x0, page.x0);
  const height = Math.min(object.box.y1, page.y1) - Math.max(object.box.y0, page.y0);
  const area = (page.x1 - page.x0) * (page.y1 - page.y0);
  return width > 0 && height > 0 && area > 0 && width * height >= BACKDROP_SHARE * area;
}

/**
 * The order a press finds the page's objects in, BOTTOM FIRST: its backdrops, then everything else in its drawing
 * order, page content then stamps. A page-sized fill drawn after the small objects on it would take every press; under
 * this order it is found only where nothing else is. The layer draws its outlines in this order and {@link objectAt}
 * reads it, so the two cannot disagree about what a press names.
 */
export function pickingOrder(objects: readonly EditableObject[], page: AnnotationRect): readonly EditableObject[] {
  return [...objects.filter((object) => isBackdrop(object, page)), ...objects.filter((object) => !isBackdrop(object, page))];
}

/**
 * The object a press at `point` names under `filter`: the TOPMOST one containing it in {@link pickingOrder}, so a
 * backdrop only where nothing else is. `undefined` on blank paper. Answered from the outlines already in the window,
 * with no trip to the helper (Decision 9).
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

/** Whether a resize of `object` may change its proportions: a drawn object or a placed picture; never a text block. */
export function stretches(object: EditableObject): boolean {
  return object.source !== 'text';
}

/** The corners alone: what a text block is resized by, since its words keep their proportions. */
const CORNERS: readonly Handle[] = ['nw', 'ne', 'se', 'sw'];

/** The handles the selected object is resized by: every side and corner, or a text block's four corners. */
export function handlesOf(object: EditableObject): readonly Handle[] {
  return stretches(object) ? HANDLES : CORNERS;
}

/**
 * A box resized by `handle` dragged to `to`, in the layer's pixels: `fieldDesign.ts`' rule where the object stretches,
 * and for a text block the box scaled about its OPPOSITE corner by the factor the drag's width asks, so what the drag
 * shows is what the operator writer's one factor will write.
 */
export function resizedBy(object: EditableObject, start: Pixels, handle: Handle, to: readonly [number, number], least: number): Pixels {
  if (stretches(object)) return resized(start, handle, to, least);
  const width = start.x1 - start.x0;
  const height = start.y1 - start.y0;
  const west = handle.includes('w');
  const north = handle.includes('n');
  const anchor = [west ? start.x1 : start.x0, north ? start.y1 : start.y0] as const;
  const wide = Math.max(Math.abs(to[0] - anchor[0]), least);
  const scale = width > 0 ? wide / width : 1;
  const tall = height * scale;
  return {
    x0: west ? anchor[0] - wide : anchor[0],
    x1: west ? anchor[0] : anchor[0] + wide,
    y0: north ? anchor[1] - tall : anchor[1],
    y1: north ? anchor[1] : anchor[1] + tall,
  };
}

/** A box in the overlay's pixels as a look draws one. */
function lookBox(rect: AnnotationRect, transform: PageTransform): LookBox {
  const box = pixelsOf(rect, transform);
  return { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/**
 * The FINAL LOOK of an object moved, resized or removed, held until the page draws the result (Decision 9, ADR-0257):
 * the paper over the place it left and its lifted pixels where it landed. By its place in PDF space, so it is drawn
 * through the page's transform at whatever zoom the page is shown.
 *
 * - A placed picture is an annotation, which the page draws without while the look stands (`leaves`), so it needs no
 *   paper; page content is in the page's drawing, which only paper hides.
 * - `paper` is absent where the drawn page could not be read round the object; the look then shows only where it landed.
 * - `picture` is absent for a removal, and where no pixels could be lifted.
 */
export function liftedLook(
  object: EditableObject,
  landed: AnnotationRect | undefined,
  picture: string | undefined,
  paper: PaperPaint | undefined,
): LookAt {
  return (transform) => ({
    parts: [
      ...(paper === undefined || object.source === 'stamp' ? [] : [{ part: 'paper' as const, box: lookBox(object.box, transform), paint: paper }]),
      ...(picture === undefined || landed === undefined ? [] : [{ part: 'picture' as const, box: lookBox(landed, transform), src: picture }]),
    ],
    ...(object.source === 'stamp' ? { leaves: object.index } : {}),
  });
}

/** A coordinate held inside what a placement may carry. */
function bounded(value: number): number {
  return Math.min(Math.max(value, -MAX_PAGE_COORDINATE), MAX_PAGE_COORDINATE);
}

/** A scale held inside what a placement may carry. */
function scaled(value: number): number {
  return Math.min(Math.max(value, MIN_OBJECT_SCALE), MAX_OBJECT_SCALE);
}

/** A box as the drawn command names one. */
function engineBox(box: AnnotationRect): { left: number; bottom: number; right: number; top: number } {
  return { left: box.x0, bottom: box.y0, right: box.x1, top: box.y1 };
}

/** An edit of the picked text block through the operator writer, its words and lines as read (Decision 5). */
function textEdit(
  pick: ObjectPick,
  block: ObjectTextBlock,
  change: Pick<Parameters<typeof blockEditOf>[0][number], 'place' | 'marks'> & { readonly text?: string },
): DispatchableCommand {
  return {
    kind: 'editTextOperators',
    page: pick.page,
    ...blockEditOf([{ lines: block.lines.map((line) => [...line]), soft: [...block.soft], text: change.text ?? block.text, ...change }]),
    fit: 'reflow',
    version: pick.version,
  };
}

/**
 * The command that puts the picked object at `target`, a box in PDF space — a move when only its corner changed, a
 * resize when its size did. `undefined` when it would change nothing, so a press that did not travel sends no version.
 *
 * - **A drawn object** scales about its engine box's lower-left corner, one axis at a time, and then moves: the move is
 *   what puts the SHOWN corner on the target's, less what the scale about the engine's corner already carried it.
 * - **A text block** keeps its proportions and scales about its top left, the operator writer's own anchor: one factor,
 *   from the widths, and the move that puts its top left on the target's.
 * - **A stamp** is placed at the box by its own writer.
 */
export function placeCommand(pick: ObjectPick, target: AnnotationRect): DispatchableCommand | undefined {
  const { object } = pick;
  const from = object.box;
  if (from.x0 === target.x0 && from.y0 === target.y0 && from.x1 === target.x1 && from.y1 === target.y1) return undefined;
  if (object.source === 'stamp') {
    return { kind: 'placeAnnotation', page: pick.page, placements: [{ index: object.index, rect: target }], version: pick.version };
  }
  const width = from.x1 - from.x0;
  const height = from.y1 - from.y0;
  if (object.source === 'text') {
    const scale = width > 0 ? scaled((target.x1 - target.x0) / width) : 1;
    const move = { x: bounded(target.x0 - from.x0), y: bounded(target.y1 - from.y1) };
    return textEdit(pick, object.block, { place: { ...(move.x === 0 && move.y === 0 ? {} : { move }), ...(scale === 1 ? {} : { scale }) } });
  }
  const scaleBy = {
    x: width > 0 ? scaled((target.x1 - target.x0) / width) : 1,
    y: height > 0 ? scaled((target.y1 - target.y0) / height) : 1,
  };
  const drawn = object.drawn;
  return {
    kind: 'editDrawnObject',
    page: pick.page,
    index: object.index,
    object: object.kind,
    ordinal: object.ordinal,
    box: engineBox(drawn),
    edit: {
      op: 'place',
      // p' = s·p + drawn·(1 − s) + move puts the shown corner at the target's exactly; nothing narrowed: drawn is the box.
      moveBy: {
        x: bounded(target.x0 - from.x0 + (from.x0 - drawn.x0) * (1 - scaleBy.x)),
        y: bounded(target.y0 - from.y0 + (from.y0 - drawn.y0) * (1 - scaleBy.y)),
      },
      scaleBy,
    },
    version: pick.version,
  };
}

/** Whether the picked object can be recoloured in this version: a shape, or a text block (Decision 1's table). */
export function recolourable(object: EditableObject): boolean {
  return (object.source === 'drawn' && object.kind === 'path') || object.source === 'text';
}

/** The colour Properties shows for the picked object, where it has one a person may change. */
export function colourOf(object: EditableObject): ObjectColour | undefined {
  if (!recolourable(object)) return undefined;
  return object.source === 'stamp' ? undefined : (object.fill ?? undefined);
}

/** The command that recolours the picked object, or `undefined` where it is not recoloured in this version. */
export function recolourCommand(pick: ObjectPick, colour: ObjectColour): DispatchableCommand | undefined {
  const { object } = pick;
  if (!recolourable(object)) return undefined;
  if (object.source === 'text') {
    // EVERY WORD, NOTHING ELSE SET: the operator writer then carries every line as it was with the colour (Decision 5).
    return object.block.text === '' ? undefined : textEdit(pick, object.block, { marks: [{ from: 0, to: object.block.text.length, set: { colour } }] });
  }
  if (object.source !== 'drawn') return undefined;
  return {
    kind: 'editDrawnObject',
    page: pick.page,
    index: object.index,
    object: object.kind,
    ordinal: object.ordinal,
    box: engineBox(object.drawn),
    edit: { op: 'recolor', colour },
    version: pick.version,
  };
}

/**
 * The command that moves the picked object one step `to` the front or the back, past the nearest object on that side
 * that overlaps it (`arrangeNeighbourOf`, the contract's one rule); `undefined` where none does, or for a placed picture,
 * whose writer keeps annotations in their own order.
 */
export function arrangeCommand(pick: ObjectPick, to: 'forward' | 'backward'): DispatchableCommand | undefined {
  const { object } = pick;
  if (object.source === 'stamp') return undefined;
  const self = {
    text: object.source === 'text',
    indices: object.source === 'text' ? object.indices : [object.index],
    box: engineBox(object.box),
  };
  const past = arrangeNeighbourOf(pick.listed, self, to);
  if (past === undefined) return undefined;
  if (object.source === 'text') return textEdit(pick, object.block, { place: { arrange: { to, past } } });
  return {
    kind: 'editDrawnObject',
    page: pick.page,
    index: object.index,
    object: object.kind,
    ordinal: object.ordinal,
    box: engineBox(object.drawn),
    edit: { op: 'arrange', to, past },
    version: pick.version,
  };
}

/** The command that removes the picked object, by the writer that holds it: a text block is emptied (Decision 5). */
export function removeCommand(pick: ObjectPick): DispatchableCommand {
  const { object } = pick;
  if (object.source === 'stamp') return { kind: 'removeAnnotation', page: pick.page, indices: [object.index], version: pick.version };
  if (object.source === 'text') return textEdit(pick, object.block, { text: '' });
  return {
    kind: 'editDrawnObject',
    page: pick.page,
    index: object.index,
    object: object.kind,
    ordinal: object.ordinal,
    box: engineBox(object.drawn),
    edit: { op: 'delete' },
    version: pick.version,
  };
}

/**
 * The pick after `command` produced `produced` (Decision 8's rule, ADR-0153 Decision 4's kept):
 *
 * - a drawn object PLACED or RECOLOURED keeps its kind, its place among its kind and its index in PDFium's walk (the
 *   wrap and the colour make no object), so it stays selected at the new version;
 * - a text block's operator edit renumbers the page's text, so the selection follows its words to the next read;
 * - a stamp placed keeps the annotation walk;
 * - an arrange or a removal changes where the object is in the walk, and drops the selection.
 */
export function carryPick(
  current: ObjectPick | undefined,
  command: DispatchableCommand,
  produced: DocVersion,
  /** The version the command was sent at, where the command lane moved it on from the one it was composed at. */
  sentAt?: DocVersion,
): ObjectPick | undefined {
  if (current === undefined) return undefined;
  const at = sentAt ?? ('version' in command ? command.version : undefined);
  if (at !== current.version || !('page' in command) || command.page !== current.page) return undefined;
  const { object } = current;
  if (command.kind === 'editDrawnObject') {
    const kept = object.source === 'drawn' && command.index === object.index && (command.edit.op === 'place' || command.edit.op === 'recolor');
    return kept ? { ...current, version: produced, readAgain: true } : undefined;
  }
  if (command.kind === 'editTextOperators') {
    // A BLOCK EMPTIED OR ARRANGED leaves no block with its words where it was: nothing to find again.
    const placed = command.places?.[0];
    const words = command.text;
    if (object.source !== 'text' || words === '' || placed?.arrange !== undefined) return undefined;
    return { ...current, version: produced, relocate: { text: object.block.text } };
  }
  return object.source === 'stamp' && keepsTheAnnotationWalk(command) ? { ...current, version: produced, readAgain: true } : undefined;
}
