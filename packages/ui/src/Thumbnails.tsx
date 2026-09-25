import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { Fragment, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { THUMBNAILS_LABEL, THUMBNAIL_PAGE } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { RenderCancelledError, renderPage } from './renderPage.js';
import { THUMBNAIL_SIZES, type ThumbnailSize } from './settings/appearance.js';
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
  pageMenu,
  size = 'medium',
  grid,
}: {
  /** How large the pictures are drawn (the Appearance setting). Medium for a strip with no setting behind it. */
  readonly size?: ThumbnailSize;
  /**
   * Wraps one thumbnail in the page context menu for THAT page (§7) — the shell's
   * `ContextMenuArea`, handed down so this strip never names the registry. Optional for
   * `onMove`'s reason: a strip with no document commands behind it, the compare pane's,
   * renders no menu rather than one whose items act on the other document.
   */
  readonly pageMenu?: ((page: number, thumbnail: ReactElement) => ReactNode) | undefined;
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
        readonly width: number;
        readonly selected: readonly number[];
        readonly onSelect: (pages: readonly number[]) => void;
        readonly onOpen: (page: number) => void;
        readonly onDelete: (pages: readonly number[]) => void;
      }
    | undefined;
}): ReactElement {
  const { i18n } = useLingui();
  const { visible, slotRef } = useVisiblePages('50%');
  const rotations = usePageRotations(client, docId, version, visible);
  // A REF, not state: the source index is read once by the drop that follows,
  // and re-rendering the whole strip mid-drag would replace the element the
  // browser is dragging.
  const dragging = useRef<number | null>(null);
  // WHERE A SHIFT+CLICK EXTENDS FROM: the page last clicked without Shift. A ref for `dragging`'s reason.
  const anchor = useRef<number | null>(null);

  const strip = THUMBNAIL_SIZES[size];
  const width = grid?.width ?? strip.width;
  const { columns } = strip;

  return (
    <nav
      className={grid === undefined ? 'm-thumbnails' : 'm-thumbnails m-thumbnails--grid'}
      aria-label={i18n._(THUMBNAILS_LABEL)}
      // THE SIZE IS TWO CUSTOM PROPERTIES, the grid's column count and a picture's width, because they change
      // together and `app.css` lays both out — the token rule's own line: values that are genuinely dynamic.
      style={{ '--m-thumb-columns': String(columns), '--m-thumb-width': `${String(width)}px` } as React.CSSProperties}
    >
      {Array.from({ length: pageCount }, (_, page) => {
        const ticked = grid?.selected.includes(page) === true;
        const thumbnail = (
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
        // THE KEY ON THE OUTERMOST ELEMENT, so wrapping a thumbnail in its menu does not make React
        // treat every page as new on each render.
        return pageMenu === undefined ? thumbnail : <Fragment key={page}>{pageMenu(page, thumbnail)}</Fragment>;
      })}
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
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (!draw || view === undefined || element === null) return;
    const superseded = new AbortController();
    delete element.dataset['failed'];

    const drawThumb = async (): Promise<void> => {
      // ONE DRAW, FITTED TO THE COLUMN by `renderPage` from the page's own viewport. This drew the
      // page at full size first to learn its width, and that first pass is what a superseded
      // draw left behind: a canvas 612 points wide in a 96-pixel column (measured 2026-09-18).
      const drawn = await renderPage(
        view.document,
        pdfjsPageOf(page),
        element,
        { fitWidth: width },
        rotation,
        superseded.signal,
      );
      setSize({ width: drawn.width, height: drawn.height });
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
      style={
        size === undefined
          ? undefined
          : { width: `${String(width)}px`, height: `${String(size.height)}px` }
      }
    />
  );
}
