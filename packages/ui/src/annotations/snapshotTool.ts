import type { AnnotationRect, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';

/**
 * The snapshot tool — drag a region, get a PNG.
 *
 * ## It produces NO COMMAND, which is the shape the select tool already has
 *
 * A snapshot does not change the document: there is nothing to log, nothing to
 * undo, and no version to bump. So `commit` answers `undefined` and the region
 * goes to a dependency, exactly as a selection does — the tool registry's
 * `commit` returning a `RenderableCommand | undefined` is what makes that a
 * registration rather than a seam to widen (B4 was checked and not needed).
 *
 * ## The rectangle is converted HERE, by the one adapter
 *
 * `toPdf` is what every other tool in this directory uses, and using it means a
 * snapshot of a region and a rectangle annotation drawn over the same region
 * carry the same numbers. The kernel then maps both out through `placedRect`,
 * so there is one statement of *where on the page this is* rather than two.
 */

export const SNAPSHOT_TOOL_ID = 'view.snapshot';

/**
 * How far a drag must run before it is a region.
 *
 * `shapeTools`' four pixels, for its reason and one more: a snapshot of a
 * four-pixel region is a file a person would have to open to discover was a
 * mistake, where a four-pixel rectangle is at least visible on the page.
 */
const MINIMUM_REGION = 4;

/**
 * Device pixels per PDF point.
 *
 * **Two, and it is a default rather than a measurement.** A point is 1/72 inch,
 * so this is 144 dpi — twice what the page declares, which is what makes a
 * snapshot pasted into a document look like the page rather than like a
 * screenshot of it. It is deliberately NOT the reader's current zoom: a person
 * reading at 50% would get a coarse image for a reason nothing on screen
 * explains, and the kernel refuses a scale below 1 outright.
 *
 * A setting is the obvious next step and is not taken here, because a scale
 * nobody has asked to change is a control that costs a row of the settings
 * panel to do nothing. **Trigger: the first request for a resolution choice.**
 */
const SNAPSHOT_SCALE = 2;

export interface SnapshotDeps {
  /**
   * Where the region goes — the page and the rectangle, in PDF user space.
   *
   * A dependency rather than a command for the reason in the header: main runs
   * a save dialog and writes a file, and neither is a document mutation the
   * command log could hold.
   */
  readonly onSnapshot: (page: number, rect: AnnotationRect, scale: number) => void;
}

/** The region a drag describes, in the overlay's own pixels. */
function regionOf(gesture: Gesture): ToolPreview | undefined {
  const from = startOf(gesture);
  const to = endOf(gesture);
  if (
    Math.abs(to.x - from.x) < MINIMUM_REGION ||
    Math.abs(to.y - from.y) < MINIMUM_REGION
  ) {
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

export function snapshotTool(deps: SnapshotDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      // BOTH AXES, unlike a line's single-axis minimum: a region flat in one
      // direction has no area, and the kernel refuses it — so refusing here is
      // what keeps a slip from opening a save dialog for a snapshot that will
      // then fail.
      if (regionOf(gesture) === undefined) return undefined;
      const from = toPdf(startOf(gesture), transform);
      const to = toPdf(endOf(gesture), transform);
      // UNORDERED, deliberately, because the kernel normalises: a drag runs
      // whichever way the pointer went, and ordering here would be a second
      // place that rule is stated.
      deps.onSnapshot(page, { x0: from.x, y0: from.y, x1: to.x, y1: to.y }, SNAPSHOT_SCALE);
      // NOTHING FOR THE COMMAND BUS. The document is unchanged, and answering a
      // command here would put an entry in the undo log for an operation undo
      // cannot reverse — a file has already been written.
      return undefined;
    },
    preview: regionOf,
  };

  return { id: SNAPSHOT_TOOL_ID, controller };
}

/** Exported so the cases assert against the tool's own numbers. */
export { MINIMUM_REGION, SNAPSHOT_SCALE };
