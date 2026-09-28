import type { AnnotationColour, BuiltInStamp, DispatchableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';

import { STAMP_DIALOG_ID } from '../dialogs/stamp.js';
import { STAMP_RESULT } from '../dialogs/stampResult.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/** The registry id, shared with the command that selects this tool. */
export const STAMP_TOOL_ID = 'annotate.stamp';

/**
 * Each built-in stamp's own colour, used when a person has chosen none (`AnnotationStyle.colour`'s rule): a stamp that
 * approves reads green, one that refuses or cancels reads red, and one that only describes reads blue — the colours a
 * rubber stamp's ink conventionally carries, so the word and its colour never argue. Chosen, not measured.
 */
const OWN_COLOUR: Readonly<Record<BuiltInStamp, AnnotationColour>> = {
  approved: [0.1, 0.5, 0.2],
  final: [0.1, 0.5, 0.2],
  'not-approved': [0.8, 0.1, 0.1],
  void: [0.8, 0.1, 0.1],
  draft: [0.1, 0.3, 0.7],
  confidential: [0.1, 0.3, 0.7],
  'for-review': [0.1, 0.3, 0.7],
  copy: [0.1, 0.3, 0.7],
};

/** The smallest box worth a stamp, in CSS pixels — the text box's, for its reason: a modal opens on commit. */
const MINIMUM_BOX = 8;

/** The box a drag describes, in the overlay's own pixels, or nothing below the threshold. */
function drawn(gesture: Gesture): ToolPreview | undefined {
  const from = startOf(gesture);
  const to = endOf(gesture);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < MINIMUM_BOX || height < MINIMUM_BOX) return undefined;
  return { shape: 'rect', x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width, height };
}

/**
 * The stamp tool — drag a box, choose a stamp from the library.
 *
 * The text box's shape exactly (`textTools.ts`): the rectangle is built from the transform at pointer-up, BEFORE the
 * dialog opens, so a zoom while the person chooses does not move it; a dismissed chooser or an answer of the wrong
 * shape sends nothing. It takes the text tools' dependencies — `ask` and the style — because it needs exactly those.
 */
export function stampTool(deps: TextToolDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (gesture: Gesture, page: number, transform: PageTransform): Promise<DispatchableCommand | undefined> => {
      if (drawn(gesture) === undefined) return undefined;
      const rect = draggedRect(startOf(gesture), endOf(gesture), transform);
      const answered = STAMP_RESULT.safeParse(await deps.ask(STAMP_DIALOG_ID, {}));
      if (!answered.success) return undefined;
      const { stamp } = answered.data;
      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'stamp',
          stamp,
          rect,
          colour: deps.style.colour(OWN_COLOUR[stamp]),
          opacity: deps.style.opacity,
        },
      };
    },
    preview: drawn,
  };
  return { id: STAMP_TOOL_ID, controller };
}
