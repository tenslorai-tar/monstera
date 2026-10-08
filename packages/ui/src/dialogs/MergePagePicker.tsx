import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import { NO_KEYS } from '../documentKeys.js';
import type { DocumentView } from '../documentView.js';
import { MERGE_DOCUMENT_PICK_NOTE, MERGE_DOCUMENT_PICK_TILE } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { RenderCancelledError, renderPage } from '../renderPage.js';
import { useDocumentView } from '../useDocumentView.js';
import { type PageSource, usePageSources } from './pageSources.js';

/** The width a page's picture is drawn to, in CSS pixels: a Letter page is about 93 tall at this width. */
export const PICKER_TILE_WIDTH = 72;

/** A password is never asked for here: a document that needs one shows its numbers and is chosen by them. */
const declinePassword = (): Promise<string | undefined> => Promise.resolve(undefined);
const ignoreVersion = (): void => undefined;

/**
 * One page: a button that takes it or leaves it, holding its picture once the page scrolls into view.
 *
 * The picture is the parser's own drawing (`renderPage`, the one drawing path) fitted to the tile's width. A page that
 * cannot be drawn keeps its number, which is what the choice is made by; the picture is a help and never the control.
 */
function Tile({
  index,
  taken,
  view,
  onToggle,
}: {
  readonly index: number;
  readonly taken: boolean;
  readonly view: DocumentView | undefined;
  readonly onToggle: (index: number) => void;
}): ReactElement {
  const { _ } = useLingui();
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // WHETHER THE TILE HAS BEEN SEEN: pages are drawn as they are scrolled to, so a document of hundreds is not drawn whole.
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = button.current;
    if (seen || element === null) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    watch.observe(element);
    return (): void => {
      watch.disconnect();
    };
  }, [seen]);

  useEffect(() => {
    const element = canvas.current;
    if (!seen || view === undefined || element === null) return;
    const superseded = new AbortController();
    void renderPage(view.document, pdfjsPageOf(index), element, { fitWidth: PICKER_TILE_WIDTH }, undefined, superseded.signal)
      .then(() => {
        element.dataset['drawn'] = 'true';
      })
      .catch((error: unknown) => {
        // A SUPERSEDED DRAW IS NOT A FAILURE; any other leaves the number alone on the tile and says so on it.
        if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
        element.dataset['failed'] = 'true';
      });
    return (): void => {
      superseded.abort();
    };
  }, [index, seen, view]);

  return (
    <button
      aria-pressed={taken}
      aria-label={_(MERGE_DOCUMENT_PICK_TILE, { number: pdfjsPageOf(index) })}
      className="m-merge-pick__tile"
      data-page={String(pdfjsPageOf(index))}
      onClick={() => {
        onToggle(index);
      }}
      ref={button}
      type="button"
    >
      {view === undefined ? null : <canvas aria-hidden className="m-merge-pick__picture" data-drawn="false" ref={canvas} />}
      <span aria-hidden className="m-merge-pick__number">
        {String(pdfjsPageOf(index))}
      </span>
    </button>
  );
}

/** The tiles with a parser behind them: opened for the picker's life and closed with it. */
function PictureTiles({
  source,
  total,
  taken,
  onToggle,
}: {
  readonly source: PageSource;
  readonly total: number;
  readonly taken: ReadonlySet<number>;
  readonly onToggle: (index: number) => void;
}): ReactElement {
  const sources = usePageSources();
  if (sources === undefined) throw new Error('PictureTiles needs the page sources it was chosen by');
  const { ready } = useDocumentView(sources.client, source, ignoreVersion, declinePassword, NO_KEYS);
  return <TileList total={total} taken={taken} view={ready} onToggle={onToggle} />;
}

function TileList({
  total,
  taken,
  view,
  onToggle,
}: {
  readonly total: number;
  readonly taken: ReadonlySet<number>;
  readonly view: DocumentView | undefined;
  readonly onToggle: (index: number) => void;
}): ReactElement {
  return (
    <div className="m-merge-pick__tiles">
      {Array.from({ length: total }, (_unused, index) => (
        <Tile key={index} index={index} taken={taken.has(index)} view={view} onToggle={onToggle} />
      ))}
    </div>
  );
}

/**
 * A document's pages as pictures to take or leave (the owner's item 5.1, on ADR-0195's per-document page set).
 *
 * It CHOOSES; it does not hold the choice. The row's range text stays the one value (`rowPages` reads it, the answer
 * carries it), and a click only writes that text again through the caller — so typing and clicking are two ways to edit
 * one field and can never disagree.
 *
 * @param docId the listed document, as the dialog holds it
 * @param total its page count
 * @param taken the zero-based pages the range names now
 * @param onToggle a page was clicked, zero-based
 */
export function MergePagePicker({
  docId,
  total,
  taken,
  onToggle,
}: {
  readonly docId: string;
  readonly total: number;
  readonly taken: ReadonlySet<number>;
  readonly onToggle: (index: number) => void;
}): ReactElement {
  const { _ } = useLingui();
  const sources = usePageSources();
  const source = sources?.find(docId);
  return (
    <div className="m-merge-pick">
      <span className="m-merge-list__range-note">{_(MERGE_DOCUMENT_PICK_NOTE)}</span>
      {source === undefined ? (
        <TileList total={total} taken={taken} view={undefined} onToggle={onToggle} />
      ) : (
        <PictureTiles source={source} total={total} taken={taken} onToggle={onToggle} />
      )}
    </div>
  );
}
