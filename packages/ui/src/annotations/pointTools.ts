import type { AnnotationColour, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import { ANNOTATION_NOTE_DIALOG_ID } from '../dialogs/annotationNote.js';
import { ANNOTATION_TEXT_RESULT } from '../dialogs/annotationTextResult.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { pointerPath, startOf } from '../registries/tools.js';
import type { TextToolDeps } from './textTools.js';

/**
 * The point tools — the first whose gesture is a CLICK rather than a drag.
 *
 * One of them today. The file is plural because the caret is the next row and
 * needs nothing this does not already hold, which is the click gesture's whole
 * claim; a module named for one tool would have to be renamed to make it.
 *
 * ## The click gesture needed nothing new, and that is the finding
 *
 * `Gesture` already records where the pointer went down, so a click is a
 * gesture read at {@link startOf} and nowhere else. The platform, the overlay
 * and the lifecycle are untouched: `begin` still starts a path, `update` still
 * extends it, and `commit` ignores everything after the first point.
 *
 * That was worth checking rather than assuming, because the multi-click tools
 * behind these — polygon, polyline, cloud — genuinely do need a platform change
 * (the overlay has no way for a controller to say *not yet*), and it would have
 * been easy to reach for it here. A single click needs none of it. **Ask what
 * the gesture cannot express before widening the seam that carries it** — the
 * answer here was *nothing*.
 *
 * ## A drag is not refused, and there is no threshold at all
 *
 * Every tool in `shapeTools.ts` and `textTools.ts` has a minimum, because for
 * them a click that did not move is a stray click producing an invisible
 * annotation. These are the other way round: the click IS the intent, and a
 * hand that slid twelve pixels on the way up still meant the point it started
 * at. So the gesture's tail is discarded rather than tested, and a long drag
 * places the annotation where the drag began — which is predictable, and is
 * what the person watching their own pointer will expect.
 *
 * There is nothing to refuse, so nothing here returns `undefined` for geometry.
 * The sticky note still answers `undefined` for a dismissed dialog, which is
 * the platform's other reason and not this file's.
 *
 * ## Nothing is previewed, deliberately
 *
 * A drag tool previews because its shape is not decided until the pointer comes
 * up. A click's is decided at pointer-down, and the annotation's SIZE is not
 * this build's to draw: MuPDF normalises both of these to fixed boxes — 20 by
 * 20 for a note, 20 by 14 for a caret — so an outline drawn here would be the
 * renderer stating a number the kernel owns, in the file furthest from where it
 * is decided. Feedback comes from the page re-rendering with the annotation on
 * it, which is the real thing rather than a guess at it.
 */

/**
 * What a note's icon is coloured, until the style controls own it.
 *
 * The yellow every viewer draws a comment marker in, which is what makes a note
 * recognisable as one before it is opened. `/C` on a `/Text` colours the icon
 * rather than a stroke, so this is the mark's own colour and not an outline.
 */
const NOTE_COLOUR: AnnotationColour = [1, 0.8, 0.2];

/** The id, shared with the command that selects this tool. */
export const STICKY_NOTE_TOOL_ID = 'annotate.sticky-note';

/**
 * A click tool's preview: none.
 *
 * Named rather than inlined because it is a decision this file makes on behalf
 * of every click tool, and the next one arrives with the caret.
 */
const noPreview = (): ToolPreview | undefined => undefined;

/** Where the click landed, in PDF user space. */
function clickedAt(
  gesture: Gesture,
  transform: PageTransform,
): { readonly x: number; readonly y: number } {
  // THE FIRST POINT, not the last. `endOf` is where the pointer was released,
  // which for a click that slid is not where the person aimed.
  const placed = toPdf(startOf(gesture), transform);
  return { x: placed.x, y: placed.y };
}

/**
 * The sticky note — a click, then the comment it holds.
 *
 * @param deps what the tool needs to ask. `textTools.ts`' `TextToolDeps`,
 *   imported rather than declared again: *a tool that must open a dialog holds
 *   `ask`* is the platform's shape, and a second interface with the same one
 *   member would be a second statement of it
 */
export function stickyNoteTool(deps: TextToolDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      // THE POINT IS READ BEFORE THE ASK, `textTools.ts`' rule: the transform
      // is the one the overlay measured at pointer-up, and converting after the
      // person has typed would place the note using whatever zoom the page has
      // reached by then.
      const at = clickedAt(gesture, transform);

      const answered = ANNOTATION_TEXT_RESULT.safeParse(
        await deps.ask(ANNOTATION_NOTE_DIALOG_ID, {}),
      );
      // A DISMISSED DIALOG AND A REFUSED ANSWER ARE BOTH `undefined`, which is
      // the platform's gate: there is nothing to build a command from, so
      // nothing is sent. A parse failure here means the id resolved to a dialog
      // answering another shape — a registration defect rather than a person's
      // doing, and refused quietly for the same reason, since the page is
      // unchanged either way.
      if (!answered.success) return undefined;

      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'sticky-note',
          at,
          text: answered.data.text,
          colour: NOTE_COLOUR,
        },
      };
    },
    preview: noPreview,
  };

  return { id: STICKY_NOTE_TOOL_ID, controller };
}

/** Every point tool, in the order their controls appear. */
export function pointTools(deps: TextToolDeps): readonly UiTool[] {
  return [stickyNoteTool(deps)];
}
