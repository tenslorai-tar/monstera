import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { HORIZONTAL_RULER_LABEL, VERTICAL_RULER_LABEL } from './messages/en.js';
import { type RulerRun, type RulerSpan, type RulerUnit, pageRuns } from './rulerGeometry.js';

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
 * Every page on screen is a run along the ruler, and each run's `0` is on that
 * page's corner, so the numbers are page coordinates — which is what a person
 * is measuring. A ruler zeroed on the viewport would change meaning every time
 * the window moved; one zeroed on the first page reads arithmetic on every page
 * after it ({@link pageRuns}).
 *
 * ## A scroll moves each page's run and redraws no mark
 *
 * A run is one element placed at its page's start, and its marks are placed from the PAGE'S zero, so they are the same
 * at every scroll position and React keeps every one of them: a scroll changes one style per page on screen. Marks
 * placed from the ruler's start were keyed by that scrolled offset, so every mark was removed and inserted again on
 * every frame of a scroll (`pageRuns`, measured there).
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

  return (
    <>
      <div className="m-ruler m-ruler-h" role="img" aria-label={i18n._(HORIZONTAL_RULER_LABEL)}>
        <Runs axis="inline" runs={pageRuns(acrossSpans, size.width, unit, zoom)} />
      </div>
      <div className="m-ruler m-ruler-v" role="img" aria-label={i18n._(VERTICAL_RULER_LABEL)}>
        <Runs axis="block" runs={pageRuns(downSpans, size.height, unit, zoom)} />
      </div>
    </>
  );
}

/**
 * One ruler's runs along its axis. A run is keyed by its place among the pages on screen and a mark by its offset from
 * the page's zero — both unchanged by a scroll, so React updates a run's start and touches nothing inside it.
 */
function Runs({ axis, runs }: { readonly axis: 'inline' | 'block'; readonly runs: readonly RulerRun[] }): ReactElement {
  return (
    <>
      {runs.map((run, at) => (
        <div
          className="m-ruler-run"
          key={at}
          style={
            axis === 'inline'
              ? { insetInlineStart: `${String(run.start)}px`, inlineSize: `${String(run.length)}px` }
              : { insetBlockStart: `${String(run.start)}px`, blockSize: `${String(run.length)}px` }
          }
        >
          {run.ticks.map((tick) => (
            <span
              key={tick.offset}
              className={tick.major ? 'm-tick m-tick-major' : 'm-tick'}
              style={
                axis === 'inline'
                  ? { insetInlineStart: `${String(tick.offset)}px` }
                  : { insetBlockStart: `${String(tick.offset)}px` }
              }
            >
              {tick.label}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
