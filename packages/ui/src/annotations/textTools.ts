import type { AnnotationColour, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';

import { ANNOTATION_TEXT_DIALOG_ID } from '../dialogs/annotationText.js';
import { ANNOTATION_TEXT_RESULT } from '../dialogs/annotationTextResult.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';

/**
 * The text tools — the first that cannot answer from the gesture alone.
 *
 * ## What separates this file from `shapeTools.ts`
 *
 * Not the geometry: a text box is dragged exactly as a rectangle is, and this
 * file's preview is the box one. What separates them is that a shape is
 * complete when the pointer comes up and a text box is not — the words are the
 * annotation, and they come from a person.
 *
 * So these tools take their dependencies at construction, the way
 * `deletePagesCommand(deps)` does, and `commit` answers a promise. Both of
 * those are the platform's, not this file's: `ToolController.commit` may answer
 * now or later, and the six shape tools kept answering now.
 *
 * ## Why the dependency is `ask` and not a dialog id
 *
 * A tool that returned *"open this dialog and send that command"* would put the
 * pairing in the overlay, which would then need a table of tool-to-dialog — the
 * second wiring place the registries exist to forbid. Holding `ask` means the
 * tool opens its own dialog and builds its own command, which is ADR-0038's
 * shape with a tool where it has always had a command.
 */

/**
 * What a text box is written in until the style controls exist.
 *
 * **Near-black rather than the shapes' red**, and the difference is not
 * decoration: a shape's stroke is a mark ON the page and reads as annotation,
 * where a text box is words a person is adding TO it and reads as content. A
 * red one looks like a correction whatever it says.
 */
const TEXT_COLOUR: AnnotationColour = [0.1, 0.1, 0.1];

/**
 * Point size, until the style controls own it.
 *
 * Twelve is the size a document's own body text usually is, so a box added to
 * one sits with it rather than beside it.
 */
const FONT_SIZE = 12;

/**
 * The smallest box worth treating as a text box, in CSS pixels.
 *
 * `shapeTools`' threshold and its argument, with one difference that matters:
 * this tool is about to open a MODAL. A stray click that fell through would put
 * a dialog in front of a person who did not ask for one, which is worse than
 * the stray rectangle the shape tools discard.
 */
const MINIMUM_BOX = 8;

/** What the drag describes, in the overlay's own pixels. */
function box(gesture: Gesture): { x: number; y: number; width: number; height: number } {
  const from = startOf(gesture);
  const to = endOf(gesture);
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** What a tool needs from the shell to be able to ask. */
export interface TextToolDeps {
  /**
   * Opens a dialog and settles with its answer, or `undefined` if dismissed.
   *
   * The same `ask` the document commands take, typed the same way: `unknown`
   * out, because the registry cannot know which dialog a caller names, and the
   * caller narrows with the dialog's own result schema.
   */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}

/** The registry id, shared with the command that selects the tool. */
export const TEXT_BOX_TOOL_ID = 'annotate.text-box';

/**
 * A box, then the words that go in it.
 *
 * @param deps what the tool needs to ask. Captured here rather than passed to
 *   `commit`, so the six tools that need nothing keep a three-parameter commit
 */
export function textBoxTool(deps: TextToolDeps): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const measured = box(gesture);
    // BOTH AXES, `shapeTools`' rule: a drag of 40 by 1 is a sliver nobody meant
    // to draw, and a distance test accepts it.
    if (measured.width < MINIMUM_BOX || measured.height < MINIMUM_BOX) return undefined;
    return { shape: 'rect', ...measured };
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      // THE SAME THRESHOLD AS THE PREVIEW, read from it rather than restated —
      // and here it also decides whether a modal opens at all, so the two
      // coming apart would be a dialog appearing for a drag that showed no box.
      if (drawn(gesture) === undefined) return undefined;

      // THE RECTANGLE IS BUILT BEFORE THE ASK, from the transform the overlay
      // read at pointer-up. Building it after would convert a gesture using
      // whatever zoom the page is at when the person finishes typing.
      const rect = draggedRect(startOf(gesture), endOf(gesture), transform);

      const answered = ANNOTATION_TEXT_RESULT.safeParse(
        await deps.ask(ANNOTATION_TEXT_DIALOG_ID, {}),
      );
      // A DISMISSED DIALOG IS `undefined` AND SO IS A REFUSED ANSWER, which is
      // the same outcome a drag too small to see already produces. The gate is
      // the absence of a value rather than a flag: there is nothing to build a
      // command from, so nothing is sent.
      //
      // Parsed rather than cast. `ask` answers `unknown`, and the dialog host
      // has already validated against this schema — so a failure here means the
      // id resolved to a dialog answering some other shape, which is a
      // registration defect and not a person's doing. Refusing quietly is right
      // for the same reason a dismissal is: the page is unchanged either way.
      if (!answered.success) return undefined;

      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'text-box',
          rect,
          text: answered.data.text,
          colour: TEXT_COLOUR,
          fontSize: FONT_SIZE,
        },
      };
    },
    preview: drawn,
  };

  return { id: TEXT_BOX_TOOL_ID, controller };
}
