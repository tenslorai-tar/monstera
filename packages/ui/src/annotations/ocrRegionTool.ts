import type { OcrLanguage, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';

/**
 * The OCR region tool — drag a rectangle, get its text.
 *
 * ## IT ANSWERS A COMMAND, which is what makes it a registration
 *
 * `snapshotTool` drags the same rectangle and answers `undefined`, because a
 * snapshot writes a file rather than changing the document. This one **is** a
 * mutation: the recognised words become an invisible text layer over that part of
 * the page, so `commit` returns the command and the tool registry dispatches it
 * through the same bus every other tool's command goes through. Nothing new is
 * wired — ADR-0042's platform already carries a drag, and `ocrPage` already takes
 * an optional region.
 *
 * ## The rectangle is converted by the ONE adapter, and then once more
 *
 * `toPdf` here, which is what every tool in this directory uses, so a region and a
 * rectangle annotation drawn over the same place carry the same numbers. The second
 * conversion — PDF user space into the raster Tesseract reads — belongs to
 * `ocrRecognise.ts`, which holds both frames and already converts the boxes coming
 * back. Two conversions, each in the one module that owns its pair (B3a).
 *
 * ## The language comes from the SETTING, not from a dialog
 *
 * A dialog after every drag turns a gesture into a form, which is the argument
 * `IMAGE_PAGES_SETTING` already made for stamping. The OCR dialog and this tool read
 * the same stored value, so *what language is this document in* has one answer per
 * reader rather than one per surface.
 */

export const OCR_REGION_TOOL_ID = 'tools.ocr-region';

/**
 * How far a drag must run before it is a region.
 *
 * `snapshotTool`'s four pixels and its reason, with one more of its own:
 * recognition costs seconds, so a four-pixel slip would spend them on a rectangle
 * containing nothing and then write an empty layer.
 */
const MINIMUM_REGION = 4;

export interface OcrRegionDeps {
  /**
   * Which language to read in — the stored `OCR_LANGUAGE_SETTING`.
   *
   * **A function rather than a value, so that holding a stale language is
   * unrepresentable on this side**: the registry outlives a gesture, and a tool
   * constructed with the value would read whatever was stored when it was built.
   *
   * That is half of it, and the other half is the caller's. A thunk closing over a
   * render value is stale exactly as long as the memo holding it does not re-run, so
   * `App.tsx` lists the setting in that memo's dependencies — found by
   * `react-hooks/exhaustive-deps` while this file's own case was green, which is the
   * shape where a tested tool sits beside an untested call site.
   */
  readonly language: () => OcrLanguage;
}

/** The region a drag describes, in the overlay's own pixels. */
function regionOf(gesture: Gesture): ToolPreview | undefined {
  const from = startOf(gesture);
  const to = endOf(gesture);
  if (Math.abs(to.x - from.x) < MINIMUM_REGION || Math.abs(to.y - from.y) < MINIMUM_REGION) {
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

export function ocrRegionTool(deps: OcrRegionDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      // BOTH AXES, as the snapshot's minimum is: a region flat in one direction has
      // no area, and the kernel refuses it — so refusing here is what keeps a slip
      // from spending four seconds on nothing.
      if (regionOf(gesture) === undefined) return undefined;
      const from = toPdf(startOf(gesture), transform);
      const to = toPdf(endOf(gesture), transform);
      return {
        kind: 'ocrPage',
        page,
        language: deps.language(),
        // UNORDERED, deliberately, because the kernel normalises: a drag runs
        // whichever way the pointer went, and ordering here would be a second place
        // that rule is stated.
        region: { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
      };
    },
    preview: regionOf,
  };

  return { id: OCR_REGION_TOOL_ID, controller };
}

/** Exported so the cases assert against the tool's own number. */
export { MINIMUM_REGION };
