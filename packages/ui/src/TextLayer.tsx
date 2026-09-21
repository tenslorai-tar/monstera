import { type LineMatch, findInLines, toPdf, toViewport, viewportPoint } from '@monstera/shared';
import { type ReactElement, useEffect, useLayoutEffect, useRef } from 'react';

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

/** Text a person has selected on one page, and the two ends of the run in PDF user space. */
export interface TextSelection {
  /** The page, zero-based. */
  readonly page: number;
  /** The selected text, as the browser copies it, trimmed. Never empty. */
  readonly text: string;
  /** Where the run starts and ends, in PDF user space — what the markup tools send. */
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/**
 * Each mounted layer's page and its viewport-to-PDF conversion, keyed by the layer's ELEMENT.
 *
 * By element rather than by page, because split view mounts two layers for one page at different
 * zooms: the selection resolves through the layer it actually sits in. A `WeakMap`, so a layer that
 * unmounts without its effect's cleanup running still takes its entry with it.
 */
const LAYERS = new WeakMap<Element, { readonly page: number; readonly toPdf: (x: number, y: number) => { x: number; y: number } }>();

/**
 * The text a person has selected in ONE page's text layer — the range clipped to that layer where
 * one end lies outside every layer, and `undefined` where the two ends are in two.
 *
 * The selection is the platform's (the component's header below): this reads it and converts, and
 * decides nothing about where a run starts or stops. The two ends are the first and last rectangle
 * the range occupies — the start of the first, the end of the last, each at mid-height — converted
 * through the layer's own transform; MuPDF then resolves the text between them, as it does for a
 * drag. A selection across two pages is not one run on one page, and answers `undefined`.
 *
 * The rectangles are only where the ink is because each line's text is FITTED to its box
 * (`fitLines`): unfitted, a substitute font wider than the page's own put every point read here
 * further right than the glyph it stood for, and a highlight of *The quarterly totals* ran on
 * through *are lis*.
 *
 * @param selection the browser's selection; `document.getSelection()` by default
 */
export function readTextSelection(selection: Selection | null = globalThis.document.getSelection()): TextSelection | undefined {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const layerOf = (node: Node | null): Element | null =>
    (node instanceof Element ? node : (node?.parentElement ?? null))?.closest('[data-text-layer]') ?? null;
  const range = selection.getRangeAt(0);
  const startLayer = layerOf(range.startContainer);
  const endLayer = layerOf(range.endContainer);
  // TWO LAYERS is two pages, and not one run.
  if (startLayer !== null && endLayer !== null && startLayer !== endLayer) return undefined;
  const layer = startLayer ?? endLayer;
  if (layer === null) return undefined;
  const entry = LAYERS.get(layer);
  if (entry === undefined) return undefined;
  // ONE END OUTSIDE EVERY LAYER is clipped to the layer rather than refused. A triple-click on a
  // page's last line ends the range at the start of the next block, which is the page slot —
  // measured in the live app, 2026-09-21 — so the words are selected and neither end names a
  // second page. Refusing it left the menu offering page items over visibly selected text.
  const clipped = range.cloneRange();
  if (startLayer === null) clipped.setStart(layer, 0);
  if (endLayer === null) clipped.setEnd(layer, layer.childNodes.length);
  const text = clipped.toString().trim();
  if (text === '') return undefined;

  const rects = [...clipped.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  const first = rects[0];
  const last = rects.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const origin = layer.getBoundingClientRect();
  return {
    page: entry.page,
    text,
    from: entry.toPdf(first.left - origin.left, (first.top + first.bottom) / 2 - origin.top),
    to: entry.toPdf(last.right - origin.left, (last.top + last.bottom) / 2 - origin.top),
  };
}

/** One 2d context for measuring text, made on first use; `null` where there is none (happy-dom). */
let measuring: CanvasRenderingContext2D | null | undefined;

/**
 * Scales each line's text horizontally so it spans exactly its box.
 *
 * The page's own font is not available here, so the browser draws each line in a substitute —
 * measured 2026-09-19 on a 16 pt Helvetica line in the live app: the box is 334 px and the
 * substitute runs 437 px, 31% past the ink. Widening the element does not narrow its glyphs, so the
 * text is measured in the font it is actually drawn in and scaled by *box ÷ natural*, which is how
 * PDF.js fits its own text layer.
 *
 * Written onto the elements rather than rendered, because the font it measures in is a computed
 * style that exists only after layout, and a state set from a layout effect to feed it back is a
 * second render React's own lint refuses. `transform` is a property this component's render never
 * sets, so a re-render cannot overwrite it.
 *
 * Where there is no 2d context the lines are left unscaled, which is where they were.
 */
function fitLines(root: HTMLElement): void {
  measuring ??= root.ownerDocument.createElement('canvas').getContext('2d');
  const context = measuring;
  if (context === null) return;
  for (const element of root.querySelectorAll<HTMLElement>('.m-text-line')) {
    const style = getComputedStyle(element);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const natural = context.measureText(element.textContent).width;
    const box = Number.parseFloat(style.width);
    element.style.transform = natural > 0 && box > 0 ? `scaleX(${String(box / natural)})` : '';
  }
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

  // THIS LAYER'S CONVERSION, registered against its element for `readTextSelection`. The same
  // transform the lines below are placed with, so a point read off the layer maps back through
  // exactly the conversion that put the text there.
  useEffect(() => {
    const root = container.current;
    if (root === null) return undefined;
    const shownNow = overlayTransform(geometry);
    LAYERS.set(root, {
      page,
      toPdf: (x, y) => {
        const point = toPdf(viewportPoint(x, y), shownNow);
        return { x: point.x, y: point.y };
      },
    });
    return (): void => {
      LAYERS.delete(root);
    };
  }, [geometry, page, lines.length]);

  // FITTED AFTER LAYOUT AND BEFORE PAINT, so no frame shows the unfitted text under a drag. Again
  // on a new zoom: the font size is the box's height, and the substitute's width does not scale
  // with it exactly.
  useLayoutEffect(() => {
    if (container.current !== null) fitLines(container.current);
  }, [geometry, lines]);
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
