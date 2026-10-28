import { type LineMatch, findInLines, toPdf, viewportPoint } from '@monstera/shared';
import { type ReactElement, useEffect, useLayoutEffect, useRef } from 'react';

import { exactCaretOf, holdAnchorAtPress } from './pressAnchor.js';
import type { OverlayPage } from './annotations/annotationSpace.js';
import { engineBoxOnScreen, overlayTransform } from './annotations/annotationSpace.js';
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
  /**
   * The selected words' boxes on the page as drawn, one per line, in the page's own pixels — the text layer's, which is
   * laid over the page as the held looks are: what a markup's final look covers while the page has not drawn it
   * (ADR-0257). One per line, so overlapping spans of one line do not lay a highlight over itself twice.
   */
  readonly boxes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}

/**
 * Rectangles merged into one box per line: two that overlap by more than half the smaller one's height are on one line,
 * and the line's box spans them both.
 */
function linesOf(rects: readonly { left: number; top: number; right: number; bottom: number }[]): TextSelection['boxes'] {
  const lines: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(
      (each) => Math.min(each.bottom, rect.bottom) - Math.max(each.top, rect.top) > Math.min(each.bottom - each.top, rect.bottom - rect.top) / 2,
    );
    if (line === undefined) {
      lines.push({ ...rect });
      continue;
    }
    line.left = Math.min(line.left, rect.left);
    line.right = Math.max(line.right, rect.right);
    line.top = Math.min(line.top, rect.top);
    line.bottom = Math.max(line.bottom, rect.bottom);
  }
  return lines.map((line) => ({ x: line.left, y: line.top, width: line.right - line.left, height: line.bottom - line.top }));
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
    boxes: linesOf(selectedLines(clipped, layer).map((rect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top }))),
  };
}

/**
 * The selected part of each line the range crosses, on screen: ACROSS from the range's own rectangles in that line, and
 * UP AND DOWN from the line's element, which is placed at the box the engine read for it (`engineBoxOnScreen`). A range's
 * rectangles are the substitute font's line box instead — its top 4 px above the line's on a 28 pt line, read 2026-10-21 by
 * `markLook.pw.ts` at 1600 by 900 — and the quads
 * MuPDF marks are the engine's, so a look drawn from them stood above the words it marks.
 */
function selectedLines(range: Range, layer: Element): { left: number; top: number; right: number; bottom: number }[] {
  const found: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const line of layer.querySelectorAll('[data-text-line]')) {
    if (!range.intersectsNode(line)) continue;
    const part = range.cloneRange();
    if (!line.contains(range.startContainer)) part.setStart(line, 0);
    if (!line.contains(range.endContainer)) part.setEnd(line, line.childNodes.length);
    const across = [...part.getClientRects()].filter((rect) => rect.width > 0);
    if (across.length === 0) continue;
    const box = line.getBoundingClientRect();
    found.push({
      left: Math.min(...across.map((rect) => rect.left)),
      right: Math.max(...across.map((rect) => rect.right)),
      top: box.top,
      bottom: box.bottom,
    });
  }
  return found;
}

/**
 * How far a press may move, across and down, in CSS pixels, and still be a click: Windows' drag rectangle, whose default
 * is 4 pixels each way (`SM_CXDRAG` and `SM_CYDRAG`, Microsoft's `GetSystemMetrics` documentation), the distance a
 * platform drag must go before it begins.
 */
const CLICK_WOBBLE_PX = 4;

/**
 * Keeps a drag's selection on the page's text anchored where the press put it (`holdAnchorAtPress`, the mechanism and
 * its repair), and answers a press on blank space itself.
 *
 * On a line the anchor is the caret at the press's exact point. BESIDE A LINE it is that line's nearest end
 * (`caretBesideLine`): on the layer between lines Chromium places it at the end of the nearest LONG line, and a drag
 * from 1 pt before *This Agreement…* selected nothing, or only the line's last word (measured 2026-10-24).
 *
 * @returns the cleanup that removes every listener this added
 */
export function holdPressedAnchor(root: HTMLElement): () => void {
  const owner = root.ownerDocument;
  /**
   * A press that began off every line's letters, whose selection this owns until the button is let go: where it was
   * pressed, and its anchor — beside a line, that line's nearest end from the press; on blank space, the caret on the
   * line the pointer first reaches (`undefined` until then).
   */
  let blank:
    | { readonly x: number; readonly y: number; anchor: { readonly node: Text; readonly offset: number } | undefined; dragging: boolean }
    | undefined;

  const blankMoved = (event: PointerEvent): void => {
    if (blank === undefined || (event.buttons & 1) === 0) return;
    const selection = owner.getSelection();
    if (selection === null) return;
    // A CLICK'S WOBBLE IS NO DRAG: until the pointer leaves the platform's drag rectangle about the press, the press is a
    // click, and a click on blank space selects nothing. A hand's 1 to 2 px drift from a gap between lines reached the next
    // line's letters and selected one character (measured on the owner's page on Windows, 2026-10-28, `selectProbe`).
    if (!blank.dragging) {
      if (Math.abs(event.clientX - blank.x) < CLICK_WOBBLE_PX && Math.abs(event.clientY - blank.y) < CLICK_WOBBLE_PX) {
        selection.removeAllRanges();
        return;
      }
      blank.dragging = true;
    }
    const line = event.target instanceof Element ? event.target.closest('[data-text-line]') : null;
    const exact = line !== null && typeof owner.caretPositionFromPoint === 'function' ? owner.caretPositionFromPoint(event.clientX, event.clientY) : null;
    const onLetters = exact !== null && exact.offsetNode.nodeType === Node.TEXT_NODE && root.contains(exact.offsetNode) ? { node: exact.offsetNode as Text, offset: exact.offset } : null;
    // NOTHING IS SELECTED UNTIL THE POINTER REACHES A LINE'S LETTERS: blank space and a line's band beside its end are
    // no text crossed (the local agent's gesture, 2026-10-27: a press right of a short line's end, drifting down into its
    // band, selected from the page's first character to that line's end). Then the anchor is that line's caret where
    // the press was across, so the drag selects what it crossed of the line it reached.
    if (blank.anchor === undefined) {
      if (onLetters === null || line === null) {
        selection.removeAllRanges();
        return;
      }
      blank.anchor = caretOnLine(line, blank.x) ?? onLetters;
    }
    // ONCE STARTED, the moving end is the letter under the pointer, or beside a line in its band that line's nearest end
    // (`caretBesideLine`, F1's rule for a drag past a line's end); over blank space it holds where it was.
    const focus = onLetters ?? caretBesideLine(root, event.clientX, event.clientY);
    if (focus === null) return;
    if (focus.node === blank.anchor.node && focus.offset === blank.anchor.offset) {
      selection.removeAllRanges();
      return;
    }
    selection.setBaseAndExtent(blank.anchor.node, blank.anchor.offset, focus.node, focus.offset);
  };
  const blankReleased = (): void => {
    blank = undefined;
    owner.removeEventListener('pointermove', blankMoved, true);
    owner.removeEventListener('pointerup', blankReleased, true);
    owner.removeEventListener('pointercancel', blankReleased, true);
  };
  /**
   * A press on BLANK SPACE — on no line, and in no line's band — is this layer's, not the browser's: the browser puts its
   * caret at the layer's start, the first line's first letter, measured 2026-10-27 in Chromium 151 at every blank point
   * of a page, and the local agent measured on Windows that a drift then selected from there, everything from the page's
   * top (1,252 characters in its probe; a heading and a paragraph in the owner's video). So the press selects nothing
   * until the pointer reaches a line's letters, and then from that line where the press was across ({@link caretOnLine})
   * to the pointer: what it crossed. The browser's own handling of the press is cancelled, so no platform's version of it
   * can differ.
   * The focus goes where the press would have taken it: the nearest focusable ancestor, else nowhere.
   */
  const pressedOnBlank = (event: PointerEvent, beside?: { readonly node: Text; readonly offset: number }): boolean => {
    event.preventDefault();
    owner.getSelection()?.removeAllRanges();
    const holder = root.parentElement?.closest<HTMLElement>('[tabindex]');
    if (holder !== null && holder !== undefined) holder.focus({ preventScroll: true });
    else if (owner.activeElement instanceof HTMLElement) owner.activeElement.blur();
    blank = { x: event.clientX, y: event.clientY, anchor: beside, dragging: false };
    owner.addEventListener('pointermove', blankMoved, true);
    owner.addEventListener('pointerup', blankReleased, true);
    owner.addEventListener('pointercancel', blankReleased, true);
    return true;
  };

  // ON A LINE, the caret at the exact point (absent in happy-dom, where the press is the platform's alone). OFF EVERY
  // LINE'S LETTERS the press is this layer's own: on blank space with no anchor until the drag reaches letters, and
  // BESIDE a line with that line's nearest end as its anchor from the press. A press beside a line is on the layer, not
  // on a line, so the browser parks its caret at the page's first letter for it exactly as for a blank press; left to
  // the browser, the line-end follower extended that caret to the line's end — a press in a gap of one column that lay in
  // the band of a line in another selected 1,252 characters from the top of the owner's page (2026-10-28).
  const unhold = holdAnchorAtPress(root, (event) => {
    const place = pressPlace(root, event);
    if (place === 'line') return exactCaretOf(event);
    pressedOnBlank(event, place === 'blank' ? undefined : place);
    return null;
  });
  return (): void => {
    unhold();
    blankReleased();
  };
}

/**
 * Where a press landed: on a line, beside one in its band (that line's nearest end, {@link caretBesideLine}), or on blank
 * space. The one answer both {@link holdPressedAnchor} and {@link followPastLineEnds} take, so a press the first treats as
 * blank is one the second never extends.
 */
function pressPlace(root: Element, event: PointerEvent): 'line' | 'blank' | { readonly node: Text; readonly offset: number } {
  // ON A LINE means inside the box the engine read for it, not merely on its element: the line's letters are laid out in
  // a substitute face whose line box stands above that box, so a press on blank paper just over a line hits its element,
  // and as a press on the line it went to the browser, which took a click's 1 to 2 px wobble for a drag and selected a
  // letter (the owner's page on Windows, 2026-10-28).
  const line = event.target instanceof Element ? event.target.closest('[data-text-line]') : null;
  if (line !== null) {
    const box = line.getBoundingClientRect();
    if (event.clientY >= box.top && event.clientY <= box.bottom) return 'line';
  }
  return caretBesideLine(root, event.clientX, event.clientY) ?? 'blank';
}

/**
 * The caret on one line at a point across it: the line's start before its left edge, its end past its right, and between
 * them the letter under the point; `null` for a line with no text. Where a press on blank space anchors once the drag
 * reaches that line ({@link holdPressedAnchor}).
 */
export function caretOnLine(line: Element, x: number): { readonly node: Text; readonly offset: number } | null {
  const first = line.firstChild;
  if (first?.nodeType !== Node.TEXT_NODE) return null;
  const node = first as Text;
  const box = line.getBoundingClientRect();
  if (x <= box.left) return { node, offset: 0 };
  if (x >= box.right) return { node, offset: node.length };
  // THE LETTER UNDER THE POINT ACROSS, asked on the line's own middle, where the browser's hit test meets its text.
  const owner = line.ownerDocument;
  const hit = typeof owner.caretPositionFromPoint === 'function' ? owner.caretPositionFromPoint(x, (box.top + box.bottom) / 2) : null;
  if (hit?.offsetNode === node) return { node, offset: hit.offset };
  return { node, offset: Math.round(((x - box.left) / (box.right - box.left)) * node.length) };
}

/**
 * The caret a point BESIDE a line means: the end of the line whose band holds the point, nearest it across, where the
 * point is past that line's right edge, and its start where the point is before its left. `null` where no line's band
 * holds the point, which is between two lines or beyond the last.
 *
 * Bands are the lines' elements on screen, so the rule reads the boxes the engine reported, in whatever zoom and turn
 * the page is shown at. Where two bands hold the point (a paragraph's boxes overlap by a point), the line whose middle is
 * nearer is the one meant.
 */
export function caretBesideLine(root: Element, x: number, y: number): { readonly node: Text; readonly offset: number } | null {
  let best: { readonly node: Text; readonly offset: number; readonly across: number; readonly down: number } | null = null;
  for (const line of root.querySelectorAll('[data-text-line]')) {
    const node = line.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE) continue;
    const box = line.getBoundingClientRect();
    if (y < box.top || y > box.bottom) continue;
    const across = x > box.right ? x - box.right : x < box.left ? box.left - x : 0;
    const down = Math.abs(y - (box.top + box.bottom) / 2);
    if (best !== null && (across > best.across || (across === best.across && down >= best.down))) continue;
    const text = node as Text;
    best = { node: text, offset: x < box.left ? 0 : text.length, across, down };
  }
  return best === null ? null : { node: best.node, offset: best.offset };
}

/**
 * Takes a drag's moving end to the end of the line it runs past, which the gap cover alone does not.
 *
 * ## The mechanism, measured 2026-10-24 in Chromium 151
 *
 * Past a line's right edge the pointer is over `.m-text-layer__gaps`, which is not selectable, so Chromium leaves the
 * selection where the LAST move event over the line put it. A move event is a sample of the pointer, not every pixel it
 * crosses, so that event can be a word or two before the end: a drag from the start of *…continue for the term of* to
 * 3 pt past its end, in 20 moves, selected up to *term* and marked nothing of *of*, while a 16 character line in the
 * same 20 moves was whole. The text was not short — each line's text ended within 0.01 px of its box — and the
 * selection, the copy and the markup made from it all lost the same words.
 *
 * So over the cover, the moving end is placed by {@link caretBesideLine}: past a line's end within its band, the end of
 * that line. Between two lines nothing is placed and the selection still holds, which is what the cover is for.
 *
 * **Never on the first drag event,** for {@link holdPressedAnchor}'s reason: that event decides whether the press drags
 * selected text, so the moving end is touched only once Chromium has already made that decision.
 *
 * **Only a selection this press began on a line, or beside one in its band.** A press on the layer outside every band
 * leaves the platform's caret at the page's first letter, and extending that caret to a line's end selected everything
 * from the page's top to there: 318 to 1,155 characters for a press between two lines, right of a short line's end,
 * drifting 1 to 3 px down into its band (the local agent's measurement on Windows, 2026-10-27, in every build since
 * this follower was added). Such a press is {@link holdPressedAnchor}'s to answer, and it selects only what it crosses.
 *
 * @returns the cleanup that removes every listener this added
 */
export function followPastLineEnds(root: HTMLElement): () => void {
  let moves = 0;
  let besideText = false;
  const pressed = (event: PointerEvent): void => {
    moves = 0;
    besideText = pressPlace(root, event) !== 'blank';
  };
  const moved = (event: PointerEvent): void => {
    if ((event.buttons & 1) === 0 || !besideText) return;
    moves += 1;
    if (moves < 2) return;
    if (!(event.target instanceof Element) || event.target.closest('.m-text-layer__gaps') === null) return;
    const selection = root.ownerDocument.getSelection();
    const anchor = selection?.anchorNode ?? null;
    if (selection === null || anchor === null || !root.contains(anchor)) return;
    const caret = caretBesideLine(root, event.clientX, event.clientY);
    if (caret === null) return;
    if (selection.focusNode === caret.node && selection.focusOffset === caret.offset) return;
    selection.extend(caret.node, caret.offset);
  };
  root.addEventListener('pointerdown', pressed);
  root.addEventListener('pointermove', moved);
  return (): void => {
    root.removeEventListener('pointerdown', pressed);
    root.removeEventListener('pointermove', moved);
  };
}

/**
 * Scales each line's text horizontally so it spans exactly its box.
 *
 * The page's own font is not available here, so the browser draws each line in a substitute —
 * measured 2026-09-19 on a 16 pt Helvetica line in the live app: the box is 334 px and the
 * substitute runs 437 px, 31% past the ink. Widening the element does not narrow its glyphs, so the
 * text is measured as it is laid out and scaled by *box ÷ natural*, which is how PDF.js fits its own
 * text layer.
 *
 * **The natural width is the DOM's own layout of the line, read through a range**, never a canvas's
 * measure of the same string: the two lay text out by different rules, and where they differ the
 * fitted line ends short of its box. Measured 2026-10-24 in Chromium 151 on an 80 character line at
 * 14 px: a canvas read 467.40 px where the line laid out at 466.64 in `serif`, and 512.57 where it
 * laid out at 511.80 in `sans-serif`, so the line ended 0.6 px inside its box and a whole line's
 * selection, and the markup made from it, ended there. In `monospace` the two agreed.
 *
 * Every transform is cleared, then every line read, then every line written, so the page lays out
 * once for all its lines rather than once per line.
 *
 * Written onto the elements rather than rendered, because the width it measures exists only after
 * layout, and a state set from a layout effect to feed it back is a second render React's own lint
 * refuses. `transform` is a property this component's render never sets, so a re-render cannot
 * overwrite it.
 *
 * Where nothing is laid out (happy-dom answers every range with an empty box) the lines are left
 * unscaled, which is where they were.
 */
function fitLines(root: HTMLElement): void {
  const lines = [...root.querySelectorAll<HTMLElement>('.m-text-line')];
  for (const element of lines) element.style.transform = '';
  const range = root.ownerDocument.createRange();
  const measured = lines.map((element) => {
    range.selectNodeContents(element);
    return { natural: range.getBoundingClientRect().width, box: Number.parseFloat(getComputedStyle(element).width) };
  });
  lines.forEach((element, at) => {
    const { natural = 0, box = 0 } = measured[at] ?? {};
    element.style.transform = natural > 0 && box > 0 ? `scaleX(${String(box / natural)})` : '';
  });
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

  // A DRAG KEEPS ITS PRESS (`holdPressedAnchor`): on this element, so a press anywhere else is the platform's alone.
  // Keyed on whether the element exists, which is whether there are lines (the early return below), and not on
  // their count, so a version that changes the count mid-drag does not drop the press.
  const hasLines = lines.length > 0;
  useEffect(() => {
    const root = container.current;
    return root === null ? undefined : holdPressedAnchor(root);
  }, [hasLines]);
  // AND ITS MOVING END REACHES THE END OF A LINE IT RUNS PAST (`followPastLineEnds`), keyed as the press is.
  useEffect(() => {
    const root = container.current;
    return root === null ? undefined : followPastLineEnds(root);
  }, [hasLines]);

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

  return (
    <div className="m-text-layer" data-text-layer={String(page)} ref={container}>
      {/* FIRST, so every line paints and hit-tests above it: what a drag meets between the lines (`.m-text-layer__gaps`). */}
      <div className="m-text-layer__gaps" aria-hidden="true" />
      {lines.map((line, index) => {
        // Display space to PDF user space, then PDF to the viewport: `engineBoxOnScreen`, the one conversion every
        // layer drawing an engine box takes.
        const { left, top, width, height } = engineBoxOnScreen(line.box, geometry);

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
