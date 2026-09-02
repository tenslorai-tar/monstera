import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { renderPage } from './renderPage.js';

/**
 * A magnified window on the page under the pointer.
 *
 * ## RENDERED AT THE MAGNIFIED SCALE, not scaled up from the page's bitmap
 *
 * Blowing up the canvas the spine already drew would magnify its pixels, which
 * is the one thing a loupe exists not to do — a reader reaches for it to see
 * detail the page's own resolution does not carry. So it asks the rasteriser
 * for the page again at `devicePixelRatio × zoom × MAGNIFICATION` and shows a
 * window onto that.
 *
 * That is E1's rule arriving in a second place: *pixel-exact at every zoom*
 * applies to the loupe's zoom too, and a loupe is precisely where a reader
 * would notice it not being.
 *
 * ## `devicePixelRatio` READ AT THE POINT OF USE, again
 *
 * The scroller's own note says a value captured at mount renders every later
 * page at the old density once a window moves between a 1x and a 2x display.
 * This is the surface where that would bite hardest, since magnification
 * multiplies the error — so it is read here, on every draw, rather than passed
 * in from a component that read it earlier.
 *
 * ## The whole page is drawn and the window is a TRANSFORM
 *
 * PDF.js renders a page, not a region. Drawing the whole page at the magnified
 * scale and translating the canvas under a small viewport is what turns that
 * into a window — and it means moving the pointer costs a transform rather than
 * a render, which is what keeps the loupe smooth while the reader moves it.
 *
 * The cost is real and bounded: one bitmap at `MAGNIFICATION` times the page's
 * area, held while the loupe is open and dropped when it closes. §9.17's
 * renderer term is what will measure it.
 */
export function Loupe({
  view,
  page,
  zoom,
  at,
}: {
  readonly view: DocumentView | undefined;
  /** Zero-based, as everything that crosses the contract is. */
  readonly page: number;
  /** The scale the page is shown at, so the loupe magnifies from what is seen. */
  readonly zoom: number;
  /**
   * Where the pointer is **within the page element**, in CSS pixels at the
   * shown zoom — so the same units the reader's screen is in.
   *
   * The PAGE's frame and not the window's: a loupe positioned from viewport
   * coordinates shows the wrong part of the page the moment anything scrolls,
   * and a scroll is exactly when a reader is moving it. Multiplying by the
   * magnification is then the whole conversion into the loupe's bitmap,
   * because that bitmap is the same page at the same zoom, larger.
   */
  readonly at: { readonly x: number; readonly y: number };
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (view === undefined || element === null) return;
    let cancelled = false;

    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    void renderPage(view.document, pdfjsPageOf(page), element, ratio * zoom * MAGNIFICATION)
      .then((size) => {
        if (!cancelled) setDrawn(size);
      })
      .catch(() => {
        // A loupe that cannot draw shows nothing. The page underneath is
        // unaffected and reports its own failures; a marker here would be a
        // second report of one document's parse.
      });

    return (): void => {
      cancelled = true;
    };
    // NOT keyed on `at`: moving the pointer must not re-rasterise. The bitmap
    // is the page at this magnification, and where the window sits on it is a
    // transform below.
  }, [page, view, zoom]);

  // WHERE THE BITMAP SITS under the window, so the point the reader is over
  // lands in the middle. In the bitmap's own CSS pixels, which are the page's
  // multiplied by the magnification.
  const offset =
    drawn === undefined
      ? { x: 0, y: 0 }
      : { x: at.x * MAGNIFICATION - WINDOW / 2, y: at.y * MAGNIFICATION - WINDOW / 2 };

  return (
    <div
      className="m-loupe"
      // Decoration over the document: it follows the pointer, so it must never
      // be what the pointer hits.
      aria-hidden="true"
      style={{ inlineSize: `${String(WINDOW)}px`, blockSize: `${String(WINDOW)}px` }}
    >
      <canvas
        ref={canvas}
        className="m-loupe-canvas"
        style={
          drawn === undefined
            ? undefined
            : {
                // The bitmap shown at its own magnified CSS size — dividing by
                // the device ratio undoes the density, leaving the page's
                // pixels times the magnification.
                width: `${String(drawn.width / (typeof window === 'undefined' ? 1 : window.devicePixelRatio))}px`,
                transform: `translate(${String(-offset.x)}px, ${String(-offset.y)}px)`,
              }
        }
      />
    </div>
  );
}

/**
 * How much bigger the loupe draws.
 *
 * Two, which is the smallest magnification that reveals anything a reader could
 * not already see and the largest that keeps a useful amount of page in the
 * window. It is not a setting yet: `BUILD-PROMPT.md:611` lists *loupe* among the
 * viewing preferences, and a magnification a reader can choose is that row's
 * business rather than this component's.
 */
const MAGNIFICATION = 2;

/** The window's side, in CSS pixels. */
const WINDOW = 180;
