import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import type { DocVersion, PageTransform, ViewportPoint } from '@monstera/shared';
import { pdfPoint, toPdf, toViewport, viewportPoint } from '@monstera/shared';

import { HINT_SELECT } from '../messages/en.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import type { AnnotationSnapshot, ErasableAnnotation } from './eraserTool.js';
import { markAt } from './eraserTool.js';
import { type ReopenDeps, reopenWords } from './textTools.js';


/**
 * The select tool — the first whose gesture produces **no command at all**.
 *
 * ## It fits the seam, and that was checked before it was assumed
 *
 * Selecting is not a mutation, so `commit` answers `undefined` every time and
 * the selection travels through a dependency the tool holds — the same shape as
 * the sticky note's `ask` and the eraser's read. That is worth stating because
 * the obvious reading is that this needs a platform change: a selection outlives
 * a gesture, is drawn while nothing is being dragged, and answers to the
 * keyboard, none of which a controller can do.
 *
 * None of those is the tool's, and that is why no amendment was owed
 * ([ADR-0042](../../../../docs/DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)
 * made the same check one row earlier and found the opposite). The state lives
 * where the application's state lives; the drawing is `SelectionLayer`, a
 * component beside the overlay rather than inside it; and the keyboard is the
 * **command registry**, which is where a key already reaches a feature. A tool
 * that held any of the three would be the second wiring place three surfaces
 * would then have to agree with.
 *
 * ## Two gestures, and the threshold decides which
 *
 * A click picks the topmost annotation under it. A drag draws a marquee and
 * picks everything it touches — which is how *multi* is expressed without a
 * modifier key, since `Gesture` records what the pointer did and not what was
 * held down while it did it. Shift-click-to-add is the ordinary convenience on
 * top of that and it is **owed**: the platform would have to record modifiers,
 * which is a third widening of `Gesture` and belongs with the tool that cannot
 * work without one.
 *
 * ## TOUCHES, not contains
 *
 * A marquee selects an annotation whose box it overlaps at all. Requiring
 * containment is the other convention and it is worse here: annotations are
 * often larger than the region a person sweeps, and a marquee that selected
 * nothing because the box hung over the edge would read as the tool being
 * broken rather than as a rule.
 *
 * ## Selecting NOTHING is a selection
 *
 * A click on blank paper clears. That is a real outcome rather than a no-op, and
 * it is what makes the tool feel like a selection tool — so the dependency is
 * called with an empty selection rather than not called at all.
 */

/** The id, shared with the command that selects this tool. */
export const SELECT_TOOL_ID = 'annotate.select';

/**
 * How far the pointer must travel before a click becomes a marquee.
 *
 * `shapeTools.ts`' `MINIMUM_DRAG` and its number, stated separately for the
 * reason that file states its own three separately: this one decides between
 * two *gestures* where those decide whether a shape has extent, and a shared
 * constant would tie a hand's steadiness to a rule about degenerate rectangles.
 */
const MINIMUM_MARQUEE = 4;

/** One selected annotation, with where it is so a layer can draw it. */
export interface SelectedAnnotation {
  readonly index: number;
  readonly rect: AnnotationRect;
  /**
   * What it is drawn in, carried from the walk.
   *
   * The comment styles panel shows it, and it is carried rather than re-read
   * for the version's reason: a selection is a set of handles at ONE version,
   * and a style fetched later would describe a document the handles may no
   * longer name.
   */
  readonly style: ErasableAnnotation['style'];
  /** Its subtype, carried from the walk for {@link style}'s reason. */
  readonly kind: ErasableAnnotation['kind'];
  /** What it says now, carried from the walk for {@link style}'s reason. */
  readonly contents: ErasableAnnotation['contents'];
  /** Whether the walk cut {@link contents}, carried for {@link style}'s reason; an editor reads the whole words. */
  readonly cut?: ErasableAnnotation['cut'];
  /** Who it names, carried from the walk for {@link style}'s reason (ADR-0103). */
  readonly author: ErasableAnnotation['author'];
  /** When it was made, or `null`, carried for the same reason. */
  readonly created: ErasableAnnotation['created'];
  /** The blend it is drawn in, carried for the same reason. */
  readonly blend: ErasableAnnotation['blend'];
  /** How a text box's words are drawn, carried for the same reason — the Properties tab's Text section (item 14b). */
  readonly typed?: ErasableAnnotation['typed'];
}

/**
 * What is selected, on one page, at one version.
 *
 * **The version is part of it**, for the handle's reason
 * ([ADR-0041](../../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)):
 * the indices are positions in one walk, so a selection that outlived its
 * version would be arithmetic pointing at whatever is now there. The holder
 * drops it when the document moves rather than carrying it forward.
 *
 * **One page**, because a gesture belongs to the page it started on and neither
 * a click nor a marquee can reach a second. `removeAnnotation`'s payload has the
 * same shape for the same reason.
 */
export interface AnnotationSelection {
  readonly page: number;
  readonly version: DocVersion;
  /** Never empty — an empty selection is `undefined`, so there is one *nothing*. */
  readonly items: readonly SelectedAnnotation[];
}

/**
 * One walk entry as a selected item, or `undefined` for a mark on a page that displays no region —
 * there is nowhere to draw it selected. The select tool and {@link carrySelection} both build items
 * here, so a field joining the item is read from the walk in one place.
 */
function selectedFrom(entry: ErasableAnnotation): SelectedAnnotation | undefined {
  if (entry.rect === null) return undefined;
  return {
    index: entry.index,
    rect: entry.rect,
    style: entry.style,
    kind: entry.kind,
    contents: entry.contents,
    ...(entry.cut === true ? { cut: true as const } : {}),
    author: entry.author,
    created: entry.created,
    blend: entry.blend,
    ...(entry.typed === undefined ? {} : { typed: entry.typed }),
  };
}

/**
 * The selection a command in `KEEPS_THE_ANNOTATION_WALK` leaves behind (ADR-0102).
 *
 * `composed` is the command's own page and version — what it was sent against. The result names the
 * same indices at `produced`, the version the command answered with, and takes every field from
 * `walk`, the read made after it: a carried selection is a fresh read by position, never the old
 * items with a new version on them.
 *
 * **Anything that does not line up drops it.** A selection other than the one the command was
 * composed from is left alone; a read at any version but `produced` means something else moved the
 * document in between, so the positions are not known to name the same marks; and an index the
 * read does not answer, or answers with no region, cannot be drawn.
 */
export function carrySelection(
  current: AnnotationSelection | undefined,
  composed: { readonly page: number; readonly version: DocVersion },
  produced: DocVersion,
  walk: AnnotationSnapshot | undefined,
): AnnotationSelection | undefined {
  if (current?.page !== composed.page || current.version !== composed.version) return current;
  if (walk?.version !== produced) return undefined;
  const items: SelectedAnnotation[] = [];
  for (const item of current.items) {
    const entry = walk.annotations.find((candidate) => candidate.page === current.page && candidate.index === item.index);
    const carried = entry === undefined ? undefined : selectedFrom(entry);
    if (carried === undefined) return undefined;
    items.push(carried);
  }
  return { page: current.page, version: produced, items };
}

/**
 * Every mark on `page` that draws a region, selected at the walk's own version — *Select all* on the page (ADR-0107).
 * `undefined` when there is none, for {@link AnnotationSelection}'s one *nothing*. Items come from `selectedFrom`, as
 * the select tool's and {@link carrySelection}'s do.
 */
export function selectionOfPage(walk: AnnotationSnapshot, page: number): AnnotationSelection | undefined {
  const items = walk.annotations
    .filter((entry) => entry.page === page)
    .map(selectedFrom)
    .filter((item): item is SelectedAnnotation => item !== undefined);
  return items.length === 0 ? undefined : { page, version: walk.version, items };
}

/**
 * The mark a creation just added to `page`, selected at the walk's own version — what a placed signature is held as, so
 * a drag moves it and a corner resizes it (ADR-0133). `undefined` when the page draws none.
 *
 * **The highest index on the page**, because a creation appends: MuPDF's `createAnnotation` adds the new object at the
 * end of `/Annots`, and the walk's index is a position in it ([ADR-0041]). The caller passes a walk read at the
 * version the creation answered, so no other mark can have landed after it in between.
 */
export function selectionOfNewest(walk: AnnotationSnapshot, page: number): AnnotationSelection | undefined {
  let newest: ErasableAnnotation | undefined;
  for (const entry of walk.annotations) {
    if (entry.page === page && (newest === undefined || entry.index > newest.index)) newest = entry;
  }
  const item = newest === undefined ? undefined : selectedFrom(newest);
  return item === undefined ? undefined : { page, version: walk.version, items: [item] };
}

export interface SelectDeps extends ReopenDeps {
  /** The same read the eraser holds. */
  readonly annotations: () => Promise<AnnotationSnapshot | undefined>;
  /** Where the selection goes. `undefined` is *nothing is selected*. */
  readonly onSelect: (selection: AnnotationSelection | undefined) => void;
  /**
   * What is selected now, read through a function for `toolCommand`'s reason:
   * a controller is built once and a captured selection would be whatever was
   * selected at registration for ever.
   */
  readonly selected: () => AnnotationSelection | undefined;
}

/**
 * How close to a corner counts as grabbing it, in CSS pixels.
 *
 * The radius a person's aim actually needs, comfortably larger than {@link MINIMUM_MARQUEE}, so a press that grabs a
 * corner and slips is a resize rather than a marquee that happens to start on one.
 *
 * **Exported because the handles are DRAWN from it** (ADR-0133 Decision 4): `SelectionLayer` draws each corner's handle
 * as a square this many pixels across, centred on the corner, so every drawn pixel of a handle lies inside the reach —
 * the drawn handle and the hit target are one number, and a handle cannot promise a grab the tool would not make.
 */
export const CORNER_REACH = 8;

/** The four corners of a box, in the overlay's own pixels. */
function cornersOf(box: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): readonly (readonly [number, number, number, number])[] {
  // Each entry is the corner's point followed by the OPPOSITE corner, which is
  // what a resize keeps fixed. Carrying both is what stops the caller
  // rediscovering which corner is which from the drag's direction.
  return [
    [box.x0, box.y0, box.x1, box.y1],
    [box.x1, box.y0, box.x0, box.y1],
    [box.x0, box.y1, box.x1, box.y0],
    [box.x1, box.y1, box.x0, box.y0],
  ];
}

/**
 * The kinds whose box IS the shape, so a side's midpoint can be pulled on its own axis (the owner's review of 2026-10-07,
 * item 14a). A line's or a polygon's box is only the span of its points, and stretching one edge of it would move points
 * nobody grabbed; those keep their four corners.
 */
export const SIDE_RESIZABLE_KINDS: ReadonlySet<string> = new Set([
  'square',
  'circle',
  'text-box',
  'callout',
  'typewriter',
  'stamp',
  'redact',
]);

/** One edge of a box: the midpoint a person grabs, and the two corners (as [x, y] pairs) the resize keeps fixed or moves. */
export type SideHandle = 'top' | 'bottom' | 'left' | 'right';

/**
 * The four side midpoints, each with the SIDE it moves. Carried as a named side rather than re-derived from the drag's
 * direction, as {@link cornersOf} carries its opposite corner.
 */
export function sidesOf(box: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): readonly (readonly [SideHandle, number, number])[] {
  const midX = (box.x0 + box.x1) / 2;
  const midY = (box.y0 + box.y1) / 2;
  return [
    ['top', midX, box.y0],
    ['bottom', midX, box.y1],
    ['left', box.x0, midY],
    ['right', box.x1, midY],
  ];
}

/**
 * A rectangle in the overlay's own pixels, or `null` when there is none.
 *
 * **Takes the RECT rather than the row**, so both callers — a listed annotation
 * and a selected one — hand over the only field it reads. It used to take the
 * row, and the selected side had to build a synthetic one out of three fields
 * to call it: a fixture inside the product, which is where two shapes for one
 * thing start.
 */
function boxOf(
  rect: AnnotationRect | null,
  transform: PageTransform,
): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null {
  if (rect === null) return null;
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** The gesture's box in the overlay's own pixels, ordered. */
function marqueeOf(gesture: Gesture): {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly travelled: number;
} {
  const from: ViewportPoint = startOf(gesture);
  const to: ViewportPoint = endOf(gesture);
  return {
    x0: Math.min(from.x, to.x),
    y0: Math.min(from.y, to.y),
    x1: Math.max(from.x, to.x),
    y1: Math.max(from.y, to.y),
    travelled: Math.hypot(to.x - from.x, to.y - from.y),
  };
}

/** A box in PDF space from two viewport corners, normalised. */
function pdfBox(
  a: readonly [number, number],
  b: readonly [number, number],
  transform: PageTransform,
): AnnotationRect {
  const p = toPdf(viewportPoint(a[0], a[1]), transform);
  const q = toPdf(viewportPoint(b[0], b[1]), transform);
  return {
    x0: Math.min(p.x, q.x),
    y0: Math.min(p.y, q.y),
    x1: Math.max(p.x, q.x),
    y1: Math.max(p.y, q.y),
  };
}

/** A box in the overlay's own pixels. */
interface PixelBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * What a press at a point grabs on the selection (ADR-0201): the ONE hit test, which the press and the pointer both ask.
 *
 * Corners are tested first, then side midpoints of the marks whose box is the shape, then the inside of any selected box —
 * the order a press has always taken, so a small box whose corner and midpoint overlap still resizes from the corner. A
 * corner carries the OPPOSITE corner (what a resize keeps fixed) and the direction of its arrow; a side carries the side and
 * the box it pulls.
 */
type Grab =
  | { readonly kind: 'corner'; readonly item: SelectedAnnotation; readonly opposite: { readonly x: number; readonly y: number }; readonly arrow: 'resize-nwse' | 'resize-nesw' }
  | { readonly kind: 'side'; readonly item: SelectedAnnotation; readonly side: SideHandle; readonly box: PixelBox }
  | { readonly kind: 'inside' };

/** The arrow for each of {@link cornersOf}'s four corners, in its order: top-left, top-right, bottom-left, bottom-right. */
const CORNER_ARROWS = ['resize-nwse', 'resize-nesw', 'resize-nesw', 'resize-nwse'] as const;

function grabbedAt(
  selection: AnnotationSelection,
  from: ViewportPoint,
  transform: PageTransform,
): Grab | undefined {
  for (const item of selection.items) {
    const box = boxOf(item.rect, transform);
    if (box === null) continue;
    for (const [at, [cx, cy, ox, oy]] of cornersOf(box).entries()) {
      if (Math.hypot(from.x - cx, from.y - cy) > CORNER_REACH) continue;
      return { kind: 'corner', item, opposite: { x: ox, y: oy }, arrow: CORNER_ARROWS[at] ?? 'resize-nwse' };
    }
  }
  for (const item of selection.items) {
    if (!SIDE_RESIZABLE_KINDS.has(item.kind)) continue;
    const box = boxOf(item.rect, transform);
    if (box === null) continue;
    for (const [side, sx, sy] of sidesOf(box)) {
      if (Math.hypot(from.x - sx, from.y - sy) > CORNER_REACH) continue;
      return { kind: 'side', item, side, box };
    }
  }
  const inside = selection.items.some((item) => {
    const box = boxOf(item.rect, transform);
    return box !== null && from.x >= box.x0 && from.x <= box.x1 && from.y >= box.y0 && from.y <= box.y1;
  });
  return inside ? { kind: 'inside' } : undefined;
}

/** Where a drag on the selection puts each mark, at the selection's version. */
interface Placement {
  readonly version: AnnotationSelection['version'];
  readonly placements: readonly { readonly index: number; readonly rect: AnnotationRect }[];
}

/**
 * Where a drag on the existing selection puts its marks, or `undefined` when
 * the gesture did not start on it.
 *
 * **The one answer the command and the preview both take** (ADR-0166): what is
 * drawn while the drag is in flight is what a release would send, so the two
 * cannot disagree about where a mark goes.
 *
 * Two cases and they are told apart by where the press landed:
 *
 * - **on a corner** of a selected box — resize that one annotation, keeping the
 *   opposite corner fixed. One rather than all: dragging a corner means *make
 *   this that size*, and scaling four marks from one corner is a different
 *   operation nobody asked for by grabbing a handle.
 * - **inside** a selected box — move every selected annotation by the drag's
 *   delta. All of them, because that is what a multi-selection is for.
 *
 * A press that did not move is neither: it falls through to the pick below, so
 * clicking a selected annotation re-selects it rather than committing a
 * zero-length move and a version bump.
 */
function placementFor(
  selection: AnnotationSelection | undefined,
  gesture: Gesture,
  marquee: ReturnType<typeof marqueeOf>,
  page: number,
  transform: PageTransform,
): Placement | undefined {
  if (selection === undefined) return undefined;
  // A SELECTION BELONGS TO ONE PAGE, so a gesture on any other is a pick.
  if (selection.page !== page) return undefined;
  // A PRESS THAT DID NOT TRAVEL IS NOT A DRAG. Without this, clicking what is
  // already selected commits a zero-length placement — a version bump and an
  // undo entry for a document that did not change.
  if (marquee.travelled < MINIMUM_MARQUEE) return undefined;

  const from = startOf(gesture);
  const to = endOf(gesture);

  const grab = grabbedAt(selection, from, transform);
  if (grab === undefined) return undefined;
  if (grab.kind === 'corner') {
    return {
      placements: [{ index: grab.item.index, rect: pdfBox([grab.opposite.x, grab.opposite.y], [to.x, to.y], transform) }],
      version: selection.version,
    };
  }
  if (grab.kind === 'side') {
    // A SIDE MIDPOINT of a box-shaped mark pulls that edge alone: the other three stay where they are.
    const { box, side } = grab;
    const moved = {
      x0: side === 'left' ? to.x : box.x0,
      x1: side === 'right' ? to.x : box.x1,
      y0: side === 'top' ? to.y : box.y0,
      y1: side === 'bottom' ? to.y : box.y1,
    };
    return {
      placements: [{ index: grab.item.index, rect: pdfBox([moved.x0, moved.y0], [moved.x1, moved.y1], transform) }],
      version: selection.version,
    };
  }

  // THE DELTA IS TAKEN IN PDF SPACE, from two viewport points through the one
  // converter. Subtracting screen pixels and scaling by the zoom would be a
  // second implementation of the transform, and it would be wrong on a rotated
  // page in a way no unrotated fixture shows.
  const origin = toPdf(viewportPoint(from.x, from.y), transform);
  const moved = toPdf(viewportPoint(to.x, to.y), transform);
  const dx = moved.x - origin.x;
  const dy = moved.y - origin.y;
  return {
    placements: selection.items.map((item) => ({
      index: item.index,
      rect: {
        x0: item.rect.x0 + dx,
        y0: item.rect.y0 + dy,
        x1: item.rect.x1 + dx,
        y1: item.rect.y1 + dy,
      },
    })),
    version: selection.version,
  };
}

export function selectTool(deps: SelectDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<DispatchableCommand | undefined> => {
      const marquee = marqueeOf(gesture);

      // A GESTURE THAT STARTED ON THE SELECTION IS AN EDIT, NOT A PICK, and it
      // is decided before the read: what was already selected is state this tool
      // holds, so a drag on it needs no round trip. The order matters — testing
      // for a marquee first would make every drag inside a selected annotation
      // replace the selection with that annotation, which is the interaction
      // every editor gets right by asking this question first.
      const moved = placementFor(deps.selected(), gesture, marquee, page, transform);
      if (moved !== undefined) return { kind: 'placeAnnotation', page, ...moved };

      const snapshot = await deps.annotations();
      if (snapshot === undefined) {
        // NOTHING TO SELECT FROM. The selection is cleared rather than left
        // alone: whatever it named was read from a document that is now closed
        // or unreadable, and keeping it would draw boxes over a page nobody can
        // name annotations on.
        deps.onSelect(undefined);
        return undefined;
      }

      const onPage = snapshot.annotations.filter((entry) => entry.page === page);
      const picked =
        marquee.travelled < MINIMUM_MARQUEE
          ? // A CLICK: `markAt`, the one rule the eraser and a reopen take too, at the point pressed — so clicking to
            // select, to erase and to edit pick the same mark from the same pixel.
            [markAt(onPage, page, startOf(gesture), transform)].filter((entry) => entry !== undefined)
          : // A MARQUEE: everything it touches, in walk order, so the payload a
            // removal is built from is ordered the way the document is.
            onPage.filter((entry) => {
              const box = boxOf(entry.rect, transform);
              return (
                box !== null &&
                box.x0 <= marquee.x1 &&
                box.x1 >= marquee.x0 &&
                box.y0 <= marquee.y1 &&
                box.y1 >= marquee.y0
              );
            });

      const items = picked
        .map(selectedFrom)
        .filter((entry): entry is SelectedAnnotation => entry !== undefined);

      deps.onSelect(
        items.length === 0 ? undefined : { page, version: snapshot.version, items },
      );
      // NEVER A COMMAND. Selecting changes nothing about the document, and a
      // tool that returned one here would put a version bump behind a click
      // that was only meant to point at something.
      return undefined;
    },
    preview: (gesture: Gesture, page: number, transform: PageTransform): ToolPreview | undefined => {
      const marquee = marqueeOf(gesture);
      // NO MARQUEE UNTIL IT IS ONE. Below the threshold the gesture is still a
      // click, and drawing a one-pixel rectangle under the pointer would show a
      // region that is about to be ignored.
      if (marquee.travelled < MINIMUM_MARQUEE) return undefined;
      // A DRAG ON THE SELECTION IS DRAWN WHERE IT PUTS THE MARKS (ADR-0166), each one's box as the release would
      // place it. The box from the press to the pointer is a marquee's, and drawn for a move it was a ghost that
      // matched neither the mark nor where it went — and then was held there after the release.
      const moved = placementFor(deps.selected(), gesture, marquee, page, transform);
      if (moved !== undefined) {
        return {
          shape: 'boxes',
          boxes: moved.placements.flatMap(({ rect }) => {
            const box = boxOf(rect, transform);
            return box === null ? [] : [{ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }];
          }),
        };
      }
      return {
        shape: 'rect',
        x: marquee.x0,
        y: marquee.y0,
        width: marquee.x1 - marquee.x0,
        height: marquee.y1 - marquee.y0,
      };
    },
    // THE POINTER SAYS WHAT A PRESS HERE WOULD DO (ADR-0201), from `grabbedAt` — the test the press takes — so a resize
    // arrow is shown only where a drag resizes. A selection belongs to one page, so any other page's is the arrow.
    pointer: (at, page, transform) => {
      const selection = deps.selected();
      if (selection?.page !== page) return undefined;
      const grab = grabbedAt(selection, at, transform);
      if (grab === undefined) return undefined;
      if (grab.kind === 'corner') return grab.arrow;
      if (grab.kind === 'side') return grab.side === 'left' || grab.side === 'right' ? 'resize-ew' : 'resize-ns';
      return 'move';
    },
    // A DOUBLE-CLICK ON A TEXT MARK EDITS ITS WORDS where they are (ADR-0154 Decision 3): the first click has selected
    // it, and the second opens it. A double-click on any other mark reopens nothing.
    reopen: async (at, page, transform) => (await reopenWords(deps, at, page, transform)).command,
  };

  // THE ARROW: this tool picks what is there rather than drawing something new (the owner's review of 0.1.6.0).
  return { id: SELECT_TOOL_ID, controller, cursor: 'arrow', hint: HINT_SELECT };
}
