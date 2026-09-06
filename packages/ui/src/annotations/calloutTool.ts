import type { AnnotationColour, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import { CALLOUT_DIALOG_ID } from '../dialogs/callout.js';
import { ANNOTATION_TEXT_RESULT } from '../dialogs/annotationTextResult.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/**
 * The callout — point at something, then draw the note that talks about it.
 *
 * ## The gesture ADR-0042 was built for, arriving one row later than expected
 *
 * [ADR-0042](../../../../docs/DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)
 * says the callout question *dissolves* under a multi-press gesture: one drag
 * can define a box or a pointer and not both, and a gesture that survives a
 * release can define each in turn. This is that, spent.
 *
 * **Press once where it points; press again and drag the box.** The first
 * release does not finish the gesture — `complete` answers `false` while only
 * one press has happened — so the second press extends the same gesture rather
 * than starting a new one, and the drag from it is an ordinary rectangle.
 *
 * ## Two presses and not three, with the elbow OWED
 *
 * A three-point leader with a knee is what a person draws in every application
 * this one replaces, and it is not here. The reason is that the tool would have
 * to tell a knee from the box's first corner, and both are *a press after the
 * first* — the finish signal is a double press and cannot be spent on the
 * difference. That is a gesture question rather than a payload one; the kernel
 * stores whatever `/CL` it is given.
 *
 * ## MuPDF decides where the line MEETS the box
 *
 * The command carries the point and the rectangle, never the second end of the
 * leader. `setCalloutPoint` computes it from the box, which is geometry the
 * engine owns and this build would otherwise re-derive from a corner it chose
 * (B3a).
 */

/** A reviewing hand's red, matching the caret and the strike. */
const CALLOUT_COLOUR: AnnotationColour = [0.85, 0.15, 0.15];


/** The id, shared with the command that selects this tool. */
export const CALLOUT_TOOL_ID = 'annotate.callout';

/**
 * How far the second press must drag before the box is one.
 *
 * `shapeTools.ts`' number and its rule: a box with no extent is a note nobody
 * can read, and refusing here costs no round trip.
 */
const MINIMUM_DRAG = 4;

export function calloutTool(deps: TextToolDeps): UiTool {
  /** The box the second press has dragged out, or `undefined` before it has. */
  const boxOf = (
    gesture: Gesture,
  ): { readonly from: (typeof gesture.presses)[number]; readonly to: (typeof gesture.points)[number] } | undefined => {
    const second = gesture.presses[1];
    if (second === undefined) return undefined;
    const to = endOf(gesture);
    if (Math.abs(to.x - second.x) < MINIMUM_DRAG || Math.abs(to.y - second.y) < MINIMUM_DRAG) {
      return undefined;
    }
    return { from: second, to };
  };

  const controller: ToolController = {
    ...pointerPath,
    // THE FIRST RELEASE DOES NOT END IT. Answering `true` here is what every
    // other drag tool does and is exactly what would make this impossible: the
    // gesture would commit after the point was pressed and the box would never
    // be drawn.
    complete: (gesture: Gesture): boolean => gesture.presses.length >= 2,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      const box = boxOf(gesture);
      if (box === undefined) return undefined;
      // BOTH READ BEFORE THE ASK, `textTools.ts`' rule: the transform is the one
      // the overlay measured at the release, and converting after the person has
      // typed would place the callout using whatever zoom the page has by then.
      const at = toPdf(startOf(gesture), transform);
      const rect = draggedRect(box.from, box.to, transform);

      const answered = ANNOTATION_TEXT_RESULT.safeParse(await deps.ask(CALLOUT_DIALOG_ID, {}));
      if (!answered.success) return undefined;

      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type: 'callout',
          at: { x: at.x, y: at.y },
          rect,
          text: answered.data.text,
          colour: deps.style.colour(CALLOUT_COLOUR),
          opacity: deps.style.opacity,
          fontSize: deps.style.fontSize,
        },
      };
    },
    preview: (gesture: Gesture): ToolPreview | undefined => {
      const box = boxOf(gesture);
      // BEFORE THE SECOND PRESS, A LINE FROM THE POINT TO THE POINTER — which
      // is the leader being aimed. After it, the box, because that is what is
      // being sized and the leader is settled. One shape at a time: the preview
      // union has no member for a line and a rectangle together, and adding one
      // for this tool would put a tool's composition in the overlay's switch.
      const from = startOf(gesture);
      if (box === undefined) {
        const to = endOf(gesture);
        return { shape: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y };
      }
      return {
        shape: 'rect',
        x: Math.min(box.from.x, box.to.x),
        y: Math.min(box.from.y, box.to.y),
        width: Math.abs(box.to.x - box.from.x),
        height: Math.abs(box.to.y - box.from.y),
      };
    },
  };

  return { id: CALLOUT_TOOL_ID, controller };
}
