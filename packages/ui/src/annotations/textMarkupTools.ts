import type { AnnotationColour, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { toPdf } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import type { AnnotationStyle } from './annotationStyle.js';

/**
 * Highlight, underline and strikethrough — a drag across text.
 *
 * ## The gesture is the platform's oldest one, and that is the finding
 *
 * These were expected to need a **text layer**: a selection in every other
 * reader is characters under the pointer, drawn by the renderer, and this
 * application has none. It turned out not to need one. MuPDF answers *which
 * text lies between these two points* directly — `StructuredText.highlight` —
 * so the tool sends the two ends of the drag and the kernel resolves the run.
 *
 * That is B3a rather than a shortcut. *Where does a text selection start and
 * stop* is a question the engine already owns, and a renderer implementing it
 * would agree on one line of Latin text and disagree on two columns, a
 * right-to-left run, a rotated page and every scanned document.
 *
 * So this file is three drag tools, and the platform is untouched.
 *
 * ## The preview is a LINE, not a rectangle
 *
 * A rectangle would say *this region*, and the annotation is not a region: it
 * is whole lines of text between two points, so the box a person sweeps and the
 * shape they get are different. A line between the two ends says what is
 * actually being named — where the selection starts and where it stops — and
 * does not promise a shape the kernel will not produce.
 *
 * The real feedback is the page re-rendering with the markup on it, which is
 * the same argument the point tools make about not drawing a size the kernel
 * owns.
 */

/** What each markup is painted in, until the style controls own it. */
const HIGHLIGHT_COLOUR: AnnotationColour = [1, 0.9, 0.2];
/** A reviewing hand's red, which is what an underline and a strike are. */
const MARKUP_COLOUR: AnnotationColour = [0.85, 0.15, 0.15];

/** The ids, shared with the commands that select these tools. */
export const HIGHLIGHT_TOOL_ID = 'annotate.highlight';
export const UNDERLINE_TOOL_ID = 'annotate.underline';
export const STRIKEOUT_TOOL_ID = 'annotate.strikeout';

/**
 * How far the pointer must travel before a drag names a run of text.
 *
 * `shapeTools.ts`' number for its reason, stated separately: a click that did
 * not move selects nothing, and the kernel refuses it — so this is a refusal
 * made where the person can see it happen rather than one that costs a round
 * trip and a version that never moved.
 */
const MINIMUM_DRAG = 4;

/** The three markups and each one's own colour, for whatever names a run of text by its two ends. */
export const MARKUP_COLOURS = {
  highlight: HIGHLIGHT_COLOUR,
  underline: MARKUP_COLOUR,
  strikeout: MARKUP_COLOUR,
} as const satisfies Record<'highlight' | 'underline' | 'strikeout', AnnotationColour>;

export type MarkupType = keyof typeof MARKUP_COLOURS;

/**
 * The command that marks up the text between two points on a page — the ONE builder for it, taken
 * by the drag tools below and by the selected-text menu (§7). Both name a run by its two ends and
 * let MuPDF resolve the text between, so a second builder would be a second opinion about what a
 * markup command carries.
 */
export function markupCommand(
  type: MarkupType,
  page: number,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  style: AnnotationStyle,
): RenderableCommand {
  return {
    kind: 'addAnnotation',
    page,
    annotation: {
      type,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      // THE HIGHLIGHTER'S YELLOW IS ITS OWN, resolved through the style: a
      // person who has chosen nothing gets a highlighter that highlights,
      // and one who has chosen gets what they chose on all three.
      colour: style.colour(MARKUP_COLOURS[type]),
      opacity: style.opacity,
    },
  };
}

function markupTool(id: string, type: MarkupType, style: AnnotationStyle): UiTool {
  const moved = (gesture: Gesture): boolean => {
    const from = startOf(gesture);
    const to = endOf(gesture);
    return Math.hypot(to.x - from.x, to.y - from.y) >= MINIMUM_DRAG;
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): RenderableCommand | undefined => {
      if (!moved(gesture)) return undefined;
      return markupCommand(type, page, toPdf(startOf(gesture), transform), toPdf(endOf(gesture), transform), style);
    },
    preview: (gesture: Gesture): ToolPreview | undefined => {
      if (!moved(gesture)) return undefined;
      const from = startOf(gesture);
      const to = endOf(gesture);
      return { shape: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    },
  };

  return { id, controller };
}

/** The three text markups, in the order their controls appear. */
export function textMarkupTools(style: AnnotationStyle): readonly UiTool[] {
  return [
    markupTool(HIGHLIGHT_TOOL_ID, 'highlight', style),
    markupTool(UNDERLINE_TOOL_ID, 'underline', style),
    markupTool(STRIKEOUT_TOOL_ID, 'strikeout', style),
  ];
}
