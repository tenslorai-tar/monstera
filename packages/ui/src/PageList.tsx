import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { FIRST_PAGE, pdfjsPageOf } from './pageNumbering.js';
import { renderPage } from './renderPage.js';

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
}

/** How much either side of the viewport counts as *about to be seen*. */
const MARGIN = '100%';

/** A page's size, once something has drawn it. */
interface Measured {
  readonly width: number;
  readonly height: number;
}

export function PageList({
  client,
  view,
  pageCount,
  docId,
  version,
  onCurrentPage,
}: PageListProps): ReactElement {
  const slots = useRef(new Map<number, HTMLElement>());
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([FIRST_PAGE.kernel]));
  const [sizes, setSizes] = useState<ReadonlyMap<number, Measured>>(new Map());
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
    <div className="m-page-list">
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
  onMeasured,
}: {
  readonly page: number;
  readonly ref: (element: HTMLElement | null) => void;
  readonly view: DocumentView | undefined;
  readonly draw: boolean;
  readonly rotation: number | undefined;
  readonly size: Measured | undefined;
  readonly onMeasured: (page: number, measured: Measured) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // THE CANVAS EXISTS WITHOUT A VIEW and stays blank, which is what lets the
    // surface have a shape while the parse is still running. Drawing is what
    // waits, not the element.
    if (!draw || view === undefined) return;
    let cancelled = false;

    const drawPage = async (): Promise<void> => {
      const target = canvas.current;
      if (target === null) return;
      const drawn = await renderPage(
        view.document,
        pdfjsPageOf(page),
        target,
        1,
        // `undefined` where the model has not answered yet, which hands PDF.js
        // the page's own `/Rotate`. A flat zero would silently flatten every
        // document that arrives already turned.
        rotation,
      );
      if (cancelled) return;
      onMeasured(page, { width: drawn.width, height: drawn.height });
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
  }, [draw, onMeasured, page, rotation, view]);

  return (
    <div
      className="m-page-slot"
      ref={ref}
      style={size === undefined ? undefined : { width: size.width, height: size.height }}
    >
      {draw ? <canvas className="m-page" data-page-canvas={String(page)} ref={canvas} /> : null}
    </div>
  );
}
