import type { OcrEngine, OcrLanguage, RenderableCommand, TrocrSize } from '@monstera/contract';
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
 * The same gesture, asking the handwriting engine — **a second REGISTRATION,
 * not a second command and not a second channel**.
 *
 * [ADR-0052](../../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
 * Decision 1 rejects putting *which recogniser* in as many places as there are
 * callers. This does not: both ids build the same `ocrPage` command through the
 * same factory, differing in one field of one request, and everything after the
 * dispatch is unchanged — one command, one channel, one answer shape.
 *
 * What it buys is the only thing a reader actually needs: **a way to say which**.
 * The choice is per rectangle — this box is handwriting, that one is print — so
 * it cannot be a setting, and a dialog after every drag is the form the gesture
 * exists to avoid. A tool in the registry is how this build offers a gesture,
 * and the ribbon, the palette and the shortcut map are projections of it.
 */
export const HANDWRITING_REGION_TOOL_ID = 'tools.handwriting-region';

/**
 * The third registration, and the one whose choice a reader must make knowingly.
 *
 * `azure` sends the region's raster **to a service over the internet**. That is
 * not an implementation detail a surface should hide behind a word like
 * *better*: it is the fact a reader is choosing, which is why the engine is
 * named in the title and why this is a separate control rather than a quality
 * setting on the one above.
 *
 * On a region for two reasons, and the second is not TrOCR's. The first is the
 * same — one gesture, one answer. The second is that a page-scoped control would
 * upload a whole page where the reader asked about one line.
 */
export const CLOUD_REGION_TOOL_ID = 'tools.cloud-region';

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
  /**
   * Which TrOCR the handwriting registration loads — `BUILD-PROMPT.md`:619.
   *
   * A thunk for `language`'s reason and with the same division of
   * responsibility: it makes a stale capture unrepresentable **on this side**,
   * and the caller owes the dependency list that makes it re-read.
   *
   * A SETTING rather than a per-drag choice, unlike the engine: the size decides
   * what this machine downloads and keeps, which is a property of the
   * installation rather than of the rectangle. It is carried on both
   * registrations' commands and read by one, exactly as the language is.
   */
  readonly trocrSize: () => TrocrSize;
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

/**
 * One factory, two registrations, and the engine is a PARAMETER of the factory
 * rather than a field of the deps.
 *
 * Making it an argument here is what keeps the two ids from being two tools: a
 * dep would be a value the caller could get wrong per registration, where a
 * parameter means each id is the same controller with one literal changed, and
 * `ocrRegionTool` and `handwritingRegionTool` below are the only two callers.
 */
function regionTool(id: string, engine: OcrEngine, deps: OcrRegionDeps): UiTool {
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
        // THE REGISTRATION'S OWN ENGINE, a literal per id. The reader chose it
        // by choosing the tool, so there is nothing here to read late.
        engine,
        // READ AT COMMIT, like the language and for the same reason: a reader who
        // changes the setting between picking the tool and letting go of the
        // pointer means the second value.
        trocrSize: deps.trocrSize(),
        // UNORDERED, deliberately, because the kernel normalises: a drag runs
        // whichever way the pointer went, and ordering here would be a second place
        // that rule is stated.
        region: { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
      };
    },
    preview: regionOf,
  };

  return { id, controller };
}

/** Drag a box; Tesseract reads it, in the language the setting names. */
export function ocrRegionTool(deps: OcrRegionDeps): UiTool {
  return regionTool(OCR_REGION_TOOL_ID, 'tesseract', deps);
}

/** Drag a box over one handwritten LINE; TrOCR reads it (ADR-0052 §4). */
export function handwritingRegionTool(deps: OcrRegionDeps): UiTool {
  return regionTool(HANDWRITING_REGION_TOOL_ID, 'handwriting', deps);
}

/** Drag a box; its raster is SENT to Azure Document Intelligence and read there. */
export function cloudRegionTool(deps: OcrRegionDeps): UiTool {
  return regionTool(CLOUD_REGION_TOOL_ID, 'azure', deps);
}

/** The Claude tool's id. */
export const CLAUDE_REGION_TOOL_ID = 'annotate.claude-region';

/**
 * Drag a box; its raster is SENT to Anthropic's Claude and read there.
 *
 * The same registration with a different engine — the network engines share one
 * shape end to end (ADR-0057), so a second service is a member rather than a
 * surface.
 */
export function claudeRegionTool(deps: OcrRegionDeps): UiTool {
  return regionTool(CLAUDE_REGION_TOOL_ID, 'claude', deps);
}

/** Exported so the cases assert against the tool's own number. */
export { MINIMUM_REGION };
