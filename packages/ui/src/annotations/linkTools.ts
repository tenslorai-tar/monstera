import type { LinkTarget, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';

import {
  LINK_ADDRESS_DIALOG_ID,
  LINK_PAGE_DIALOG_ID,
  LINK_TEXT_RESULT,
} from '../dialogs/annotationLink.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/**
 * The two link tools — draw a region, then say where it goes.
 *
 * ## A LINK IS NOT AN ANNOTATION, and the tools do not pretend otherwise
 *
 * Measured 2026-09-06: MuPDF's `createLink` and `createAnnotation('Link')`
 * write the same `/Subtype` and produce different objects, and only the first
 * is a link a reader can follow. So the command is `addLink` rather than a
 * draft, and the consequences reach the surface too — a link is invisible to
 * the annotations panel, the eraser and the select tool, because none of them
 * can see anything the annotation walk does not return. `LinksPanel` is what
 * answers for links.
 *
 * ## Two tools rather than one with a mode
 *
 * A web address and a page number are two questions, so they are two dialogs
 * (`annotationLink.ts` has the argument) and therefore two tools: a tool holds
 * the dialog it opens, exactly as the sticky note does. What they share is this
 * file's one factory, which is the drag, the threshold and the preview.
 *
 * ## The rectangle is drawn first and the destination asked after
 *
 * `textTools.ts`' order and its rule: the transform is read at pointer-up,
 * before any await, so the link covers the region that was drawn rather than
 * whatever the page has been scrolled or zoomed to by the time the person
 * finishes typing.
 */

export const LINK_ADDRESS_TOOL_ID = 'annotate.link-address';
export const LINK_PAGE_TOOL_ID = 'annotate.link-page';

/**
 * How far the drag must go before it is a region.
 *
 * `shapeTools.ts`' number, and here the refusal is sharper than a shape's: a
 * link with no area is a region a reader cannot click, so a stray press must
 * not open a dialog asking where nothing should go.
 */
const MINIMUM_DRAG = 4;

function linkTool(
  id: string,
  dialog: string,
  deps: TextToolDeps,
  target: (text: string) => LinkTarget | undefined,
): UiTool {
  const drawn = (gesture: Gesture): boolean => {
    const from = startOf(gesture);
    const to = endOf(gesture);
    return Math.abs(to.x - from.x) >= MINIMUM_DRAG && Math.abs(to.y - from.y) >= MINIMUM_DRAG;
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      if (!drawn(gesture)) return undefined;
      // READ BEFORE THE ASK. The rectangle belongs to the drag that just
      // happened; converting after the dialog resolves would use whatever
      // transform the page has by then.
      const rect = draggedRect(startOf(gesture), endOf(gesture), transform);

      const answered = LINK_TEXT_RESULT.safeParse(await deps.ask(dialog, {}));
      if (!answered.success) return undefined;
      const where = target(answered.data.text);
      // A VALUE THE DIALOG LET THROUGH AND THIS CANNOT USE is the same outcome
      // as a dismissal — nothing to build a command from. The dialog's own rule
      // is what stops a person reaching this, so arriving here means the two
      // disagreed, and refusing quietly leaves the page as it was.
      if (where === undefined) return undefined;

      return { kind: 'addLink', page, rect, target: where };
    },
    preview: (gesture: Gesture): ToolPreview | undefined => {
      if (!drawn(gesture)) return undefined;
      const from = startOf(gesture);
      const to = endOf(gesture);
      return {
        shape: 'rect',
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      };
    },
  };

  return { id, controller };
}

/** Both link tools, in the order their controls appear. */
export function linkTools(deps: TextToolDeps): readonly UiTool[] {
  return [
    linkTool(LINK_ADDRESS_TOOL_ID, LINK_ADDRESS_DIALOG_ID, deps, (text) => ({
      kind: 'uri',
      uri: text,
    })),
    linkTool(LINK_PAGE_TOOL_ID, LINK_PAGE_DIALOG_ID, deps, (text) => {
      // ONE-BASED IN, ZERO-BASED OUT, and the conversion is here rather than in
      // the dialog: the dialog collects what was typed and this builds the
      // command, so the offset has one place instead of two halves.
      const typed = /^[1-9][0-9]*$/u.test(text) ? Number(text) : undefined;
      return typed === undefined ? undefined : { kind: 'page', page: typed - 1 };
    }),
  ];
}
