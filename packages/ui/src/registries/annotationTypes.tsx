import type { AnnotationKindName } from '@monstera/contract';
import type { ReactElement } from 'react';

/**
 * The annotation-types registry's RENDERER half — §7's *"Annotation types | geometry adapter,
 * renderer, kernel writer mapping | overlay, panel, persistence"*, and §6's *"every annotation
 * type registers … a renderer"*.
 *
 * ## One entry per kind, and the record is what makes that exhaustive
 *
 * Keyed on the contract's closed `AnnotationKindName`, so a kind added there is a compile error
 * here until somebody decides how it is drawn. A partial map would let a new kind arrive drawing
 * nothing with no decision taken, which is the silent omission this shape exists to refuse.
 *
 * ## `null` means the page raster draws it, and that is almost every kind
 *
 * PDF.js paints an annotation's own appearance stream onto the page canvas, so a square, an ink
 * stroke or a highlight is already on screen and a renderer here would draw it twice. The one
 * kind whose appearance does not show what it means is `redact`: measured 2026-09-15 in the
 * production build, MuPDF's Redact appearance is painted as a thin red outline and the content it
 * will remove stays fully visible. Its renderer draws the solid box the burn-in produces
 * (`pageRedact.ts` passes `cover === 'solid'` as MuPDF's black boxes), in `--redact-mark`, a
 * `graphic` token checked at 3:1 against `--page` (ADR-0003, corrected 2026-09-15).
 *
 * ## What this is NOT yet
 *
 * The geometry adapter and the kernel writer mapping are the other two halves §7 lists, and
 * nothing calls them: the eraser and select hit-test the channel's `rect` directly, and the
 * kernel maps drafts in `pageAnnotations.ts`. Building empty halves ahead of a caller would be a
 * declaration nothing can contradict, so this file carries the half that has one.
 */

/** A box in the page layer's own pixels. */
export interface LayerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How an existing annotation of one kind is drawn over its page, or `null` where the page raster draws it. */
export type AnnotationRenderer = ((box: LayerBox) => ReactElement) | null;

/**
 * The solid preview of a Redact mark: the region the burn-in removes, filled.
 *
 * Opaque on purpose. What the preview says is *this is gone once applied*, and a translucent box
 * would say *this is highlighted*. The person reviewing marks before applying reads the text
 * under a mark from the annotations panel's row, not through the preview.
 */
function redactPreview(box: LayerBox): ReactElement {
  return <rect className="m-redact-preview" height={box.height} width={box.width} x={box.x} y={box.y} />;
}

export const ANNOTATION_RENDERERS: Readonly<Record<AnnotationKindName, AnnotationRenderer>> = {
  square: null,
  circle: null,
  line: null,
  ink: null,
  redact: redactPreview,
  'text-box': null,
  'sticky-note': null,
  caret: null,
  polygon: null,
  polyline: null,
  highlight: null,
  underline: null,
  strikeout: null,
  callout: null,
  typewriter: null,
  'measure-distance': null,
  'measure-area': null,
  'measure-perimeter': null,
  other: null,
};
