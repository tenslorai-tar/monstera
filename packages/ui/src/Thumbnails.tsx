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
 * ## What is NOT here, and it is in the row rather than in a comment alone
 *
 * Drag-reorder. Reordering pages is a Stage 2 command against the document, and
 * a drag that rearranged thumbnails without one would be a sidebar disagreeing
 * with the document it describes — the worst version of a display-only control,
 * because it looks like it worked.
 */
export function Thumbnails({
  view,
  pageCount,
  current,
  onJump,
}: {
  readonly view: DocumentView | undefined;
  readonly pageCount: number;
  /** The page the reader is on, so the strip can mark it. */
  readonly current: number;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const { visible, slotRef } = useVisiblePages('50%');

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
          onClick={() => {
            onJump(page);
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
