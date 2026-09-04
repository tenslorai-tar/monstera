import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { DocumentView } from './documentView.js';
import { THUMBNAILS_LABEL, THUMBNAIL_PAGE } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { renderPage } from './renderPage.js';
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
  view,
  pageCount,
  current,
  onJump,
  onMove,
}: {
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
}): ReactElement {
  const { i18n } = useLingui();
  const { visible, slotRef } = useVisiblePages('50%');
  // A REF, not state: the source index is read once by the drop that follows,
  // and re-rendering the whole strip mid-drag would replace the element the
  // browser is dragging.
  const dragging = useRef<number | null>(null);

  return (
    <nav className="m-thumbnails" aria-label={i18n._(THUMBNAILS_LABEL)}>
      {Array.from({ length: pageCount }, (_, page) => (
        <button
          key={page}
          type="button"
          className={page === current ? 'm-thumb m-thumb-current' : 'm-thumb'}
          // THE PAGE A PERSON READS, which is the 1-based one. The value passed
          // back is the zero-based index, and `pageNumbering.ts` is the only
          // place the two meet.
          aria-label={i18n._(THUMBNAIL_PAGE, { page: pdfjsPageOf(page) })}
          aria-current={page === current ? 'true' : undefined}
          ref={slotRef(page)}
          draggable={onMove !== undefined}
          data-thumb-page={String(page)}
          onClick={() => {
            onJump(page);
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
            if (onMove === undefined || !event.altKey) return;
            const to = event.key === 'ArrowUp' ? page - 1 : event.key === 'ArrowDown' ? page + 1 : page;
            if (to === page || to < 0 || to >= pageCount) return;
            // The strip owns this chord, so the scroller must not also act on
            // it — an unprevented Alt+Arrow moves the reader as well as the page.
            event.preventDefault();
            onMove(page, to);
          }}
        >
          <ThumbCanvas view={view} page={page} draw={visible.has(page)} />
        </button>
      ))}
    </nav>
  );
}

/**
 * How wide a thumbnail is drawn, in CSS pixels.
 *
 * A fixed width rather than a scale, because the strip's job is a uniform
 * column a reader can scan — pages of different sizes should line up. The
 * height follows from the page's own aspect ratio, which is what `renderPage`
 * reports back.
 */
const THUMB_WIDTH = 96;

/** One thumbnail's canvas, drawn only while its slot is near the viewport. */
function ThumbCanvas({
  view,
  page,
  draw,
}: {
  readonly view: DocumentView | undefined;
  readonly page: number;
  readonly draw: boolean;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (!draw || view === undefined || element === null) return;
    let cancelled = false;

    // THE SCALE IS DERIVED FROM THE PAGE, not assumed. A first pass at scale 1
    // reports the page's own size; the width this strip wants divided by that
    // is the scale that fills the column. `renderPage` answers with what it
    // drew, so the second call is the one whose result is kept.
    void renderPage(view.document, pdfjsPageOf(page), element, 1)
      .then((drawn) => {
        if (cancelled || drawn.width === 0) return undefined;
        return renderPage(view.document, pdfjsPageOf(page), element, THUMB_WIDTH / drawn.width);
      })
      .then((drawn) => {
        if (cancelled || drawn === undefined) return;
        setSize({ width: drawn.width, height: drawn.height });
      })
      .catch(() => {
        // A THUMBNAIL THAT WILL NOT DRAW IS NOT A FAILURE OF THE DOCUMENT. The
        // spine reports a parse failure with `data-failed` because that is the
        // surface a reader is looking at; a blank square in a strip of a
        // hundred is not worth a marker, and raising here would take the whole
        // sidebar down with one bad page.
      });

    return (): void => {
      cancelled = true;
    };
  }, [draw, page, view]);

  return (
    <canvas
      ref={canvas}
      className="m-thumb-canvas"
      style={
        size === undefined
          ? undefined
          : { width: `${String(THUMB_WIDTH)}px`, height: `${String(size.height)}px` }
      }
    />
  );
}
