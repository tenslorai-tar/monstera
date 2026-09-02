import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { HORIZONTAL_RULER_LABEL, VERTICAL_RULER_LABEL } from './messages/en.js';
import { type RulerUnit, rulerTicks } from './rulerGeometry.js';

/**
 * The two rulers along the scroller's top and left edge.
 *
 * ## They are chrome, not part of the page
 *
 * A ruler is drawn beside the document rather than over it, so it never covers
 * a glyph and never lands in a screenshot of the page. That also keeps it out
 * of the canvas: a mark rasterised into the page bitmap would be re-rendered on
 * every zoom step, and would be there in an export.
 *
 * ## Aligned to the PAGE'S zero, not the scroller's
 *
 * `originPx` is where the page's left or top edge sits inside the scroller, so
 * the `0` mark is on the page corner and the numbers are page coordinates —
 * which is what a person is measuring. A ruler zeroed on the viewport would
 * change meaning every time the window moved, which is a ruler that measures
 * the window.
 *
 * ## `aria-hidden`, deliberately, and this is not a a11y gap
 *
 * Every tick is decoration with a number on it, and a screen reader announcing
 * two hundred numbers is worse than silence. The ruler carries a `role="img"`
 * with a name so it is *identifiable* in the tree, and the measurement a
 * non-visual reader actually needs is the page geometry, which belongs to a
 * control that reports coordinates rather than to a strip of pixels.
 */
export function Rulers({
  unit,
  zoom,
  size,
  origin,
}: {
  readonly unit: RulerUnit;
  /** CSS pixels per point. */
  readonly zoom: number;
  /** The scroller's own box, in CSS pixels. */
  readonly size: { readonly width: number; readonly height: number };
  /** Where the page's zero sits in the scroller, in CSS pixels. */
  readonly origin: { readonly x: number; readonly y: number };
}): ReactElement {
  const { i18n } = useLingui();
  const across = rulerTicks(size.width, unit, zoom, origin.x);
  const down = rulerTicks(size.height, unit, zoom, origin.y);

  return (
    <>
      <div
        className="m-ruler m-ruler-h"
        role="img"
        aria-label={i18n._(HORIZONTAL_RULER_LABEL)}
      >
        {across.map((tick) => (
          <span
            key={tick.offset}
            className={tick.major ? 'm-tick m-tick-major' : 'm-tick'}
            style={{ insetInlineStart: `${String(tick.offset)}px` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div className="m-ruler m-ruler-v" role="img" aria-label={i18n._(VERTICAL_RULER_LABEL)}>
        {down.map((tick) => (
          <span
            key={tick.offset}
            className={tick.major ? 'm-tick m-tick-major' : 'm-tick'}
            style={{ insetBlockStart: `${String(tick.offset)}px` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </>
  );
}
