import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { HORIZONTAL_RULER_LABEL, VERTICAL_RULER_LABEL } from './messages/en.js';
import { type RulerSpan, type RulerUnit, spanTicks } from './rulerGeometry.js';

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
 * **And beside the SCROLLER, not inside it.** They sit in their own grid tracks of the pane (`.m-page-pane`). They
 * used to be absolutely positioned children of the scroller, and an absolute child of a scroll container is laid out
 * in its scrolled content: the rulers rode up with page 1 and were gone after one screen of scrolling, while their
 * marks were still computed for the viewport they had left.
 *
 * ## Aligned to EACH PAGE'S zero, not the scroller's
 *
 * Every page on screen is a span along the ruler, and each span's `0` is on that
 * page's corner, so the numbers are page coordinates — which is what a person
 * is measuring. A ruler zeroed on the viewport would change meaning every time
 * the window moved; one zeroed on the first page reads arithmetic on every page
 * after it ({@link spanTicks}).
 *
 * The two rulers start where the scroller starts — the horizontal one above it,
 * the vertical one beside it — so an offset measured from the scroller's box is
 * an offset along the ruler, with no conversion between them.
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
  across: acrossSpans,
  down: downSpans,
}: {
  readonly unit: RulerUnit;
  /** CSS pixels per point. */
  readonly zoom: number;
  /** The scroller's own box, in CSS pixels: how long each ruler is. */
  readonly size: { readonly width: number; readonly height: number };
  /** The pages along the top, measured from the scroller's left edge. */
  readonly across: readonly RulerSpan[];
  /** The pages down the side, measured from the scroller's top edge. */
  readonly down: readonly RulerSpan[];
}): ReactElement {
  const { i18n } = useLingui();
  const across = spanTicks(acrossSpans, size.width, unit, zoom);
  const down = spanTicks(downSpans, size.height, unit, zoom);

  return (
    <>
      <div
        className="m-ruler m-ruler-h"
        role="img"
        aria-label={i18n._(HORIZONTAL_RULER_LABEL)}
      >
        {across.map((tick) => (
          <span
            key={`${String(tick.span)}:${String(tick.offset)}`}
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
            key={`${String(tick.span)}:${String(tick.offset)}`}
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
