import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { THUMBNAILS_LABEL, THUMBNAIL_PAGE } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { RenderCancelledError, renderPage } from './renderPage.js';
import { THUMBNAIL_SIZES, type ThumbnailSize } from './settings/appearance.js';
import { type MenuAt, inPageMenu } from './surfaces/ContextMenu.js';
import { usePageRotations } from './usePageRotations.js';
import { useVisiblePages } from './useVisiblePages.js';

/**
 * The page thumbnails, down the side.
 *
 * ## Lazy on the SAME mechanism the spine uses
 *
 * `useVisiblePages` answers *which pages are near this container's viewport*,
 * and both surfaces ask it. They cannot literally share an observer — one is
 * bound to a root and these are two scroll containers — but a second
 * implementation here would be a second opinion about what *near* means, and
 * the two would drift on the margin, the teardown and the seeding (B3a).
 *
 * The margin is smaller than the spine's: a thumbnail is cheap to draw and
 * cheap to hold, and a sidebar that filled in visibly as the reader dragged its
 * scrollbar would be worse than one that renders a little ahead.
 *
 * ## Each is a BUTTON, which is what makes click-to-jump exist
 *
 * A thumbnail that only displayed would be the display-only defect §10.4 names.
 * Clicking one jumps, through the same `jumpTo` the navigation commands use, so
 * the history records it the same way — there is no second notion of *the
 * reader went somewhere*.
 *
 * ## Drag-reorder dispatches a COMMAND, which is what took it until Stage 2
 *
 * This section used to say drag-reorder was absent because *"a drag that
 * rearranged thumbnails without a command would be a sidebar disagreeing with
 * the document it describes"*. That is still the reason it could not land
 * earlier, and it is now satisfied rather than outstanding: a drop sends
 * `movePage` through `document.execute`, the version moves, and the strip
 * re-renders from the document. Nothing here holds an order of its own.
 *
 * ## THE KEYBOARD PATH IS NOT AN EXTRA, it is the same feature
 *
 * HTML5 drag and drop is mouse-only: there is no keyboard sequence that
 * produces `dragstart`. A reorder available solely by dragging is a mutation a
 * keyboard user cannot perform, which B9 makes a defect rather than a gap —
 * *a11y is substrate, not a feature*. **Alt+ArrowUp/ArrowDown** moves the
 * focused page by one, dispatching exactly the command a drop dispatches.
 *
 * Alt because the bare arrows belong to the strip's own focus movement and
 * Shift+Arrow is selection; Alt is the modifier no reading gesture claims here.
 */
export function Thumbnails({
  client,
  docId,
  version,
  view,
  pageCount,
  current,
  onJump,
  onMove,
  onSwap,
  menuAt,
  size = 'medium',
  grid,
  waitForFirstFrame = false,
}: {
  /** How large the pictures are drawn (the Appearance setting). Medium for a strip with no setting behind it. */
  readonly size?: ThumbnailSize;
  /**
   * Whether the strip waits to read or draw anything: `true` while the page area's first frame is not shown yet. Every
   * read of a document waits in main's one lane, and asked at open the strip's eight pages queued ahead of the first
   * page the reader is waiting for; waiting, each card is a placeholder of a page's shape (`app.css`).
   */
  readonly waitForFirstFrame?: boolean;
  /**
   * The page context menu (§7) for the thumbnail a right-click lands on: ONE menu around the strip (`PageMenuArea`),
   * asking the shell for that page's menu, so this strip never names the registry. Optional for `onMove`'s reason: a
   * strip with no document commands behind it, the compare pane's, renders no menu rather than one whose items act on
   * the other document.
   */
  readonly menuAt?: MenuAt<number> | undefined;
  /**
   * Where the strip reads each page's rotation — the same read the spine takes
   * ({@link usePageRotations}), so a page turned in the document is turned here.
   */
  readonly client: ContractClient;
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly view: DocumentView | undefined;
  readonly pageCount: number;
  /** The page the reader is on, so the strip can mark it. */
  readonly current: number;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
  /**
   * Moves a page, zero-based, both indices in the DESTINATION frame.
   *
   * Optional so a strip with no document command behind it — the compare pane's
   * second view, say — renders without one rather than being handed a callback
   * that must do nothing. Absent means the thumbnails are not draggable at all,
   * which is the honest rendering of *this strip cannot reorder*: a draggable
   * control whose drop did nothing is the display-only defect.
   */
  readonly onMove?: ((from: number, to: number) => void) | undefined;
  /**
   * Exchanges two pages, zero-based.
   *
   * Optional for `onMove`'s reason, and reached by **Shift+click** on a
   * thumbnail: *swap this page with the one I am reading*.
   *
   * ## Why one gesture covers both modalities
   *
   * A `<button>` activated from the keyboard dispatches a click that carries
   * the modifier state, so Shift+Enter on a focused thumbnail arrives here as a
   * click with `shiftKey` set. There is no second handler and therefore no
   * second path to keep in step — which is what the drag/keyboard pair next
   * door needs `onKeyDown` for, HTML5 drag having no keyboard form at all.
   *
   * **Shift and not Ctrl**, and the reason is a platform one rather than taste:
   * on macOS Ctrl+click *is* a right click, so it raises `contextmenu` and
   * never reaches a click handler. Shift has no such meaning on a button.
   */
  readonly onSwap?: ((a: number, b: number) => void) | undefined;
  /**
   * The Organize grid's half (ADR-0104): present, the strip is laid out across the canvas at `width` and its
   * pages are SELECTED rather than jumped to. Click selects one, Ctrl+click toggles one, Shift+click extends
   * from the last clicked; Enter or a double-click opens a page in the reading view; Delete removes the
   * selection. Absent — the side strip — none of that exists, and Shift+click keeps meaning swap.
   */
  readonly grid?:
    | {
        /**
         * The width every card's picture fits: a thumbnail's (*Thumbnail*), or the grid's whole width, one page to a
         * row read top to bottom (*Full page*, the owner's review of 0.1.9.0). Every page as wide as the next.
         */
        readonly width: number;
        readonly selected: readonly number[];
        readonly onSelect: (pages: readonly number[]) => void;
        /** The card a click lands on becomes the current page (item 13a), whatever the click did to the selection. */
        readonly onCurrent: (page: number) => void;
        readonly onOpen: (page: number) => void;
        readonly onDelete: (pages: readonly number[]) => void;
        /** The navigator's request for a page: its card is scrolled into view, then the request is reported taken. */
        readonly goTo: number | undefined;
        readonly onWentTo: () => void;
        /**
         * Present for *Full page*, one page to a row: a reading position, so the grid aligns a card's top with its own
         * when it goes to one, and reports the page under the middle of its view as it scrolls, as Home does.
         */
        readonly onePage: { readonly onViewing: (page: number) => void } | undefined;
      }
    | undefined;
}): ReactElement {
  const { i18n } = useLingui();
  const { visible, slotRef } = useVisiblePages('50%');
  const rotations = usePageRotations(client, docId, version, waitForFirstFrame ? NOTHING_VISIBLE : visible);
  // A REF, not state: the source index is read once by the drop that follows,
  // and re-rendering the whole strip mid-drag would replace the element the
  // browser is dragging.
  const dragging = useRef<number | null>(null);
  // WHERE A SHIFT+CLICK EXTENDS FROM: the page last clicked without Shift. A ref for `dragging`'s reason.
  const anchor = useRef<number | null>(null);

  const strip = THUMBNAIL_SIZES[size];
  const width = grid?.width ?? strip.width;
  const { columns } = strip;
  const scroller = useRef<HTMLElement | null>(null);
  const onePage = grid?.onePage;
  const reading = onePage !== undefined;

  // THE GRID OPENS ON THE CURRENT PAGE (item 13a), before it paints, and again when Full page and Thumbnail swap or the
  // width the cards fit changes: there is one current page, and a grid opening at its top showed page 1 while the
  // status bar named another.
  //
  // THE PAGE IS READ FROM A REF, kept current by the effect after it, and not from `current` in the dependency list:
  // Full page reports the page it scrolls to, so a dependency on it would scroll the grid back to the top of that card
  // on every report.
  const shown = useRef(current);
  useEffect(() => {
    shown.current = current;
  }, [current]);
  const inGrid = grid !== undefined;
  useLayoutEffect(() => {
    if (!inGrid) return;
    cardOf(scroller.current, shown.current)?.scrollIntoView({ block: reading ? 'start' : 'nearest' });
  }, [inGrid, reading, width]);

  // THE NAVIGATOR'S REQUEST: the status bar's buttons, the page box and the page keys. Home's scroller takes it when
  // Home is shown; while Organize is, this does, so the grid moves to the page the bar names.
  const goTo = grid?.goTo;
  const onWentTo = grid?.onWentTo;
  useEffect(() => {
    if (goTo === undefined || onWentTo === undefined) return;
    shown.current = goTo;
    cardOf(scroller.current, goTo)?.scrollIntoView({ block: reading ? 'start' : 'nearest' });
    onWentTo();
  }, [goTo, onWentTo, reading]);

  // FULL PAGE'S SCROLL NAMES A PAGE: the card under the middle of the view, which is the one showing most of itself
  // there — never the topmost card a sliver of reaches, which is what a "first visible" rule would answer.
  const onViewing = onePage?.onViewing;
  useEffect(() => {
    const element = scroller.current;
    if (onViewing === undefined || element === null) return;
    let frame = 0;
    const report = (): void => {
      frame = 0;
      const page = pageAtMiddle(element);
      if (page === undefined) return;
      shown.current = page;
      onViewing(page);
    };
    const scrolled = (): void => {
      if (frame === 0) frame = requestAnimationFrame(report);
    };
    element.addEventListener('scroll', scrolled, { passive: true });
    return (): void => {
      element.removeEventListener('scroll', scrolled);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [onViewing]);

  return (
    <nav
      ref={scroller}
      className={grid === undefined ? 'm-thumbnails' : 'm-thumbnails m-thumbnails--grid'}
      aria-label={i18n._(THUMBNAILS_LABEL)}
      // THE SIZE IS TWO CUSTOM PROPERTIES, the grid's column count and a picture's width, because they change
      // together and `app.css` lays both out — the token rule's own line: values that are genuinely dynamic.
      style={{ '--m-thumb-columns': String(columns), '--m-thumb-width': `${String(width)}px` } as React.CSSProperties}
    >
      {inPageMenu(menuAt, Array.from({ length: pageCount }, (_, page) => {
        const ticked = grid?.selected.includes(page) === true;
        return (
        <button
          key={page}
          type="button"
          className={['m-thumb', page === current ? 'm-thumb-current' : '', ticked ? 'is-selected' : '']
            .filter((name) => name !== '')
            .join(' ')}
          // THE PAGE A PERSON READS, which is the 1-based one. The value passed
          // back is the zero-based index, and `pageNumbering.ts` is the only
          // place the two meet.
          aria-label={i18n._(THUMBNAIL_PAGE, { page: pdfjsPageOf(page) })}
          aria-current={page === current ? 'true' : undefined}
          // IN THE GRID, whether it is ticked — a toggle's state, which is what `aria-pressed` announces.
          aria-pressed={grid === undefined ? undefined : ticked}
          ref={slotRef(page)}
          draggable={onMove !== undefined}
          data-thumb-page={String(page)}
          onClick={(event) => {
            if (grid !== undefined) {
              // THE CLICKED CARD IS THE CURRENT PAGE, whichever way the click changes the selection (item 13a).
              grid.onCurrent(page);
              if (event.shiftKey && anchor.current !== null) {
                const from = Math.min(anchor.current, page);
                const to = Math.max(anchor.current, page);
                grid.onSelect(Array.from({ length: to - from + 1 }, (__, at) => from + at));
                return;
              }
              anchor.current = page;
              if (event.ctrlKey || event.metaKey) {
                grid.onSelect(ticked ? grid.selected.filter((each) => each !== page) : [...grid.selected, page]);
                return;
              }
              grid.onSelect([page]);
              return;
            }
            // SHIFT MEANS SWAP, and a swap with the page already being read is
            // not a command — `swapPages` accepts it and inverts to a no-op,
            // but dispatching it would put an undo step in the log for a
            // reader whose document did not change. Same rule as the drop on
            // itself below.
            if (onSwap !== undefined && event.shiftKey) {
              if (page !== current) onSwap(current, page);
              return;
            }
            onJump(page);
          }}
          onDoubleClick={() => {
            grid?.onOpen(page);
          }}
          onDragStart={() => {
            dragging.current = page;
          }}
          onDragEnd={() => {
            dragging.current = null;
          }}
          // WITHOUT THIS THERE IS NO DROP. The default action of `dragover` is
          // to refuse the drag, so a handler that does not prevent it produces a
          // strip that accepts a grab and silently rejects every release.
          onDragOver={(event) => {
            if (onMove !== undefined) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const from = dragging.current;
            dragging.current = null;
            // A DROP ON ITSELF IS NOT A COMMAND. `movePage` accepts it and
            // inverts to a no-op, but dispatching it would put an undo step in
            // the log for a reader who changed their mind mid-drag.
            if (from === null || from === page) return;
            onMove?.(from, page);
          }}
          onKeyDown={(event) => {
            if (grid !== undefined && !event.altKey) {
              // ENTER OPENS, and is prevented so the button's own click — which would select — does not follow.
              if (event.key === 'Enter') {
                event.preventDefault();
                grid.onOpen(page);
                return;
              }
              // DELETE REMOVES THE TICKED PAGES, or this one when none is ticked: *"Delete removes"* (v5-09).
              if (event.key === 'Delete') {
                event.preventDefault();
                grid.onDelete(grid.selected.length > 0 ? grid.selected : [page]);
                return;
              }
            }
            if (onMove === undefined || !event.altKey) return;
            const to = event.key === 'ArrowUp' ? page - 1 : event.key === 'ArrowDown' ? page + 1 : page;
            if (to === page || to < 0 || to >= pageCount) return;
            // The strip owns this chord, so the scroller must not also act on
            // it — an unprevented Alt+Arrow moves the reader as well as the page.
            event.preventDefault();
            onMove(page, to);
          }}
        >
          {/* NOT BEFORE THE MODEL ANSWERS, which is the spine's rule: a page
              drawn first at its stored rotation repaints a frame later turned. */}
          <ThumbCanvas
            view={view}
            page={page}
            width={width}
            draw={visible.has(page) && rotations.has(page)}
            rotation={rotations.get(page)}
          />
          {/* THE PAGE'S NUMBER UNDER IT, as v5-02 draws the strip. Seen, not read: the button's
              accessible name already says which page this is. */}
          <span aria-hidden="true" className="m-thumb-number">
            {pdfjsPageOf(page)}
          </span>
        </button>
        );
      }))}
    </nav>
  );
}

/**
 * One thumbnail's canvas, drawn only while its slot is near the viewport.
 *
 * `width` is the size's (`THUMBNAIL_SIZES`): one width for every page rather than a scale, because the strip's
 * job is a uniform column a reader can scan — pages of different sizes should line up. The height follows from
 * the page's own aspect ratio, which is what `renderPage` reports back. A new size REDRAWS, since a picture
 * drawn at 60 px and stretched to 160 is a blurred one.
 */
/** The card for `page` in a strip, or `null` where the strip or the card is not there. */
function cardOf(strip: HTMLElement | null, page: number): HTMLElement | null {
  return strip?.querySelector<HTMLElement>(`[data-thumb-page="${String(page)}"]`) ?? null;
}

/**
 * The page whose card lies under the vertical middle of `strip`'s view, in a strip of one card to a row.
 *
 * **A binary search over the cards in page order**, because one column of cards is sorted by position: two hundred
 * pages cost eight reads of a box, where a walk over every card on every frame grows with the document. Between two
 * cards — the gap — it answers the card below, which is the one coming into view.
 */
function pageAtMiddle(strip: HTMLElement): number | undefined {
  const cards = strip.querySelectorAll<HTMLElement>('[data-thumb-page]');
  if (cards.length === 0) return undefined;
  const view = strip.getBoundingClientRect();
  const middle = view.top + view.height / 2;
  let low = 0;
  let high = cards.length - 1;
  while (low < high) {
    const at = Math.floor((low + high) / 2);
    const card = cards[at];
    if (card !== undefined && card.getBoundingClientRect().bottom < middle) low = at + 1;
    else high = at;
  }
  const found = cards[low]?.dataset['thumbPage'];
  return found === undefined ? undefined : Number(found);
}

/** The empty visible set, one identity, for a strip that must not ask yet. */
const NOTHING_VISIBLE: ReadonlySet<number> = new Set();

function ThumbCanvas({
  view,
  page,
  width,
  draw,
  rotation,
}: {
  readonly view: DocumentView | undefined;
  readonly page: number;
  readonly width: number;
  readonly draw: boolean;
  /** The view model's rotation, or `undefined` where it did not answer for this version. */
  readonly rotation: number | undefined;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // WHAT THE CANVAS HOLDS AND WHAT IT WAS DRAWN FOR. A new width, rotation or version redraws, and until that draw lands
  // the canvas still holds the last one: drawn, but not for what is asked now. Keeping the inputs beside the size is
  // what lets the element say which — a size alone read `drawn` from the first draw on, so a reader waiting for the
  // Organize grid's Full page saw thumbnail-sized pages as ready (CI, ubuntu-latest, on 6b7a6bd9).
  const [size, setSize] = useState<
    { width: number; height: number; for: { view: DocumentView; page: number; width: number; rotation: number | undefined } } | undefined
  >(undefined);
  const current = size !== undefined && size.for.view === view && size.for.page === page && size.for.width === width && size.for.rotation === rotation;

  useEffect(() => {
    const element = canvas.current;
    if (!draw || view === undefined || element === null) return;
    const superseded = new AbortController();
    delete element.dataset['failed'];

    const drawThumb = async (): Promise<void> => {
      // ONE DRAW, FITTED TO THE COLUMN by `renderPage` from the page's own viewport. This drew the
      // page at full size first to learn its width, and that first pass is what a superseded
      // draw left behind: a canvas 612 points wide in a 96-pixel column (measured 2026-09-18).
      const drawn = await renderPage(view.document, pdfjsPageOf(page), element, { fitWidth: width }, rotation, superseded.signal);
      setSize({ width: drawn.width, height: drawn.height, for: { view, page, width, rotation } });
    };

    void drawThumb().catch((error: unknown) => {
      // A SUPERSEDED DRAW IS NOT A FAILURE: a newer one for this slot is running.
      if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
      // ANY OTHER IS, and says so on the element, as the spine's pages do. This was an empty
      // catch, and it is what hid PDF.js refusing every redraw after a command: a thumbnail
      // that would not draw looked exactly like one not drawn yet, for ever.
      element.dataset['failed'] = 'true';
    });

    return (): void => {
      superseded.abort();
    };
  }, [draw, page, rotation, view, width]);

  return (
    <canvas
      ref={canvas}
      className="m-thumb-canvas"
      // UNDRAWN, the canvas keeps the browser's default 300 × 150, a 2 : 1 ratio no page has; the stylesheet gives
      // it a portrait page's ratio until the drawing sets its size, so a card is one height drawn or not. `stale` is a
      // drawing made for another width, rotation or version, shown until the redraw lands.
      data-drawn={size === undefined ? 'false' : current ? 'true' : 'stale'}
      style={
        size === undefined
          ? undefined
          : // THE COLUMN'S WIDTH EXACTLY, and the height the page's shape gives it — the last drawing's shape while a
            // redraw is under way, so a card being redrawn at a new width is not stretched to the old height.
            { width: `${String(width)}px`, height: `${String(current ? size.height : (size.height * width) / size.width)}px` }
      }
    />
  );
}
