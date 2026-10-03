import { pdfPoint, toViewport } from '@monstera/shared';
import { type ReactElement, useLayoutEffect, useRef } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { useOnColor } from './primitives/useOnColor.js';
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
 * will remove stays fully visible. Its renderer draws the pending mark (`annotationTypes.tsx`).
 *
 * ## `SelectionLayer`'s shape, for its reasons
 *
 * Mounted in the page slot from the same geometry; **inert** — `pointer-events: none`, nothing
 * focusable, `aria-hidden` — so the overlay above keeps every gesture, and a person can still
 * select the text under a mark until the burn-in removes it. **Nothing at all rather than an
 * empty surface** when no annotation on the page has a renderer. The label is hidden from
 * assistive technology with the rest: the comments panel names each mark as a *Redaction mark*,
 * and is where a screen reader meets them.
 *
 * ## It draws the reported box
 *
 * `rect` is the bounding box the eraser and select hit-test against, and it is the region the
 * burn-in covers — so each mark is exactly that box, converted through the page's transform.
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
  // ITS OWN COMPONENT so the label colour is solved when the surface MOUNTS: `useOnColor` reads its target once per
  // dependency change, and a target that was `null` on the render that returned nothing would never be read again.
  return <DrawnAnnotations drawn={drawn} geometry={geometry} page={page} />;
}

function DrawnAnnotations({
  drawn,
  page,
  geometry,
}: {
  readonly drawn: readonly PageAnnotation[];
  readonly page: number;
  readonly geometry: OverlayPage;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // A LABEL'S INK, solved at the point of use against the chip it sits on (ADR-0003: a derived colour is never
  // stored), ONCE PER PAGE rather than once per mark — a page marked by search carries up to 4,096 of them, and each
  // `useOnColor` holds its own observer. Every label on this page sits on `--redact-mark`, so one answer serves all:
  // it is the layer's `color`, which the labels inherit and nothing else in the layer draws with. The layer's own
  // `color` rather than a custom property, as every other caller writes it: a property no stylesheet declares makes
  // the label's declaration invalid until the hook has run, and `check:definedtokens` refuses it.
  useOnColor(root, 'color', '--page', ['--redact-mark'], 'text');
  // WHERE EACH LABEL SITS, measured after layout and written to the element — no state, so no second render. Every
  // label is READ before any is written: a write moves layout, and a read after it would force a layout per mark.
  // AND EACH IS MEASURED DRAWN: a label placed `none` is `display: none` and measures 0 × 0, which fits any mark, so
  // reading it as it was left showed it on the next render and hid it on the one after (measured, 3 October). The
  // places are cleared first — one layout for all of them — and read at the label's own size.
  useLayoutEffect(() => {
    const surface = root.current;
    if (surface === null) return;
    const labels = [...surface.querySelectorAll<HTMLElement>('[data-annotation-label]')];
    for (const label of labels) label.removeAttribute('data-place');
    const places = labels.map((label) => {
      const mark = label.closest<HTMLElement>('[data-annotation-index]');
      return mark === null
        ? 'inside'
        : labelPlace(
            { top: mark.offsetTop, width: mark.clientWidth, height: mark.clientHeight },
            { width: label.offsetWidth, height: label.offsetHeight },
          );
    });
    labels.forEach((label, at) => {
      label.setAttribute('data-place', places[at] ?? 'inside');
    });
  });

  const transform = overlayTransform(geometry);

  return (
    <div aria-hidden="true" className="m-annotation-layer" data-annotation-layer={String(page)} ref={root}>
      {drawn.map((annotation) => {
        const render = ANNOTATION_RENDERERS[annotation.kind];
        const { rect } = annotation;
        // NARROWED AGAIN rather than asserted: the filter above is a runtime fact the compiler
        // does not carry into this callback.
        if (render === null || rect === null) return null;
        const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
        const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
        return (
          <div
            className="m-annotation-layer__item"
            data-annotation-index={String(annotation.index)}
            data-annotation-kind={annotation.kind}
            // THE WALK INDEX IS THE KEY: every entry here is on one page at one version.
            key={annotation.index}
            // A CSSOM WRITE, which §9.27's `style-src` does not intercept (`useOnColor`'s note): the box is the
            // annotation's and changes with the zoom, so it is genuinely dynamic.
            style={{
              insetInlineStart: `${String(Math.min(a.x, b.x))}px`,
              insetBlockStart: `${String(Math.min(a.y, b.y))}px`,
              inlineSize: `${String(Math.abs(b.x - a.x))}px`,
              blockSize: `${String(Math.abs(b.y - a.y))}px`,
            }}
          >
            {render()}
          </div>
        );
      })}
    </div>
  );
}

/** Where a mark's label sits: on the mark, or nowhere. */
export type LabelPlace = 'inside' | 'none';

/**
 * Where a label goes, from the two boxes measured.
 *
 * **On the mark when it fits**, which is what *a label on it* means and covers only content that is to be removed.
 * **Nowhere otherwise.** Outside the mark it sat over the line above or below — measured in the production build,
 * a one-line mark is about 12 px tall at 100% and the label taller, so most marks put it over words nobody marked,
 * and a label must not hide content to say what is marked. The mark's hatching and edge still say it on every mark,
 * the comments panel names each one, and the save, close and export questions count them. A label that fitted by
 * being cut short would say *Marked for re…*, which is a label nobody can rely on.
 */
export function labelPlace(
  mark: { readonly top: number; readonly width: number; readonly height: number },
  label: { readonly width: number; readonly height: number },
): LabelPlace {
  return label.width <= mark.width && label.height <= mark.height ? 'inside' : 'none';
}
