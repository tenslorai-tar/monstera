import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { renderRegion } from './renderPage.js';

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
 * ## A REGION round the pointer is drawn, and the window is a TRANSFORM over it
 *
 * The whole page at the magnified scale was the bitmap until 2026-09-28, and its
 * cost was not bounded by anything the loupe shows: at 400% on a display at 2× an
 * A4 page is 9,520 × 13,472 device pixels — 513 MB — for a window 180 pixels
 * square. So it draws a square THREE windows wide round the cell of the grid the
 * pointer is in (`renderRegion`, E1's tile route), whose middle cell always holds
 * the window: moving within a cell is still a transform, and crossing into the next
 * draws the square round that one. The bitmap is 540 CSS pixels square at any zoom.
 */
export function Loupe({
  view,
  page,
  zoom,
  rotation,
  at,
}: {
  readonly view: DocumentView | undefined;
  /** Zero-based, as everything that crosses the contract is. */
  readonly page: number;
  /** The scale the page is shown at, so the loupe magnifies from what is seen. */
  readonly zoom: number;
  /**
   * The rotation the page under the pointer is DRAWN at, from the view model.
   *
   * Required, and `undefined` only where the model has not said: a magnifier
   * that drew the stored `/Rotate` over a page the document has turned shows a
   * different orientation from the page it sits on, and so a different region.
   */
  readonly rotation: number | undefined;
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
  // THE SQUARE LAST DRAWN, in the magnified bitmap's CSS pixels — where it sits is what the transform below needs.
  const [drawn, setDrawn] = useState<{ readonly x: number; readonly y: number } | undefined>(undefined);
  // THE CELL THE POINTER IS IN, in the magnified page's CSS pixels: the draw is keyed on it, never on `at` itself.
  const column = Math.floor((at.x * MAGNIFICATION) / WINDOW);
  const row = Math.floor((at.y * MAGNIFICATION) / WINDOW);

  useEffect(() => {
    const element = canvas.current;
    if (view === undefined || element === null) return;
    // ABORTED ON CLEANUP, which cancels the PDF.js task holding this canvas: a flag left it
    // running, and PDF.js refused the next draw on the same canvas (`renderPage`).
    const superseded = new AbortController();

    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    // THE SQUARE: the cell before, the cell, the cell after, both ways — so the window, never more than half a
    // window from its cell's edges, lies wholly inside it.
    const square = { x: (column - 1) * WINDOW, y: (row - 1) * WINDOW };
    // ONTO THE SHOWN CANVAS, because `renderRegion` draws off screen and presents the square whole: sizing a canvas
    // clears it, and this file did that copy itself while every other surface drew in place. It is the drawing
    // function's job now, so the page, the tiles, the thumbnails and the loupe cannot disagree about it.
    void renderRegion(
      view.document,
      pdfjsPageOf(page),
      element,
      ratio * zoom * MAGNIFICATION,
      rotation,
      {
        x: Math.round(square.x * ratio),
        y: Math.round(square.y * ratio),
        width: Math.round(SQUARE * ratio),
        height: Math.round(SQUARE * ratio),
      },
      superseded.signal,
    )
      .then(() => {
        if (superseded.signal.aborted) return;
        setDrawn(square);
      })
      .catch(() => {
        // A loupe that cannot draw shows nothing. The page underneath is
        // unaffected and reports its own failures; a marker here would be a
        // second report of one document's parse. A superseded draw lands here
        // too, and is followed by the draw that replaced it.
      });

    return (): void => {
      superseded.abort();
    };
    // KEYED ON THE CELL, NOT `at`: moving the pointer within a cell must not
    // re-rasterise; where the window sits on the square is a transform below.
  }, [column, page, rotation, row, view, zoom]);

  // WHERE THE SQUARE SITS under the window, so the point the reader is over
  // lands in the middle. In the magnified page's CSS pixels.
  const offset =
    drawn === undefined
      ? { x: 0, y: 0 }
      : { x: at.x * MAGNIFICATION - WINDOW / 2 - drawn.x, y: at.y * MAGNIFICATION - WINDOW / 2 - drawn.y };

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
                // The square shown at its magnified CSS size, whatever density it was drawn at.
                width: `${String(SQUARE)}px`,
                height: `${String(SQUARE)}px`,
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

/** The drawn square's side, in the magnified page's CSS pixels: three windows. */
const SQUARE = WINDOW * 3;
