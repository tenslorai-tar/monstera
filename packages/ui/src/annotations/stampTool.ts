import type { AnnotationColour, AnnotationRect, BuiltInStamp, DispatchableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';

import { STAMP_DIALOG_ID } from '../dialogs/stamp.js';
import { STAMP_RESULT, type StampPicture } from '../dialogs/stampResult.js';
import { HINT_STAMP } from '../messages/en.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/** The registry id, shared with the command that selects this tool. */
export const STAMP_TOOL_ID = 'annotate.stamp';

/** The kept pictures the chooser shows, and how to let go of their `blob:` addresses once it has closed. */
export interface StampPictures {
  readonly pictures: readonly StampPicture[];
  readonly release: () => void;
}

/** What the stamp tool needs beyond asking: the person's stamp library, and where a kept picture is placed. */
export interface StampDeps {
  /** The kept stamp pictures, read afresh each time the chooser opens. */
  readonly stampPictures: () => Promise<StampPictures>;
  /** Keeps a picture the person picks. Settles once any problem has been shown, so the chooser opens after it. */
  readonly addStampPicture: () => Promise<void>;
  /** Removes a kept picture. */
  readonly removeStampPicture: (id: string) => Promise<void>;
  /** Places a kept picture in the box — main reads the file and mints the command, as it does for a picked image. */
  readonly onPlaceStampPicture: (page: number, rect: AnnotationRect, picture: string) => void;
}

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
 * The text box's shape (`textTools.ts`): the rectangle is built from the transform at pointer-up, BEFORE the chooser
 * opens, so a zoom while the person chooses does not move it; a dismissed chooser or an answer of the wrong shape sends
 * nothing. A built-in stamp is a command built here; a kept picture is main's to place, like any picture, so it is
 * handed on and nothing is returned for the bus.
 *
 * ## Adding or removing a picture ASKS AGAIN
 *
 * The chooser's props are fixed while it is open, so a change to the library is its answer: the tool makes the change,
 * reads the library afresh and opens the chooser again, for as long as the person keeps changing it. Each round lets
 * go of the previous round's `blob:` addresses, so a long session of adding holds one set of pictures at a time.
 */
// ASK AND THE STYLE ONLY: the chooser is a dialog the ADR keeps (ADR-0154 *Keeps*), and a stamp has no words to type.
export function stampTool(deps: Pick<TextToolDeps, 'ask' | 'style'> & StampDeps): UiTool {
  const controller: ToolController = {
    ...pointerPath,
    commit: async (gesture: Gesture, page: number, transform: PageTransform): Promise<DispatchableCommand | undefined> => {
      if (drawn(gesture) === undefined) return undefined;
      const rect = draggedRect(startOf(gesture), endOf(gesture), transform);
      for (;;) {
        const { pictures, release } = await deps.stampPictures();
        let raw: unknown;
        try {
          raw = await deps.ask(STAMP_DIALOG_ID, { pictures });
        } finally {
          release();
        }
        const answered = STAMP_RESULT.safeParse(raw);
        if (!answered.success) return undefined;
        const answer = answered.data;
        if ('stamp' in answer) {
          return {
            kind: 'addAnnotation',
            page,
            annotation: {
              type: 'stamp',
              stamp: answer.stamp,
              rect,
              colour: deps.style.colour(OWN_COLOUR[answer.stamp]),
              opacity: deps.style.opacity,
            },
          };
        }
        if ('picture' in answer) {
          deps.onPlaceStampPicture(page, rect, answer.picture);
          return undefined;
        }
        if (answer.library === 'add') await deps.addStampPicture();
        else await deps.removeStampPicture(answer.id);
      }
    },
    preview: drawn,
  };
  return { id: STAMP_TOOL_ID, controller, hint: HINT_STAMP };
}
