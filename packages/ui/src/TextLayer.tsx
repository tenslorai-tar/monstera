import { toPdf, toViewport, viewportPoint } from '@monstera/shared';
import type { ReactElement } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform, unscaledTransform } from './annotations/annotationSpace.js';

/**
 * One line of the page, as the channel reports it.
 *
 * Restated here rather than imported from `@monstera/contract` because this
 * component takes what a caller hands it, and the caller is what talks to the
 * channel — the same split every other overlay here makes.
 */
export interface TextLayerLine {
  readonly text: string;
  /** The line's box in the page's display space at scale 1. */
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

export interface TextLayerProps {
  /** The lines, in reading order. Empty until the page's text has arrived. */
  readonly lines: readonly TextLayerLine[];
  /** Which page this layer sits on, zero-based. */
  readonly page: number;
  /** The page as drawn, for the transform. The overlay's own geometry. */
  readonly geometry: OverlayPage;
}

/**
 * The invisible text a person selects and copies.
 *
 * ## What this is, and what it deliberately is not
 *
 * A PDF page on screen is a bitmap; there is nothing in it to select. Every
 * viewer that supports selection puts transparent text over the raster in the
 * places the glyphs are, and lets the browser do the rest — the selection, the
 * caret, the drag, the double-click-to-word, the copy, the accessibility tree,
 * *find in page*. None of that is reimplemented here and none of it should be:
 * a hand-written selection model is a second answer to a question the platform
 * already owns, and it is the answer that will not match the user's other
 * applications.
 *
 * So this component's whole job is **placement**. It is not interactive in the
 * sense the annotation overlay is: it registers no handlers and makes no
 * decisions. It is also not inert — `pointer-events` must reach it or there is
 * nothing to select, which is the one way it differs from `SelectionLayer`.
 *
 * ## The text comes from the KERNEL, and that was measured
 *
 * PDF.js draws these pages and has its own `getTextContent`, which would need no
 * channel at all. Taking it would put two extraction paths in one application:
 * one deciding what the user finds, one deciding what the user copies. Measured
 * 2026-09-08 — on a two-column page drawn row-major the two share **0 of 6
 * lines**, the substrate reading column-major and PDF.js reading straight across
 * the gutter; on a label separated from its value by a wide gap they share
 * **0 of 2**. A user could search for a phrase, be told it is there, select it,
 * and copy something else.
 *
 * ## Two conversions, both named, and neither invented here
 *
 * The channel's boxes are display space at scale 1 — `/Rotate` applied, no zoom
 * — because the crop box belongs to PDF.js and deriving one main-side would be a
 * second opinion about it. So a box becomes a CSS rectangle in two steps:
 * `toPdf` through the page's transform **at scale 1**, then `toViewport` through
 * the same page **at the current zoom**.
 *
 * Multiplying the reported box by the zoom would also work and is rejected: it
 * is a third implementation of a conversion `annotationSpace.ts` owns, and its
 * rotation handling is invisible at rotation 0 — which is precisely how the
 * substrate's own coordinate brand was wrong for weeks without a single test
 * noticing.
 *
 * ## Why the text is scaled rather than positioned per glyph
 *
 * A line's box is where its glyphs are; the font that drew them is not
 * available here and would not match a web font anyway. So each line is one
 * element stretched to its box, with the text scaled horizontally to fill it.
 * Selection then follows the line, and a partial selection lands within a
 * character or two of where the pointer is — which is what every viewer that
 * does this achieves, and is why the text is transparent rather than merely
 * hidden: a person dragging across a page must see the browser's own selection
 * highlight land on the words.
 */
export function TextLayer({ lines, page, geometry }: TextLayerProps): ReactElement | null {
  // NOTHING AT ALL RATHER THAN AN EMPTY SURFACE, which is `AnnotationOverlay`'s
  // rule and `SelectionLayer`'s: an element over the page that holds nothing is
  // a thing that can go wrong silently, and *absent* is checkable in a way
  // *empty* is not. It also matters here in particular — an empty layer that
  // accepts pointer events would swallow drags meant for the page.
  if (lines.length === 0) return null;

  const unscaled = unscaledTransform(geometry);
  const shown = overlayTransform(geometry);

  return (
    <div className="m-text-layer" data-text-layer={String(page)}>
      {lines.map((line, index) => {
        // Display space to PDF user space, then PDF to the viewport. Both
        // corners, because a rotation swaps which one is topmost and taking the
        // reported order as top-left would place every line off the page on two
        // of the four turns.
        const a = toViewport(toPdf(viewportPoint(line.box.x0, line.box.y0), unscaled), shown);
        const b = toViewport(toPdf(viewportPoint(line.box.x1, line.box.y1), unscaled), shown);
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const width = Math.abs(b.x - a.x);
        const height = Math.abs(b.y - a.y);

        return (
          <span
            className="m-text-line"
            // THE READING-ORDER INDEX, which is what a line is identified by
            // here: the lines are one page's answer at one version, replaced
            // whole when the version moves, so an index is stable across a
            // re-render in the way a position in a re-fetched array is not.
            data-text-line={String(index)}
            key={index}
            style={{
              left: `${String(left)}px`,
              top: `${String(top)}px`,
              width: `${String(width)}px`,
              height: `${String(height)}px`,
              // The line's own height, so a selection highlight is the height of
              // the text rather than of the CSS default.
              fontSize: `${String(height)}px`,
            }}
          >
            {line.text}
          </span>
        );
      })}
    </div>
  );
}
