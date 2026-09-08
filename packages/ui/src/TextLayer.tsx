import { type LineMatch, findInLines, toPdf, toViewport, viewportPoint } from '@monstera/shared';
import { type ReactElement, useEffect, useRef } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform, unscaledTransform } from './annotations/annotationSpace.js';
import { type HighlightPainter, type SearchHighlight, sharedPainter } from './searchHighlight.js';

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
  /**
   * The search whose matches should be painted over these glyphs, if any.
   *
   * Absent while nothing has been searched, which is not the same as a search
   * that found nothing — the second still paints (nothing), and the difference
   * is that it has an answer.
   *
   * **Required, and `| undefined`.** See `PageListProps.search`: a prop crossing
   * four components must be dropped deliberately or not at all.
   */
  readonly search: SearchHighlight | undefined;
  /**
   * Where the ranges go. The window's shared painter unless a caller says
   * otherwise, which is what lets a test read what would have been painted in
   * an environment that has no `CSS.highlights` at all.
   */
  readonly painter?: HighlightPainter | null | undefined;
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
 *
 * ## It now paints a search's matches, and that is still placement
 *
 * The paragraph above said this component "registers no handlers and makes no
 * decisions". It still registers none. What it gained is one effect that turns
 * a search into DOM ranges over the nodes it just rendered, because those nodes
 * are its own and the alternative is a second component reaching into them.
 *
 * The matches are recomputed HERE from the same lines this layer drew, rather
 * than taken from `document.searchPage`'s offsets. That is not duplication of
 * the search — it is the same resolver, `findInLines`, run over the text the
 * reader is actually looking at. Taking the channel's offsets would put a
 * correspondence between two strings at the call site: the channel normalises
 * before matching, and NFC can change a line's length, so an offset computed
 * there is not an index into the string rendered here unless something states
 * that it is. `CLAUDE.md`'s page-index finding is that shape exactly, and the
 * remedy it names is to remove the second frame rather than to write the
 * correspondence down.
 */
export function TextLayer({
  lines,
  page,
  geometry,
  search,
  painter,
}: TextLayerProps): ReactElement | null {
  const container = useRef<HTMLDivElement | null>(null);
  // THE DEFAULT IS RESOLVED IN THE EFFECT, not here: `sharedPainter` reads
  // `globalThis`, and reading it during render would fix the answer before a
  // test could arrange an environment. `undefined` means "ask"; an explicit
  // `null` means "paint nowhere" and is not overridden.
  const askedFor = painter;

  useEffect(() => {
    const sink = askedFor === undefined ? sharedPainter() : askedFor;
    const root = container.current;
    if (sink === null || root === null) return undefined;

    // A CLEANUP THAT ALWAYS RUNS, including on the paths that paint nothing.
    // A page scrolled out of view unmounts, and a contribution left behind
    // would paint ranges over nodes that are gone — which is not a visual
    // defect but a growing set of detached ranges the registry keeps alive.
    const forget = (): void => {
      sink.setPage(page, null);
    };

    if (search === undefined || search.query === '') {
      forget();
      return forget;
    }

    const found = findInLines(
      lines.map((line) => line.text),
      search.query,
      search.options,
    );
    // A PATTERN THAT DOES NOT COMPILE PAINTS NOTHING, and is not an error here.
    // The find bar has its own state for it and says so; a layer that threw
    // would take the page down for a half-typed regex.
    if (!found.ok) {
      forget();
      return forget;
    }

    const all: Range[] = [];
    const active: Range[] = [];
    for (const match of found.value) {
      const range = rangeOf(root, match);
      if (range === null) continue;
      all.push(range);
      if (
        search.active?.page === page &&
        search.active.line === match.line &&
        search.active.offset === match.offset
      ) {
        active.push(range);
      }
    }
    sink.setPage(page, { all, active });
    return forget;
  }, [askedFor, lines, page, search]);

  // NOTHING AT ALL RATHER THAN AN EMPTY SURFACE, which is `AnnotationOverlay`'s
  // rule and `SelectionLayer`'s: an element over the page that holds nothing is
  // a thing that can go wrong silently, and *absent* is checkable in a way
  // *empty* is not. It also matters here in particular — an empty layer that
  // accepts pointer events would swallow drags meant for the page.
  if (lines.length === 0) return null;

  const unscaled = unscaledTransform(geometry);
  const shown = overlayTransform(geometry);

  return (
    <div className="m-text-layer" data-text-layer={String(page)} ref={container}>
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

/**
 * One match as a DOM range over the line elements it covers.
 *
 * ## Why it walks the rendered nodes rather than trusting the index
 *
 * The line elements carry `data-text-line`, and the match carries a line index
 * into the same array that produced them — so `children[match.line]` would be
 * right. It is queried by attribute anyway, because the two agree by
 * construction and disagreeing is exactly the failure this returns `null` for:
 * a layer mid-update, a line the browser has not laid out yet. A `null` paints
 * one match less; an index into the wrong node paints a highlight over the
 * wrong words, which reads as the search being wrong.
 *
 * ## The two ends may be different elements
 *
 * A match that spans a wrap starts in one line and ends in the next, and a
 * `Range` across two elements is exactly what the Custom Highlight API paints
 * as one region. That is the whole reason `LineMatch` reports its end as a
 * `(line, offset)` pair rather than a length.
 *
 * @returns the range, or `null` when either end cannot be located.
 */
function rangeOf(root: HTMLElement, match: LineMatch): Range | null {
  const start = textNodeOf(root, match.line);
  const end = textNodeOf(root, match.endLine);
  if (start === null || end === null) return null;
  // CLAMPED, because a `Range` throws on an offset past its node's length and
  // one bad match must not take the whole page's highlighting with it. The
  // clamp cannot fire while the layer and the search read the same lines; it is
  // here for the moment they do not.
  const from = Math.min(match.offset, start.length);
  const to = Math.min(match.endOffset, end.length);
  const range = root.ownerDocument.createRange();
  range.setStart(start, from);
  range.setEnd(end, to);
  return range;
}

/** The text node inside the `index`-th rendered line, or `null`. */
function textNodeOf(root: HTMLElement, index: number): Text | null {
  const element = root.querySelector(`[data-text-line="${String(index)}"]`);
  const node = element?.firstChild ?? null;
  // A TEXT NODE SPECIFICALLY. `firstChild` is one whenever the line rendered
  // its string, and an element there would mean this component grew a wrapper
  // — at which point every offset below is measured against the wrong thing and
  // the honest answer is to paint nothing until someone updates this.
  return node !== null && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}
