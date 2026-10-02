import { type CompareBox, toPdf, toViewport, viewportPoint } from '@monstera/shared';
import type { ReactElement } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform, unscaledTransform } from './annotations/annotationSpace.js';

/** One box of a comparison's change on this page (ADR-0131), in the page's display space at scale 1. */
export interface DifferenceMark {
  readonly box: CompareBox;
  readonly kind: 'text' | 'layout' | 'annotation' | 'graphics' | 'page';
  /** Whether this is part of the change the reader chose in the summary list. */
  readonly active: boolean;
}

/**
 * A comparison's changes drawn over one page — Side by Side's marks (ADR-0131).
 *
 * ## Placed exactly as the text layer places its lines
 *
 * The comparison's boxes are the text layer's own space (display space at scale 1), so they reach the screen through
 * the same two named conversions `TextLayer` uses: `toPdf` through the page at scale 1, then `toViewport` at the
 * current zoom. Multiplying a box by the zoom would be a third implementation of what `annotationSpace.ts` owns, and
 * wrong on a rotated page in a way no unrotated fixture shows.
 *
 * ## Decoration, never a target
 *
 * The marks take no pointer and are hidden from assistive technology: the summary list is where a change is read and
 * chosen, and a mark is where it is on the page.
 */
export function DifferenceLayer({
  marks,
  page,
  geometry,
}: {
  readonly marks: readonly DifferenceMark[];
  readonly page: number;
  readonly geometry: OverlayPage;
}): ReactElement | null {
  if (marks.length === 0) return null;
  const unscaled = unscaledTransform(geometry);
  const shown = overlayTransform(geometry);
  return (
    <div aria-hidden="true" className="m-difference-layer" data-difference-layer={String(page)}>
      {marks.map((mark, index) => {
        const a = toViewport(toPdf(viewportPoint(mark.box.x0, mark.box.y0), unscaled), shown);
        const b = toViewport(toPdf(viewportPoint(mark.box.x1, mark.box.y1), unscaled), shown);
        return (
          <span
            className={`m-difference m-difference--${mark.kind}${mark.active ? ' m-difference--active' : ''}`}
            data-difference={mark.kind}
            key={index}
            style={{
              left: `${String(Math.min(a.x, b.x))}px`,
              top: `${String(Math.min(a.y, b.y))}px`,
              width: `${String(Math.abs(b.x - a.x))}px`,
              height: `${String(Math.abs(b.y - a.y))}px`,
            }}
          />
        );
      })}
    </div>
  );
}
