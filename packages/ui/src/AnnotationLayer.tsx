import { pdfPoint, toViewport } from '@monstera/shared';
import type { ReactElement } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { ANNOTATION_RENDERERS } from './registries/annotationTypes.js';
import type { PageAnnotation } from './usePageAnnotations.js';

/**
 * Existing annotations drawn over their page by the renderer registered for their kind
 * (§6: *"every annotation type registers … a renderer"*; §7's Annotation types row).
 *
 * ## Only the kinds the page raster does not already draw
 *
 * PDF.js paints an annotation's own appearance onto the page canvas, so most kinds need nothing
 * here and their registered renderer is `null`. A Redact mark is the exception, measured
 * 2026-09-15 in the production build: its appearance is a thin red outline and the content it
 * will remove stays fully visible. Its renderer draws the solid preview.
 *
 * ## `SelectionLayer`'s shape, for its reasons
 *
 * Mounted in the page slot from the same geometry; **inert** — `pointer-events: none`, nothing
 * focusable, `aria-hidden` — so the overlay above keeps every gesture, and a person can still
 * select the text under a preview until the burn-in removes it. **Nothing at all rather than an
 * empty surface** when no annotation on the page has a renderer.
 *
 * ## It draws the reported box
 *
 * `rect` is the bounding box the eraser and select hit-test against, and it is the region the
 * burn-in covers — so the preview is exactly that box, converted through the page's transform.
 */
export interface AnnotationLayerProps {
  /** This page's existing annotations, or `undefined` before they are known. */
  readonly annotations: readonly PageAnnotation[] | undefined;
  /** Which page this layer sits on, zero-based. */
  readonly page: number;
  /** The page as drawn, for the transform. The overlay's own geometry. */
  readonly geometry: OverlayPage;
}

export function AnnotationLayer({ annotations, page, geometry }: AnnotationLayerProps): ReactElement | null {
  const drawn = (annotations ?? []).filter(
    (annotation) => annotation.rect !== null && ANNOTATION_RENDERERS[annotation.kind] !== null,
  );
  if (drawn.length === 0) return null;

  const transform = overlayTransform(geometry);

  return (
    <svg aria-hidden="true" className="m-annotation-layer" data-annotation-layer={String(page)}>
      {drawn.map((annotation) => {
        const render = ANNOTATION_RENDERERS[annotation.kind];
        const { rect } = annotation;
        // NARROWED AGAIN rather than asserted: the filter above is a runtime fact the compiler
        // does not carry into this callback.
        if (render === null || rect === null) return null;
        const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
        const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
        return (
          <g
            data-annotation-index={String(annotation.index)}
            data-annotation-kind={annotation.kind}
            // THE WALK INDEX IS THE KEY: every entry here is on one page at one version.
            key={annotation.index}
          >
            {render({
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(b.x - a.x),
              height: Math.abs(b.y - a.y),
            })}
          </g>
        );
      })}
    </svg>
  );
}
