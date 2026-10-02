import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import { type PageTransform, toPdf, viewportPoint } from '@monstera/shared';

import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { pointerPath, startOf } from '../registries/tools.js';

/**
 * The plain Signature's tool — a click on the page puts the chosen look there
 * ([ADR-0133](../../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md) Decision 4).
 *
 * `placeImageTool`'s shape: it produces no command here, because the command it leads to is minted by main from the
 * look the person chose, which may be a picture this side never holds. What crosses is the page and a rectangle.
 *
 * **A CLICK, not a drag**: the owner's flow is *choose the look, click where it goes, then move and resize it*. So the
 * rectangle is a default size centred on the click, and every size after that is the select tool's.
 */
export const SIGNATURE_TOOL_ID = 'annotate.signature';

/**
 * The default box, in PDF units AS THE PAGE IS SEEN: three to one, the pad's own proportion, and wide enough that a
 * typed name is legible at the zoom a page opens at. Every size after the first is the person's, by the corners.
 */
export const SIGNATURE_DEFAULT_SIZE = { wide: 150, tall: 50 } as const;

export interface SignatureToolDeps {
  /** Where the signature goes: the page, and its rectangle in PDF user space. */
  readonly onPlacePlainSignature: (page: number, rect: AnnotationRect) => void;
}

/**
 * The box a click describes, in the overlay's own pixels: the default size at the page's scale, centred on the click
 * and moved — never shrunk, unless the page is smaller than it — so it lies wholly on the page.
 *
 * In the overlay's pixels because those are the page AS SEEN: a page turned a quarter is as wide on screen as its
 * rectangle is tall, and the default is a width and a height a person sees.
 */
function boxAround(at: { readonly x: number; readonly y: number }, transform: PageTransform): ToolPreview & { shape: 'rect' } {
  const width = Math.min(SIGNATURE_DEFAULT_SIZE.wide * transform.scale, transform.viewport.width);
  const height = Math.min(SIGNATURE_DEFAULT_SIZE.tall * transform.scale, transform.viewport.height);
  const x = Math.min(Math.max(at.x - width / 2, 0), transform.viewport.width - width);
  const y = Math.min(Math.max(at.y - height / 2, 0), transform.viewport.height - height);
  return { shape: 'rect', x, y, width, height };
}

/** The click tool's controller: the first point of the gesture is where the person aimed. */
function clickPlacement(onPlace: SignatureToolDeps['onPlacePlainSignature']): ToolController {
  return {
    ...pointerPath,
    commit: (gesture: Gesture, page: number, transform: PageTransform): DispatchableCommand | undefined => {
      // THE FIRST POINT, the sticky note's reason: where the pointer was released is not where a slid click aimed.
      const box = boxAround(startOf(gesture), transform);
      const from = toPdf(viewportPoint(box.x, box.y), transform);
      const to = toPdf(viewportPoint(box.x + box.width, box.y + box.height), transform);
      // UNORDERED, `placeImageTool`'s reason: the kernel normalises.
      onPlace(page, { x0: from.x, y0: from.y, x1: to.x, y1: to.y });
      return undefined;
    },
    preview: () => undefined,
  };
}

export function signatureTool(deps: SignatureToolDeps): UiTool {
  // THE ARROW: a signature is placed at a point by a click, as the sticky note is.
  return { id: SIGNATURE_TOOL_ID, controller: clickPlacement(deps.onPlacePlainSignature), cursor: 'arrow' };
}
