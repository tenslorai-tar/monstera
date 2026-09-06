import type { RenderableCommand } from '@monstera/contract';
import type { DocVersion, PageTransform } from '@monstera/shared';
import { pdfPoint, toViewport } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { pointerPath, startOf } from '../registries/tools.js';

/**
 * The eraser — the first tool whose gesture names an annotation that already
 * exists.
 *
 * ## It is a READ, and that is the whole of what was new
 *
 * Every tool before this one built its command out of the gesture alone: where
 * the pointer went is the entire intent, and nothing about the document is
 * needed to express it. This one cannot. *Delete the annotation under here* is
 * a question about what is on the page, and the answer lives in the kernel — so
 * the tool holds a way to ask, exactly as the sticky note holds `ask`
 * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)'s
 * shape on a different noun). The overlay is untouched: `commit` may answer
 * later, and it already does for the two dialog-bearing tools.
 *
 * ## The handle comes from the answer, never from the shell
 *
 * `{ page, index, version }` is
 * [ADR-0041](../../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)'s
 * handle, and all three numbers come out of the same read. Taking the version
 * from the application's current state instead would produce a value that can
 * never disagree with itself — a staleness check that cannot fire, wearing the
 * shape of one that can. The read happens at pointer-up, so a document that
 * moves between the read and the apply is refused by the bus, which is the
 * mechanism rather than a race this file has to win.
 *
 * ## Hit-testing is by BOUNDING BOX, said plainly
 *
 * `rect` is the box an annotation occupies, not its shape: a diagonal line's
 * box is the square its ends span, and a click in the empty corner of that
 * square erases the line. Refining it would mean re-deriving each subtype's
 * geometry in the renderer from a rectangle that does not carry it — a second
 * opinion about what the annotation IS, held by the half of the application
 * furthest from the object (B3a). What the coarseness costs is stated here
 * rather than hidden: the eraser reaches slightly further than it looks.
 *
 * ## The TOPMOST one, which is the last in the walk
 *
 * Annotations are painted in `/Annots` order, so the last one containing the
 * point is the one the person can see and therefore the one they aimed at.
 * Erasing the first would delete the mark underneath the mark they clicked —
 * correct by index, wrong by every other measure, and invisible in a document
 * with no overlaps, which is every early fixture.
 */

/** The id, shared with the command that selects this tool. */
export const ERASER_TOOL_ID = 'annotate.eraser';

/**
 * One annotation, as this tool needs to see it.
 *
 * Structural rather than the channel's own type, and deliberately the three
 * fields it reads: a tool that named the whole row would be re-stating a
 * payload it does not use, and a case would have to build one.
 */
export interface ErasableAnnotation {
  readonly page: number;
  readonly index: number;
  /** In PDF user space, or `null` for a page that displays no region. */
  readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
}

/** What the walk answered, and the version it answered at. */
export interface AnnotationSnapshot {
  readonly version: DocVersion;
  readonly annotations: readonly ErasableAnnotation[];
}

export interface EraserDeps {
  /**
   * Reads every annotation in the open document.
   *
   * `undefined` when there is no document, or the read was refused — both of
   * which mean *there is nothing to name*, which is the same outcome a click on
   * blank paper already has. The tool does not distinguish them because it
   * would have nothing different to do; the refusal is reported where every
   * other refusal is.
   */
  readonly annotations: () => Promise<AnnotationSnapshot | undefined>;
}

/** Whether a point in the overlay's own pixels is inside an annotation's box. */
function covers(
  annotation: ErasableAnnotation,
  at: { readonly x: number; readonly y: number },
  transform: PageTransform,
): boolean {
  const { rect } = annotation;
  if (rect === null) return false;
  // THROUGH THE ONE CONVERTER, both corners, and normalised after — a rotated
  // page reverses an axis, so the corner that was smallest in PDF space is not
  // the corner that is smallest on screen. `pageAnnotations.ts` does the same
  // thing in the other direction and says why.
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return (
    at.x >= Math.min(a.x, b.x) &&
    at.x <= Math.max(a.x, b.x) &&
    at.y >= Math.min(a.y, b.y) &&
    at.y <= Math.max(a.y, b.y)
  );
}

export function eraserTool(deps: EraserDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      // WHERE THE CLICK LANDED, not where the pointer was released. The point
      // tools' rule and for their reason: a hand that slid on the way up still
      // meant the mark it came down on.
      const at = startOf(gesture);

      const snapshot = await deps.annotations();
      if (snapshot === undefined) return undefined;

      // THE LAST MATCH, which is the topmost. `findLast` rather than a reversed
      // copy so the index in the handle is the index in the walk — reversing
      // the array and taking `findIndex` would give a position in a list nobody
      // else has.
      const hit = snapshot.annotations.findLast(
        (annotation) => annotation.page === page && covers(annotation, at, transform),
      );
      // NOTHING UNDER THE POINTER IS AN ORDINARY OUTCOME, and `undefined` is
      // what the platform already means by it. A click on blank paper erases
      // nothing and says nothing, which is what an eraser does.
      if (hit === undefined) return undefined;

      return {
        kind: 'removeAnnotation',
        page: hit.page,
        index: hit.index,
        version: snapshot.version,
      };
    },
    // NOTHING IS PREVIEWED. What a preview would draw is the box about to be
    // erased, and that needs the read this tool only performs at pointer-up —
    // a preview would mean a channel round trip per pointer move. Highlighting
    // what is under the cursor is the SELECT tool's job, which is the row that
    // holds the list rather than asking for it once.
    preview: (): ToolPreview | undefined => undefined,
  };

  return { id: ERASER_TOOL_ID, controller };
}
