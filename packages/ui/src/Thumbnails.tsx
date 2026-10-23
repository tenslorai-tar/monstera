import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import type { StripArrival } from './layerArrival.js';
import { THUMBNAILS_LABEL, THUMBNAIL_PAGE } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { givePixelsBack } from './pixelLedger.js';
import { type PagePlans, plannedRotation } from './pagePlan.js';
import { type PageRotation, RenderCancelledError, renderPage } from './renderPage.js';
import { THUMBNAIL_SIZES, type ThumbnailSize } from './settings/appearance.js';
import { type MenuAt, inPageMenu } from './surfaces/ContextMenu.js';
import { usePageRotations } from './usePageRotations.js';
import { usePlannedPages } from './usePlannedPages.js';
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
  pageCount: viewPageCount,
  plans,
  current,
  onJump,
  onMove,
  onSwap,
  menuAt,
  size = 'medium',
  grid,
  waitForFirstFrame = false,
  onReady,
  arrival,
}: {
  /**
   * The layer coming forward this strip is part of (`layerArrival.ts`), else `undefined`: the strip registers while
   * mounted and says when its cards in view are drawn, so the layer is not shown with the strip still drawing.
   */
  readonly arrival?: StripArrival | undefined;
  /**
   * Told the width every card in this strip's view is drawn at, each time that becomes true: the Organize grid prepares
   * a new size out of sight and shows it only then (`PageGrid`). A failed card counts as finished, since it is shown as
   * failed.
   */
  readonly onReady?: ((width: number) => void) | undefined;
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
   * from the last clicked; Enter or a double-click opens a page in the reading view; Delete names the
   * selection to `onDelete`, which asks before removing it. Absent — the side strip — none of that exists, and
   * Shift+click keeps meaning swap.
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
  /** The document's page plan (ADR-0261): a page command shown on the cards before its version is drawn. */
  readonly plans?: PagePlans | undefined;
}): ReactElement {
  const { i18n } = useLingui();
  // THE CARDS SHOWN, while a page command is ahead of the view (ADR-0261): `PageList`'s rule, from the one reader.
  const planned = usePlannedPages(plans, view);
  const pageCount = planned?.length ?? viewPageCount;
  const scroller = useRef<HTMLElement | null>(null);
  const onePage = grid?.onePage;
  const reading = onePage !== undefined;
  // NEAR IS THE STRIP'S OWN BOX, half of it either side; a page to a row is read as Home is, so a whole view.
  const { visible, slotRef } = useVisiblePages(reading ? '100%' : '50%', undefined, scroller);
  const { now: rotations, at: rotationsAt } = usePageRotations(client, docId, version, waitForFirstFrame ? NOTHING_VISIBLE : visible);
  // A REF, not state: the source index is read once by the drop that follows,
  // and re-rendering the whole strip mid-drag would replace the element the
  // browser is dragging.
  const dragging = useRef<number | null>(null);
  // WHERE A SHIFT+CLICK EXTENDS FROM: the page last clicked without Shift. A ref for `dragging`'s reason.
  const anchor = useRef<number | null>(null);

  const strip = THUMBNAIL_SIZES[size];
  const width = grid?.width ?? strip.width;
  const { columns } = strip;

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

  // EACH CARD'S LAST FINISHED DRAWING, by the width it was made for, so the strip can say when everything in its view
  // is drawn at the width asked now. A ref: a report re-renders nothing, and it is read by the check that follows it.
  const drawnAt = useRef(new Map<number, number>());
  const viewDrawn = useCallback((): boolean => {
    const element = scroller.current;
    if (element === null) return false;
    const inView = cardsInView(element);
    return inView.length > 0 && inView.every((card) => drawnAt.current.get(card) === width);
  }, [width]);
  const onDrawn = useCallback(
    (page: number, at: number): void => {
      drawnAt.current.set(page, at);
      if ((onReady === undefined && arrival === undefined) || !viewDrawn()) return;
      onReady?.(width);
      arrival?.drawn();
    },
    [arrival, onReady, viewDrawn, width],
  );
  // REGISTERED WHILE MOUNTED, and drawn at once where its view already is: no draw is left to report it.
  useLayoutEffect(() => {
    if (arrival === undefined) return undefined;
    const release = arrival.mounted();
    if (viewDrawn()) arrival.drawn();
    return release;
  }, [arrival, viewDrawn]);

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
                if (!event.repeat) grid.onOpen(page);
                return;
              }
              // DELETE NAMES THE TICKED PAGES, or this one when none is ticked (v5-09), and the grid's owner asks before
              // removing them (CR-COR-06).
              //
              // ONCE PER PRESS: a held key repeats, the card in this slot is the page that moved into it, and each
              // repeat deleted that page too — a page per repeat with nothing asked (code review CR-COR-06), the
              // dispatcher's own rule for a once-per-press command (`UiCommand.repeats`). And THE GRID'S KEY ALONE:
              // left to bubble, the document's own Delete (a selected annotation's) ran on the same press as well
              // (CR-COR-15).
              if (event.key === 'Delete') {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) grid.onDelete(grid.selected.length > 0 ? grid.selected : [page]);
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
            keeps={plans?.unchangedBetween}
            // THE PIXELS FOLLOW THE MARGIN and the draw follows the answer, two props for `PageList`'s reason: a new
            // version empties the rotation answers until the model is asked again, and a release keyed to the draw gave
            // back every card on screen for those frames of an edit.
            held={visible.has(page)}
            // A PLANNED CARD draws from the view at once (ADR-0261): its rotation is the plan's, not the model's.
            draw={visible.has(page) && (planned !== null || rotations.has(page))}
            source={planned?.[page]?.source ?? page}
            // TURNED FROM THE MODEL'S ROTATION AT THE VIEW'S VERSION (`plannedRotation`), the one the card was drawn with.
            rotation={
              planned === null
                ? rotations.get(page)
                : plannedRotation(
                    planned[page] ?? { source: page, turn: 0 },
                    view === undefined ? undefined : rotationsAt(view.version)?.get(planned[page]?.source ?? page),
                  )
            }
            onDrawn={onDrawn}
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

/** The pages whose cards overlap `strip`'s view, in page order. */
function cardsInView(strip: HTMLElement): readonly number[] {
  const view = strip.getBoundingClientRect();
  return [...strip.querySelectorAll<HTMLElement>('[data-thumb-page]')]
    .filter((card) => {
      const box = card.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    })
    .map((card) => Number(card.dataset['thumbPage']));
}

/** The empty visible set, one identity, for a strip that must not ask yet. */
const NOTHING_VISIBLE: ReadonlySet<number> = new Set();

/** An undrawn card's shape, a portrait Letter page's: the stylesheet's `aspect-ratio`, here so the card's height is whole pixels. */
const UNDRAWN_SHAPE = 792 / 612;

/**
 * A drawn page's height over its width, EXACTLY: its visible box, sideways at a quarter turn. Not the canvas's own two
 * numbers, whose height `renderPage` rounds up to a whole pixel — a card sized by those changed height by a fraction
 * of a pixel against the undrawn card's exact 612 : 792.
 */
function shapeOf(drawn: { readonly crop: readonly [number, number, number, number]; readonly rotation: number; readonly width: number; readonly height: number }): number {
  const [x0, y0, x1, y1] = drawn.crop;
  const wide = Math.abs(x1 - x0);
  const tall = Math.abs(y1 - y0);
  if (wide === 0 || tall === 0) return drawn.height / drawn.width;
  return drawn.rotation % 180 === 0 ? tall / wide : wide / tall;
}

function ThumbCanvas({
  view,
  page,
  source,
  width,
  held,
  draw,
  rotation,
  onDrawn,
  keeps,
}: {
  /** Whether the view's page `page` is drawn the same at `to` as at `from` (ADR-0262); absent, every new view redraws. */
  readonly keeps: ((from: DocVersion, to: DocVersion, page: number) => boolean) | undefined;
  readonly view: DocumentView | undefined;
  readonly page: number;
  /** The view's page the card draws: its own, or the one a page plan shows in its place (ADR-0261). */
  readonly source: number;
  readonly width: number;
  /** Whether the card is in the margin, which is what keeps its pixels; out of it they are given back. */
  readonly held: boolean;
  /** Whether it may draw now: held, and its rotation answered for this version. */
  readonly draw: boolean;
  /** The view model's rotation, `undefined` where it did not answer for this version, or a page plan's turn. */
  readonly rotation: PageRotation;
  /** Told when a draw for `width` lands, or fails, which is shown as failed: either way the card is finished. */
  readonly onDrawn: (page: number, width: number) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // WHAT THE CANVAS HOLDS AND WHAT IT WAS DRAWN FOR. A new width, rotation or version redraws, and until that draw lands
  // the canvas still holds the last one: drawn, but not for what is asked now. Keeping the inputs beside the size is
  // what lets the element say which — a size alone read `drawn` from the first draw on, so a reader waiting for the
  // Organize grid's Full page saw thumbnail-sized pages as ready (CI, ubuntu-latest, on 6b7a6bd9).
  const [size, setSize] = useState<
    | {
        width: number;
        height: number;
        /** The page's height over its width, exactly, as drawn: its visible box, turned by the rotation drawn at. */
        shape: number;
        for: { view: DocumentView; source: number; width: number; rotation: PageRotation };
      }
    | undefined
  >(undefined);
  // A DRAWING THE NEW VIEW DID NOT CHANGE (ADR-0262): the same page at the same width and rotation, which no version since
  // the one it was drawn from changed. It is this view's drawing too, so it is current and is not drawn again.
  const unchanged =
    size !== undefined &&
    view !== undefined &&
    size.for.view !== view &&
    size.for.source === source &&
    size.for.width === width &&
    size.for.rotation === rotation &&
    keeps?.(size.for.view.version, view.version, source) === true;
  const current =
    size !== undefined &&
    (unchanged || size.for.view === view) &&
    size.for.source === source &&
    size.for.width === width &&
    size.for.rotation === rotation;
  // PIXELS GIVEN BACK when the card leaves the margin (run 4 item 13c): a canvas keeps its backing store for as long as
  // it is in the page, so a strip scrolled through a long document held every card's. The card keeps its size, so
  // nothing above it moves, and is drawn again when it comes back near the view; what is held is the margin's cards.
  const [released, setReleased] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (held || element === null || element.width === 0) return;
    givePixelsBack(element);
    setReleased(true);
  }, [held]);
  // AND ON UNMOUNT, as a page's canvas is (`PageList`): sized to nothing, the store is released now, not when collected.
  useLayoutEffect(() => {
    const element = canvas.current;
    return (): void => {
      if (element === null) return;
      givePixelsBack(element);
    };
  }, []);
  // THE LATEST REPORT, read when a draw lands rather than a dependency of the draw: a parent's new callback is not a
  // reason to draw the page again.
  const report = useRef(onDrawn);
  useEffect(() => {
    report.current = onDrawn;
  }, [onDrawn]);

  useEffect(() => {
    const element = canvas.current;
    if (!draw || view === undefined || element === null) return;
    // NOT DRAWN AGAIN where the new view did not change this page (ADR-0262): the card's drawing is already this view's.
    if (unchanged) {
      report.current(page, width);
      return;
    }
    const superseded = new AbortController();
    delete element.dataset['failed'];

    const drawThumb = async (): Promise<void> => {
      // ONE DRAW, FITTED TO THE COLUMN by `renderPage` from the page's own viewport. This drew the
      // page at full size first to learn its width, and that first pass is what a superseded
      // draw left behind: a canvas 612 points wide in a 96-pixel column (measured 2026-09-18).
      const drawn = await renderPage(view.document, pdfjsPageOf(source), element, { fitWidth: width }, rotation, superseded.signal);
      setSize({ width: drawn.width, height: drawn.height, shape: shapeOf(drawn), for: { view, source, width, rotation } });
      setReleased(false);
      report.current(page, width);
    };

    void drawThumb().catch((error: unknown) => {
      // A SUPERSEDED DRAW IS NOT A FAILURE: a newer one for this slot is running.
      if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
      // ANY OTHER IS, and says so on the element, as the spine's pages do. This was an empty
      // catch, and it is what hid PDF.js refusing every redraw after a command: a thumbnail
      // that would not draw looked exactly like one not drawn yet, for ever.
      element.dataset['failed'] = 'true';
      report.current(page, width);
    });

    return (): void => {
      superseded.abort();
    };
  }, [draw, page, rotation, source, unchanged, view, width]);

  return (
    <canvas
      ref={canvas}
      className="m-thumb-canvas"
      // UNDRAWN, the canvas keeps the browser's default 300 × 150, a 2 : 1 ratio no page has; the stylesheet gives
      // it a portrait page's ratio until the drawing sets its size, so a card is one height drawn or not. `stale` is a
      // drawing made for another width, rotation or version, shown until the redraw lands.
      // `released`: drawn once and given back while out of the margin; its box keeps the drawing's size.
      data-drawn={size === undefined ? 'false' : released ? 'released' : current ? 'true' : 'stale'}
      // THE COLUMN'S WIDTH, and ONE HEIGHT RULE drawn or not: the page's shape at that width rounded up to a whole pixel,
      // which is exactly the height `renderPage` gives the canvas it fits to the column. The undrawn card was sized by
      // the stylesheet's exact 612 : 792 and the drawn one by the canvas, so a card grew by a fraction of a pixel as its
      // drawing landed, and one drawn after Organize's Next had scrolled to the card below slid that card 1 px down
      // (renderedScreen.pw.ts:4207 under the whole file's load, before ADR-0261 and after it). Sized exactly instead, the
      // cards sat at fractional places and the scroll missed by a fraction the other way: whole pixels are the rule
      // because the drawing is whole pixels. The last drawing's shape while a redraw is under way, as before.
      style={{ width: `${String(width)}px`, height: `${String(Math.ceil(width * (size?.shape ?? UNDRAWN_SHAPE)))}px` }}
    />
  );
}
