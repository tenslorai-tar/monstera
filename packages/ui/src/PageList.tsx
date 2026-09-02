import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { FIRST_PAGE, pdfjsPageOf } from './pageNumbering.js';
import { renderPage } from './renderPage.js';
import { type Box, type ZoomMode, resolveZoom, zoomInFrom, zoomOutFrom } from './zoom.js';

/**
 * Continuous scroll, with each page rasterised only while it is near the
 * viewport.
 *
 * ## Why an IntersectionObserver rather than a scroll handler
 *
 * A scroll handler runs on the main thread at the frequency the user scrolls
 * and then has to work out what is visible from geometry it reads back — which
 * is a layout read per event, in the frame that is already trying to draw. An
 * observer is told by the browser, off that path, and answers the question
 * directly. The row names it for that reason and this does not second-guess it.
 *
 * ## Slots exist before pages do, and that is what makes the scrollbar honest
 *
 * Every page gets an element from the first render, sized before anything is
 * rasterised — so the scrollbar describes the document rather than the part of
 * it that has been drawn, and it does not lurch as pages arrive.
 *
 * **The height is an ESTIMATE until a page has been drawn once, and it is an
 * estimate rather than a measurement on purpose.** Asking PDF.js for every
 * page's viewport up front is `getPage` per page, which parses every page
 * dictionary at open — the cost lazy rendering exists to avoid. So an unvisited
 * slot takes the last known page size, and a drawn one takes its own. Nothing
 * downstream depends on the estimate being right: the slot is corrected the
 * moment its page renders, and the only visible consequence is that a document
 * whose pages differ in size adjusts its scrollbar as those pages are visited.
 *
 * Stated rather than hidden, because it is the one modelled number here.
 *
 * ## RELEASED WHEN IT LEAVES, which is the whole memory story
 *
 * A viewer that rasterises on the way in and never releases holds every page the
 * user has passed — a bitmap per page, at device resolution, for the life of the
 * document. §9.17's renderer budget is *provisional and two-term* precisely
 * because of this cache, and its absolute term is a bitmap-cache cap. What ships
 * here is the discipline that term will measure: a canvas is dropped when its
 * slot leaves the margin, so what is resident tracks the window rather than the
 * history.
 *
 * ## The margin is one viewport, and it is a trade rather than a tuning
 *
 * Rendering exactly what is visible means a page arrives blank and fills in
 * after the scroll stops. One viewport of margin either side renders the page
 * about to be reached before it is reached. Larger margins buy smoother
 * scrolling with more resident bitmaps, which is the axis E1 tier-1's cache cap
 * will decide against a measurement; this is the smallest value that hides the
 * common case.
 */
export interface PageListProps {
  readonly client: ContractClient;
  /**
   * The parser, once it is open. **Slots exist without it.**
   *
   * A viewer that rendered nothing until the parse completed would show an empty
   * surface for as long as a large document takes to open, and would make the
   * scrollbar appear at the end rather than the start. The list is the document's
   * shape, which the view model already answered; the view is what fills it.
   */
  readonly view: DocumentView | undefined;
  /** How many pages the document has, from the view model. */
  readonly pageCount: number;
  readonly docId: DocId;
  readonly version: DocVersion;
  /** Told which page the user is looking at, zero-based. */
  readonly onCurrentPage: (page: number) => void;
  /**
   * What the reader asked for — a scale, or a fit.
   *
   * A MODE rather than a number, because a fit has no number until this
   * component has measured its own box and a page's. See `zoom.ts`.
   */
  readonly mode: ZoomMode;
  /** Asks for a new mode, given the scale currently shown. */
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
  /**
   * Reports the scale a fit resolved to.
   *
   * The owner holds the mode and cannot resolve it, so without this the `±`
   * commands would have no number to step from at fit-width — they would step
   * from the last explicit scale, which is not what the reader can see.
   */
  readonly onShownZoom: (shown: number) => void;
}

/**
 * How long a zoom must settle before the pages are drawn again.
 *
 * **The row's number, not one invented here**: *"instant CSS stretch + 150 ms
 * debounced true re-render"*. It is the interval a gesture is allowed to be
 * cheap for, and E1 permits the stretch only transiently — so the debounce is
 * what guarantees the *transiently*.
 */
const RERENDER_AFTER_MS = 150;

/** How much either side of the viewport counts as *about to be seen*. */
const MARGIN = '100%';

/**
 * A page's bitmap, and the scale it was drawn at.
 *
 * **The scale is what makes the stretch computable.** A page's CSS size at any
 * zoom is `bitmap ÷ drawnAt × (devicePixelRatio × zoom)`, so a bitmap drawn at
 * one zoom can be displayed at another — which is the first tier. Storing only
 * the pixel size would leave the ratio unrecoverable and the stretch would have
 * to guess.
 */
interface Measured {
  readonly width: number;
  readonly height: number;
  /** `devicePixelRatio × zoom` at the moment this bitmap was rasterised. */
  readonly drawnAt: number;
}

/**
 * Device pixels per CSS pixel, read at the point of use.
 *
 * Not cached: a window moved between a 1× and a 2× display changes it, and a
 * value captured at mount would render every later page at the old density —
 * which is E1's *pixel-exact at every zoom on every display* failing on the one
 * event that makes it interesting.
 */
function devicePixels(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}

export function PageList({
  client,
  view,
  pageCount,
  docId,
  version,
  onCurrentPage,
  mode,
  onZoom,
  onShownZoom,
}: PageListProps): ReactElement {
  const slots = useRef(new Map<number, HTMLElement>());
  const scroller = useRef<HTMLDivElement | null>(null);
  /**
   * The scroller's own box, remeasured whenever it changes.
   *
   * **A `ResizeObserver` and not a `resize` listener on the window**: the box
   * that matters is this element's, and it changes for reasons the window does
   * not see — a sidebar opening, a panel resizing, a font loading. A window
   * listener would answer for three of those and miss the rest, which is a fit
   * that is correct until the first time the layout moves without the window.
   *
   * `undefined` until the first observation, which `resolveZoom` treats as *no
   * answer yet* rather than as a box of zero.
   */
  const [viewport, setViewport] = useState<Box | undefined>(undefined);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const seen = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box !== undefined) setViewport({ width: box.width, height: box.height });
    });
    seen.observe(element);
    return (): void => {
      seen.disconnect();
    };
  }, []);

  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([FIRST_PAGE.kernel]));
  const [sizes, setSizes] = useState<ReadonlyMap<number, Measured>>(new Map());

  /**
   * The page's box at scale 1, which is the other half of a fit.
   *
   * A bitmap divided by the scale it was drawn at IS the page in CSS pixels,
   * which is what `Measured` carries `drawnAt` for — so the fit costs no extra
   * measurement and cannot disagree with what is on screen.
   *
   * **Undefined before anything has drawn**, so a fit has no answer then; that
   * is correct rather than a gap, because there is no page to fit yet.
   *
   * **The FIRST measured page and not the current one**, which is a limitation
   * and is stated: a document whose pages differ in size will fit to the first
   * one visited rather than to the page under the reader. Fixing that means the
   * fit changing as the reader scrolls, which is a design question about
   * whether *fit* follows the page or the document, and is not answered here.
   */
  const pageBox = useMemo((): Box | undefined => {
    const [first] = [...sizes.values()];
    return first === undefined
      ? undefined
      : { width: first.width / first.drawnAt, height: first.height / first.drawnAt };
  }, [sizes]);

  /**
   * What the reader's mode resolves to, right now.
   *
   * A fit that cannot be answered falls back to **1**, and that fallback is the
   * one place this component draws a zoom nobody asked for. It is bounded to
   * the frames before the first page has been measured — a fit needs a page,
   * and a page has to be drawn once at some scale for there to be one.
   */
  const shown = resolveZoom(mode, viewport, pageBox) ?? 1;

  /**
   * The zoom the pages are actually rasterised at, which lags `shown`.
   *
   * **The two tiers are these two numbers.** `shown` moves the moment a reader
   * asks — or the moment a resize changes what a fit means — and the browser
   * stretches the bitmap it already has; `renderZoom` follows once things
   * settle, and the page is redrawn at `devicePixelRatio × renderZoom`, one
   * device pixel per bitmap pixel, which is E1's bar.
   *
   * **A RESIZE FEEDS THE SAME DEBOUNCE**, which is the reason this is derived
   * from `shown` rather than from the mode: dragging a window edge at fit-width
   * produces a continuous stream of new scales, and rasterising each one would
   * redraw every visible page per pixel of drag. The stretch covers the drag
   * and one true render lands when it stops — the same mechanism the ± ladder
   * already used, for free.
   */
  const [renderZoom, setRenderZoom] = useState(shown);

  useEffect(() => {
    if (renderZoom === shown) return;
    const timer = setTimeout(() => {
      setRenderZoom(shown);
    }, RERENDER_AFTER_MS);
    // CLEARED ON EVERY CHANGE, which is what makes this a debounce rather than
    // a throttle: a reader stepping the zoom five times gets one re-render, not
    // five, and the interval restarts from the last step.
    return (): void => {
      clearTimeout(timer);
    };
  }, [renderZoom, shown]);

  // Told upward so the commands can step the ladder from what is on screen. A
  // fit's number lives here and nowhere else, so a `+` pressed at fit-width
  // would otherwise step from a mode that has no number.
  useEffect(() => {
    onShownZoom(shown);
  }, [onShownZoom, shown]);

  /**
   * Ctrl+scroll, which is a zoom rather than a scroll.
   *
   * `preventDefault` is what stops the browser's own page zoom, which would
   * scale the whole shell — chrome and all — instead of the document.
   *
   * **React's `onWheel` is passive on the root in some builds**, and a passive
   * listener cannot preventDefault. It is attached here rather than through an
   * explicit non-passive `addEventListener` because the element is not the
   * document root, where that default applies; if a browser is ever observed
   * ignoring it, the fix is an effect with `{ passive: false }` and not a
   * different gesture.
   */
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // DIRECTION ONLY. A wheel's `deltaY` is in units that differ by device
      // and by `deltaMode`, so treating its magnitude as an amount makes a
      // trackpad and a mouse zoom at different rates. The ladder is the amount.
      onZoom(event.deltaY < 0 ? zoomInFrom : zoomOutFrom);
    },
    [onZoom],
  );
  /**
   * What is known about each visible page's rotation.
   *
   * **Presence means ANSWERED, and the value may still be `undefined`** — which
   * is three states in a shape that looks like two, and each one is load-bearing:
   *
   * - absent: not asked yet, or in flight. **The page does not draw.**
   * - present and a number: the model said so; draw with it.
   * - present and `undefined`: the model was refused, or described another
   *   version. Draw with the page's own `/Rotate`, which is what this renderer
   *   actually knows — never a flat `0`.
   *
   * The first state is the one that matters and it is finding RRRRR-2 arriving
   * in a scroller. Drawing before the answer paints the page at its stored
   * rotation and repaints it a frame later at the real one, which is the *frame
   * of wrong geometry* the single-page version read the model first to avoid.
   * A `Map<number, number>` cannot express *answered, and the answer is nothing*,
   * so it would have made that flash unavoidable.
   */
  const [rotations, setRotations] = useState<ReadonlyMap<number, number | undefined>>(new Map());

  /**
   * Registers a slot with the observer.
   *
   * A callback ref rather than an array of refs: React calls it with `null` on
   * unmount, which is the one moment the observer must stop watching an element
   * that no longer exists.
   */
  const observer = useRef<IntersectionObserver | null>(null);

  const slotRef = useCallback((page: number) => {
    return (element: HTMLElement | null): void => {
      const known = slots.current.get(page);
      if (known !== undefined && observer.current !== null) observer.current.unobserve(known);
      if (element === null) {
        slots.current.delete(page);
        return;
      }
      slots.current.set(page, element);
      element.dataset['page'] = String(page);
      if (observer.current !== null) observer.current.observe(element);
    };
  }, []);

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const page = Number(
              entry.target instanceof HTMLElement ? (entry.target.dataset['page'] ?? '-1') : '-1',
            );
            if (!Number.isInteger(page) || page < 0) continue;
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { rootMargin: MARGIN },
    );
    observer.current = seen;
    for (const element of slots.current.values()) seen.observe(element);

    return (): void => {
      seen.disconnect();
      observer.current = null;
    };
    // Rebuilt when the document changes, because the slots do: an observer
    // holding elements from a closed document keeps them alive and reports
    // intersections for pages nothing will draw.
  }, [docId, version]);

  /**
   * The rotations for the pages about to be drawn.
   *
   * **Named rather than *all*, which is invariant L11**: one rotation per page
   * scales with the document, so a read of the whole vector would put a
   * document-sized payload on the path a renderer takes after every command.
   * The window is what is visible, which is what the channel was built to be
   * asked for.
   */
  useEffect(() => {
    let cancelled = false;
    const wanted = [...visible].filter((page) => !rotations.has(page)).sort((a, b) => a - b);
    if (wanted.length === 0) return;

    const read = async (): Promise<void> => {
      const answer = await client['document.viewModel']({ docId, pages: wanted });
      if (cancelled) return;

      // A MODEL FROM ANOTHER VERSION IS NOT DRAWN WITH, and neither is a refused
      // one. A command can bump the version while this read is in flight, and a
      // stale rotation over a current page is the class of defect
      // `document.readRange` refuses a range for (ADR-0031) — with nothing
      // thrown, so the comparison is the whole guard.
      //
      // **Both still mark the page ANSWERED.** The page must draw: what this
      // renderer knows in that case is *nothing about the rotation*, and PDF.js
      // falling back to the page's own `/Rotate` is that stated correctly.
      // Leaving them absent would hold the page blank for ever on any document
      // whose model cannot be read.
      const usable = answer.ok && answer.value.version === version;
      setRotations((current) => {
        const next = new Map(current);
        for (const [index, page] of wanted.entries()) {
          next.set(page, usable ? answer.value.rotations[index] : undefined);
        }
        return next;
      });
    };
    void read();

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, rotations, version, visible]);

  /**
   * What a slot reports after drawing, as ONE stable callback.
   *
   * **A new arrow per slot per render re-rasterises every visible page on every
   * render of this component**, because it is in the slot's effect dependencies.
   * Measured: the page drew twice for one visible page, which is a full
   * re-render of a bitmap for a parent state change that had nothing to do with
   * it — and on a scroller, parent state changes constantly.
   *
   * Takes the page as an argument rather than closing over it, which is what
   * lets it be stable at all.
   */
  const measured = useCallback((page: number, size: Measured): void => {
    setSizes((current) => {
      // UNCHANGED SIZE, UNCHANGED MAP. Returning a new map for an equal value
      // sets state on every draw, which re-renders, which redraws.
      const known = current.get(page);
      if (known?.width === size.width && known.height === size.height) return current;
      return new Map(current).set(page, size);
    });
  }, []);

  /** The page occupying the most of the viewport, as the current one. */
  useEffect(() => {
    // TOPMOST OF THE VISIBLE SET, not the most-covered one. Most-covered needs a
    // measurement per page per scroll and answers differently for a page taller
    // than the viewport, where nothing is ever "most" covered. The topmost
    // visible page is what a reader means by "the page I am on" and it is
    // already known here.
    const [first] = [...visible].sort((a, b) => a - b);
    if (first !== undefined) onCurrentPage(first);
  }, [onCurrentPage, visible]);

  return (
    <div className="m-page-list" ref={scroller} onWheel={onWheel}>
      {Array.from({ length: pageCount }, (_, page) => (
        <PageSlot
          key={page}
          page={page}
          ref={slotRef(page)}
          view={view}
          // `has`, not a truthy `get`: a page answered with `undefined` is
          // answered, and a page answered with `0` is upright. Both draw.
          draw={visible.has(page) && rotations.has(page)}
          rotation={rotations.get(page)}
          size={sizes.get(page) ?? lastKnownBefore(sizes, page)}
          zoom={shown}
          renderZoom={renderZoom}
          onMeasured={measured}
        />
      ))}
    </div>
  );
}

/**
 * The nearest measured page before `page`, as the estimate for an unvisited one.
 *
 * Before, rather than nearest in either direction: a document is read forwards,
 * so the page above the one being estimated is the one most likely to share its
 * size, and it is the one already drawn.
 */
function lastKnownBefore(
  sizes: ReadonlyMap<number, Measured>,
  page: number,
): Measured | undefined {
  for (let index = page - 1; index >= 0; index -= 1) {
    const known = sizes.get(index);
    if (known !== undefined) return known;
  }
  return sizes.get(0);
}

/**
 * One page's slot: an element that always exists, and a canvas that does not.
 *
 * The canvas is unmounted when the page leaves the margin, which is what
 * releases the bitmap — clearing a canvas by setting `width = 0` keeps the
 * element and its backing store alive, and this is the one place that matters.
 */
function PageSlot({
  page,
  ref,
  view,
  draw,
  rotation,
  size,
  zoom,
  renderZoom,
  onMeasured,
}: {
  readonly page: number;
  readonly ref: (element: HTMLElement | null) => void;
  readonly view: DocumentView | undefined;
  readonly draw: boolean;
  readonly rotation: number | undefined;
  readonly size: Measured | undefined;
  readonly zoom: number;
  readonly renderZoom: number;
  readonly onMeasured: (page: number, measured: Measured) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  /**
   * What the page occupies on screen, in CSS pixels, at the CURRENT zoom.
   *
   * The bitmap may have been drawn at another one — that is the whole of the
   * first tier — so the ratio between them is what the browser stretches by.
   * `undefined` until a page has been drawn once, where the slot's minimum size
   * stands in.
   */
  const shown =
    size === undefined
      ? undefined
      : {
          width: (size.width / size.drawnAt) * zoom,
          height: (size.height / size.drawnAt) * zoom,
        };

  useEffect(() => {
    // THE CANVAS EXISTS WITHOUT A VIEW and stays blank, which is what lets the
    // surface have a shape while the parse is still running. Drawing is what
    // waits, not the element.
    if (!draw || view === undefined) return;
    let cancelled = false;

    const drawPage = async (): Promise<void> => {
      const target = canvas.current;
      if (target === null) return;
      // EXACTLY `devicePixelRatio × zoom`, which is E1's first rule: one bitmap
      // pixel per device pixel. Supersampling and letting CSS shrink the result
      // is what blurs text, and E1 keeps it as an explicit `renderQuality`
      // setting rather than a default — so nothing here multiplies it.
      const scale = devicePixels() * renderZoom;
      const drawn = await renderPage(
        view.document,
        pdfjsPageOf(page),
        target,
        scale,
        // `undefined` where the model has not answered yet, which hands PDF.js
        // the page's own `/Rotate`. A flat zero would silently flatten every
        // document that arrives already turned.
        rotation,
      );
      if (cancelled) return;
      onMeasured(page, { width: drawn.width, height: drawn.height, drawnAt: scale });
    };

    void drawPage().catch(() => {
      // A PAGE THAT WILL NOT DRAW SAYS SO, on the element itself.
      //
      // This was a bare swallow, and the swallow is the reassuring answer: a
      // blank slot is what a page still rendering looks like, so a page that
      // threw was indistinguishable from one that had not finished — for ever,
      // and to every observer including `canvasHarness.ts`, which waits sixty
      // seconds and then reports a bound it cannot interpret.
      //
      // One page, not a broken document, so the marker is on the canvas rather
      // than on the surface — but it is *a* marker, which is the difference
      // between a state and a silence.
      if (!cancelled && canvas.current !== null) canvas.current.dataset['failed'] = 'true';
    });

    return (): void => {
      cancelled = true;
    };
  }, [draw, onMeasured, page, renderZoom, rotation, view]);

  return (
    <div
      className="m-page-slot"
      ref={ref}
      style={shown === undefined ? undefined : { width: shown.width, height: shown.height }}
    >
      {draw ? (
        <canvas
          className="m-page"
          data-page-canvas={String(page)}
          ref={canvas}
          // THE FIRST TIER. The backing store is whatever the last rasterisation
          // produced; these are what the browser paints it into. While the two
          // agree the page is 1:1 device pixels, and while a zoom is settling
          // they do not — which is the stale bitmap E1 permits transiently, and
          // `renderZoom` is what makes it transient.
          style={shown === undefined ? undefined : { width: shown.width, height: shown.height }}
        />
      ) : null}
    </div>
  );
}
