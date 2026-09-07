import type { AnnotationRect, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';

/**
 * The place-image tool — drag a box, pick a file, get a stamp.
 *
 * ## It produces NO COMMAND HERE, and that is `snapshotTool`'s shape rather
 * than the select tool's
 *
 * A placement very much changes the document — but the command that does it
 * carries the image, and `renderableCommandSchema` has `placeImage` removed, so
 * this side could not construct one if it wanted to. What crosses is the box
 * and the page; main opens the picker, reads the file and mints the command
 * ([ADR-0044](../../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
 *
 * So the dependency is not a workaround for a missing seam, it is the seam:
 * `commit` returning `RenderableCommand | undefined` is what lets a tool whose
 * effect is main's be a registration.
 *
 * ## The rectangle is converted HERE, by the one adapter
 *
 * `snapshotTool`'s reason: `toPdf` is what every tool in this directory uses,
 * so an image placed over a region and a rectangle drawn over it carry the same
 * numbers, and the kernel maps both out through `placedRect`.
 */

export const PLACE_IMAGE_TOOL_ID = 'annotate.image';

/**
 * How far a drag must run before it is a box.
 *
 * `snapshotTool`'s four pixels and its reason, with the same asymmetry the
 * shape tools have: an image scaled into a four-pixel box is invisible, and the
 * kernel would accept it — so the refusal here is what stops a slip from
 * opening a file dialog for a stamp nobody will be able to find.
 */
const MINIMUM_BOX = 4;

export interface PlaceImageDeps {
  /**
   * Where the box goes — the page and the rectangle, in PDF user space.
   *
   * A dependency rather than a command because the command carries an image
   * this side may not hold. The surface calls `document.placeImage`, which is
   * the channel main answers by running the picker.
   */
  readonly onPlaceImage: (page: number, rect: AnnotationRect) => void;
}

/** The box a drag describes, in the overlay's own pixels. */
function boxOf(gesture: Gesture): ToolPreview | undefined {
  const from = startOf(gesture);
  const to = endOf(gesture);
  if (Math.abs(to.x - from.x) < MINIMUM_BOX || Math.abs(to.y - from.y) < MINIMUM_BOX) {
    return undefined;
  }
  return {
    shape: 'rect',
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function placeImageTool(deps: PlaceImageDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      // BOTH AXES, `snapshotTool`'s reason: a box flat in one direction has no
      // area to draw an image into, and refusing here is what keeps a slip from
      // opening a file dialog.
      if (boxOf(gesture) === undefined) return undefined;
      const from = toPdf(startOf(gesture), transform);
      const to = toPdf(endOf(gesture), transform);
      // UNORDERED, deliberately: the kernel normalises, and ordering here would
      // be a second place that rule is stated.
      deps.onPlaceImage(page, { x0: from.x, y0: from.y, x1: to.x, y1: to.y });
      // NOTHING FOR THE COMMAND BUS — not because there is nothing to undo, but
      // because the command that does this cannot be expressed on this side.
      // Main mints it, and it reaches the log from there like every other one.
      return undefined;
    },
    preview: boxOf,
  };

  return { id: PLACE_IMAGE_TOOL_ID, controller };
}

/** Exported so the cases assert against the tool's own number. */
export { MINIMUM_BOX };
