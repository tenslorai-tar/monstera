import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { CompareBox, DocId, DocVersion, MessageKey } from '@monstera/shared';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { DifferenceMark } from './DifferenceLayer.js';
import type { DocumentView } from './documentView.js';
import {
  SIDE_CLIPPED,
  SIDE_CLOSE,
  SIDE_CLOSE_TEXT,
  SIDE_COMPARE,
  SIDE_COMPARING,
  SIDE_COUNT,
  SIDE_DIFFERENCES,
  SIDE_DIFFERENCES_CLOSE,
  SIDE_DOCUMENT,
  SIDE_FAILED,
  SIDE_HALF_LABEL,
  SIDE_LEFT,
  SIDE_MORE,
  SIDE_MOVED,
  SIDE_NONE,
  SIDE_NO_COMMON,
  SIDE_WHAT,
  SIDE_OPEN,
  SIDE_REFUSED,
  SIDE_RIGHT,
  SIDE_ROW_ADDED_TEXT,
  SIDE_ROW_ANNOTATION_ADDED,
  SIDE_ROW_ANNOTATION_CHANGED,
  SIDE_ROW_ANNOTATION_REMOVED,
  SIDE_ROW_DELETED_TEXT,
  SIDE_ROW_GRAPHICS,
  SIDE_ROW_INSERTED,
  SIDE_ROW_LAYOUT,
  SIDE_ROW_LEFT,
  SIDE_ROW_PAGE_SIZE,
  SIDE_ROW_PAGES,
  SIDE_ROW_REMOVED,
  SIDE_ROW_REPLACED,
  SIDE_ROW_RIGHT,
  SIDE_ROW_TEXT,
  SIDE_STOP,
  SIDE_PICK_SECOND,
  SIDE_SUBTITLE,
  SIDE_TITLE,
  SIDE_ZOOM,
  SIDE_ZOOM_IN,
  SIDE_ZOOM_OUT,
} from './messages/en.js';
import { PageList } from './PageList.js';
import { FIRST_PAGE, pdfjsPageOf } from './pageNumbering.js';
import { Icon } from './primitives/Icon.js';
import { IconButton } from './primitives/IconButton.js';
import { renderPage } from './renderPage.js';
import type { RulerUnit } from './rulerGeometry.js';
import {
  type CompareRow,
  type ComparisonOutcome,
  type ComparisonResult,
  type DrawnPage,
  compareSides,
} from './sideBySideCompare.js';
import { useDocumentView } from './useDocumentView.js';
import { type ZoomMode, type ZoomStep, stepZoom } from './zoom.js';

/** One open document, as a half's list names it. */
export interface SideDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
  readonly name: string;
}

export type Side = 'left' | 'right';

/** Draws one page small from a half's view, for the comparison — `renderPage` in the product, a stub in a case. */
export type DrawComparePage = (view: DocumentView, page: number, signal: AbortSignal) => Promise<DrawnPage>;

/** The reader's drawing preferences, which both halves take as the document pane does. */
export interface SidePreferences {
  readonly unit: RulerUnit;
  readonly tileAbove: number;
  readonly quality: number;
  readonly pageBadges: boolean;
  readonly smoothScroll: boolean;
  readonly zoomStep: ZoomStep;
}

/** Where the comparison is: not run, running, or ended one of the runner's ways. */
type Comparing =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly done: number; readonly total: number; readonly stop: AbortController }
  | { readonly kind: 'failed' }
  | Exclude<ComparisonOutcome, { readonly kind: 'cancelled' }>;

/**
 * The scale the comparison draws a page at, in pixels per point: a Letter page is 306 × 396 pixels. Fine enough for a
 * picture cell of `RASTER_CELL_POINTS` to be four pixels across, and small enough that a walk of a long document draws
 * quickly; the ADR states the coarseness as a limit.
 */
export const COMPARE_PIXELS_PER_POINT = 0.5;

/** Rec. 601's luma weights, the conventional grey of an RGB pixel. */
const LUMA = [0.299, 0.587, 0.114] as const;

/**
 * Draws a page small for the comparison through `renderPage`, PDF.js' one drawing path here, onto a canvas nobody
 * sees, and reads it back as luminance. The canvas's backing store is dropped as soon as the pixels are read, for
 * `renderPage`'s own `release` reason: a walk draws many pages in a row.
 */
export const drawForComparison: DrawComparePage = async (view, page, signal) => {
  const canvas = window.document.createElement('canvas');
  try {
    const drawn = await renderPage(view.document, pdfjsPageOf(page), canvas, COMPARE_PIXELS_PER_POINT, undefined, signal);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('the comparison canvas has no 2d context to read');
    const { width, height } = canvas;
    const rgba = context.getImageData(0, 0, width, height).data;
    const luminance = new Uint8Array(width * height);
    for (let at = 0; at < luminance.length; at += 1) {
      luminance[at] = Math.round(LUMA[0] * (rgba[at * 4] ?? 255) + LUMA[1] * (rgba[at * 4 + 1] ?? 255) + LUMA[2] * (rgba[at * 4 + 2] ?? 255));
    }
    return { raster: { width, height, pixelsPerPoint: COMPARE_PIXELS_PER_POINT, luminance }, crop: drawn.crop, rotation: drawn.rotation };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

/** Nothing: a half's version is the tab's, and the tab's own layer is what follows it (see `SideBySide`). */
const ignoreVersion = (): void => undefined;
/** A module constant so its identity is stable; see `SideBySide`'s *no prompt here*. */
const declinePassword = (): Promise<string | undefined> => Promise.resolve(undefined);
const ignorePage = (_page: number): void => undefined;

/**
 * Side by Side — two documents, each in its own half, and a comparison of them (the owner's design from the old app,
 * FEATURES row 66, ADR-0131).
 *
 * ## Each half is its own parse, and the half showing the current document reads its unsaved edits
 *
 * A half is a page list over its own `DocumentView`, bound to that document's version, so main answers its ranges out
 * of that version's canonical image and refuses any other (ADR-0031). The canonical image is what holds a document's
 * unsaved edits, so the current document compares as it is on screen rather than as it is on disk. Two documents are
 * two parses by necessity; the cost lasts exactly as long as this surface is open, because the hook closes what it
 * opened.
 *
 * ## No prompt here
 *
 * A half shows a document that is already open in a tab, and opening it there is where its password was asked for. A
 * second prompt would ask twice for one document, so a half that meets a locked document it cannot read says so.
 *
 * ## What it reports to the rest of the window: nothing
 *
 * Its pages are not the status bar's, and it covers the ribbon, the page area and the panels while it is open, so no
 * command acts on a page here. Esc and Close end it and the window is as it was.
 *
 * ## The comparison runs when asked
 *
 * A walk reads every page of both documents. That is a cost a reader chooses, as Acrobat's Compare is, so it starts
 * on *Compare*, reports how far it has got, can be cancelled, and is dropped when either half changes document.
 */
export function SideBySide({
  client,
  documents,
  left,
  right,
  onPick,
  onOpenFile,
  onClose,
  draw,
  preferences,
}: {
  readonly client: ContractClient;
  /** Every open document, as each half's choices — the current one included. */
  readonly documents: readonly SideDocument[];
  readonly left: SideDocument;
  readonly right: SideDocument;
  readonly onPick: (side: Side, docId: DocId) => void;
  /** Opens a document from disk through main's own open path, for that half. */
  readonly onOpenFile: (side: Side) => void;
  readonly onClose: () => void;
  readonly draw: DrawComparePage;
  readonly preferences: SidePreferences;
}): ReactElement {
  const { i18n } = useLingui();
  const leftView = useDocumentView(client, left, ignoreVersion, declinePassword);
  const rightView = useDocumentView(client, right, ignoreVersion, declinePassword);

  // KEYED ON THE PAIR, so a comparison of two other documents is never shown: picking another document drops it by
  // render, rather than by an effect that would show the stale list for a frame first.
  const pairKey = `${left.docId}@${String(left.version)}|${right.docId}@${String(right.version)}`;
  // `listed`: whether the Differences panel is open. Its close hides the panel and every mark with it, and keeps the
  // finished comparison, which is still the answer for this pair until either half changes.
  const [comparing, setComparing] = useState<{ readonly key: string; readonly state: Comparing; readonly listed: boolean }>({
    key: pairKey,
    state: { kind: 'idle' },
    listed: false,
  });
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [goTo, setGoTo] = useState<{ readonly left: number | undefined; readonly right: number | undefined }>({
    left: undefined,
    right: undefined,
  });
  if (comparing.key !== pairKey) {
    if (comparing.state.kind === 'running') comparing.state.stop.abort();
    setComparing({ key: pairKey, state: { kind: 'idle' }, listed: false });
    setChosen(undefined);
  }
  const state = comparing.state;
  const listed = comparing.listed && state.kind !== 'idle';
  // NO MARKS WITHOUT THE PANEL: a tint on a page with no list beside it names a change nobody can read.
  const result: ComparisonResult | undefined = listed && state.kind === 'done' ? state.result : undefined;
  // THE ANSWER FOR THIS PAIR IS ALREADY HELD: the state resets whenever either half's document or version moves, so a
  // finished comparison is current by construction, and walking both documents again would find the same list.
  const current = state.kind === 'done';
  // ON SHOW ALREADY: the panel is open on the current answer, so Compare has nothing to do.
  const answered = listed && current;
  // ONE DOCUMENT IN BOTH HALVES (F-H2): a document compared with itself has nothing to find, so Compare is not offered
  // and the bar says how to choose a second.
  const alone = left.docId === right.docId;
  const hintId = useId();

  const section = useRef<HTMLElement>(null);
  // FOCUS ARRIVES HERE ON OPENING, so Esc works at once: the control that opened it is now covered.
  useEffect(() => {
    section.current?.focus();
  }, []);
  // A WALK STILL RUNNING WHEN THIS CLOSES is stopped, so it reads nothing for a surface that is gone.
  const running = state.kind === 'running' ? state.stop : undefined;
  useEffect(
    () => (): void => {
      running?.abort();
    },
    [running],
  );

  const start = (): void => {
    const leftReady = leftView.ready;
    const rightReady = rightView.ready;
    if (leftReady === undefined || rightReady === undefined) return;
    if (current) {
      setComparing((held) => ({ ...held, listed: true }));
      return;
    }
    const stop = new AbortController();
    const key = pairKey;
    setChosen(undefined);
    setComparing({ key, state: { kind: 'running', done: 0, total: 0, stop }, listed: true });
    const sideOf = (document: SideDocument, view: DocumentView) => ({
      docId: document.docId,
      version: view.version,
      pageCount: view.document.numPages,
      draw: (page: number, signal: AbortSignal) => draw(view, page, signal),
    });
    compareSides(client, sideOf(left, leftReady), sideOf(right, rightReady), stop.signal, (done, total) => {
      setComparing((held) =>
        held.key === key && held.state.kind === 'running' ? { ...held, state: { ...held.state, done, total } } : held,
      );
    }).then(
      (outcome) => {
        setComparing((held) =>
          held.key !== key ? held : { ...held, state: outcome.kind === 'cancelled' ? { kind: 'idle' } : outcome },
        );
      },
      // A PAGE THAT COULD NOT BE DRAWN ends the walk and says so; the list is not shown, because a part reads as the whole.
      () => {
        setComparing((held) => (held.key !== key ? held : { ...held, state: { kind: 'failed' } }));
      },
    );
  };

  // CLOSES THE PANEL, stopping a walk still running, and gives the focus back to the surface so the next Esc closes
  // Side by Side: the control that had it is gone with the panel.
  const closeList = (): void => {
    if (state.kind === 'running') state.stop.abort();
    setChosen(undefined);
    setComparing((held) => ({ ...held, listed: false }));
    section.current?.focus();
  };

  const marks = useMemo(() => marksOf(result?.rows ?? [], chosen), [result, chosen]);

  const choose = (index: number, row: CompareRow): void => {
    setChosen(index);
    // BOTH HALVES GO, always: a page only one document has takes the other half to the place it would be (`near`), so a
    // chosen row never leaves one half where it was.
    setGoTo(
      row.kind === 'removed'
        ? { left: row.left, right: row.near }
        : row.kind === 'inserted'
          ? { left: row.near, right: row.right }
          : { left: row.left, right: row.right },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    // THE INNERMOST FIRST: an open Differences panel closes before the surface it sits in.
    if (listed) closeList();
    else onClose();
  };

  return (
    <section
      aria-label={i18n._(SIDE_TITLE)}
      className="m-side"
      data-side-by-side=""
      onKeyDown={onKeyDown}
      ref={section}
      tabIndex={-1}
    >
      <header className="m-split__bar">
        <span className="m-split__title">{i18n._(SIDE_TITLE)}</span>
        <span className="m-split__of" data-side-alone={alone ? '' : undefined} id={hintId}>
          {i18n._(alone ? SIDE_PICK_SECOND : SIDE_SUBTITLE)}
        </span>
        <span className="m-split__spacer" />
        {state.kind === 'running' ? (
          <span className="m-split__of" data-side-progress="" role="status">
            {i18n._(SIDE_COMPARING, { done: state.done, total: Math.max(state.total, state.done) })}
          </span>
        ) : null}
        {/* COMPARE BECOMES STOP: ONE BUTTON, its words and action swapped, never two. Two would unmount the one the
            person just pressed, the focus would fall to the page's body, and Esc would then reach nothing here.
            ARIA-DISABLED, NOT DISABLED, for the same reason: while the panel shows the current answer there is nothing
            to compare, and a natively disabled button drops the focus it holds. Base UI's focusable-disabled button is
            not the spelling either: it cancels every key but Tab, Esc included, so the surface below would skip it. */}
        <button
          aria-describedby={alone ? hintId : undefined}
          aria-disabled={answered || alone ? 'true' : undefined}
          className="m-split__both"
          data-side-compare={state.kind === 'running' ? undefined : ''}
          data-side-stop={state.kind === 'running' ? '' : undefined}
          disabled={state.kind !== 'running' && (leftView.ready === undefined || rightView.ready === undefined)}
          onClick={() => {
            if (state.kind === 'running') state.stop.abort();
            else if (!answered && !alone) start();
          }}
          type="button"
        >
          {i18n._(state.kind === 'running' ? SIDE_STOP : SIDE_COMPARE)}
        </button>
        <button aria-label={i18n._(SIDE_CLOSE)} className="m-split__both" data-side-close="" onClick={onClose} type="button">
          <Icon name="X" size="dense" />
          {i18n._(SIDE_CLOSE_TEXT)}
        </button>
      </header>
      <div className={`m-side__body${listed ? ' m-side__body--listed' : ''}`}>
        <Half
          client={client}
          side="left"
          shown={left}
          documents={documents}
          view={leftView}
          differences={marks.left}
          goTo={goTo.left}
          onWentTo={() => {
            setGoTo((current) => ({ ...current, left: undefined }));
          }}
          onPick={onPick}
          onOpenFile={onOpenFile}
          preferences={preferences}
        />
        <Half
          client={client}
          side="right"
          shown={right}
          documents={documents}
          view={rightView}
          differences={marks.right}
          goTo={goTo.right}
          onWentTo={() => {
            setGoTo((current) => ({ ...current, right: undefined }));
          }}
          onPick={onPick}
          onOpenFile={onOpenFile}
          preferences={preferences}
        />
        {comparing.listed && state.kind !== 'idle' ? (
          <Differences state={state} chosen={chosen} onChoose={choose} onClose={closeList} />
        ) : null}
      </div>
    </section>
  );
}

/** A half's view, as `useDocumentView` answers it. */
interface HalfView {
  readonly ready: DocumentView | undefined;
  readonly failed: boolean;
}

/** One half: its toolbar — which document, open another, its own zoom — over its own continuous page list. */
function Half({
  client,
  side,
  shown,
  documents,
  view,
  differences,
  goTo,
  onWentTo,
  onPick,
  onOpenFile,
  preferences,
}: {
  readonly client: ContractClient;
  readonly side: Side;
  readonly shown: SideDocument;
  readonly documents: readonly SideDocument[];
  readonly view: HalfView;
  readonly differences: ReadonlyMap<number, readonly DifferenceMark[]>;
  readonly goTo: number | undefined;
  readonly onWentTo: () => void;
  readonly onPick: (side: Side, docId: DocId) => void;
  readonly onOpenFile: (side: Side) => void;
  readonly preferences: SidePreferences;
}): ReactElement {
  const { i18n } = useLingui();
  const pickerId = useId();
  // FIT WIDTH TO START, so both documents fill their halves whatever their page sizes; each half zooms on its own.
  const [mode, setMode] = useState<ZoomMode>({ kind: 'fit-width' });
  const [shownZoom, setShownZoom] = useState(1);
  const step = (direction: 'in' | 'out'): void => {
    setMode(stepZoom(direction, preferences.zoomStep)(shownZoom));
  };
  const ready = view.ready;

  return (
    <div className="m-side__half" data-side-half={side}>
      <div className="m-side__tools">
        <label className="m-split__field" htmlFor={pickerId}>
          {i18n._(side === 'left' ? SIDE_LEFT : SIDE_RIGHT)}
          <select
            aria-label={i18n._(SIDE_DOCUMENT, { side: i18n._(side === 'left' ? SIDE_LEFT : SIDE_RIGHT) })}
            className="m-side__pick"
            data-side-pick={side}
            id={pickerId}
            onChange={(event) => {
              const picked = documents.find((document) => document.docId === event.target.value);
              if (picked !== undefined) onPick(side, picked.docId);
            }}
            value={shown.docId}
          >
            {documents.map((document) => (
              <option key={document.docId} value={document.docId}>
                {document.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="m-split__both"
          data-side-open={side}
          onClick={() => {
            onOpenFile(side);
          }}
          type="button"
        >
          <Icon name="FolderOpen" size="dense" />
          {i18n._(SIDE_OPEN)}
        </button>
        <span className="m-split__spacer" />
        <IconButton
          icon={ZoomOut}
          label={SIDE_ZOOM_OUT}
          onClick={() => {
            step('out');
          }}
          size="dense"
        />
        <span className="m-side__zoom" data-side-zoom={side}>
          {i18n._(SIDE_ZOOM, { percent: Math.round(shownZoom * 100) })}
        </span>
        <IconButton
          icon={ZoomIn}
          label={SIDE_ZOOM_IN}
          onClick={() => {
            step('in');
          }}
          size="dense"
        />
      </div>
      {view.failed ? (
        <canvas className="m-page" data-failed="true" />
      ) : ready === undefined ? (
        <div className="m-page-pane" />
      ) : (
        <PageList
          client={client}
          view={ready}
          pageCount={ready.document.numPages}
          docId={shown.docId}
          version={ready.version}
          onCurrentPage={ignorePage}
          mode={mode}
          onZoomStep={step}
          onShownZoom={setShownZoom}
          goTo={goTo}
          startAt={FIRST_PAGE.kernel}
          onWentTo={onWentTo}
          loupe={false}
          rulers={false}
          showGrid={false}
          // NO LINKS FOLLOWED in a comparison: its pages are read against each other, and a press on one is a place to
          // look at, not a way out of the document.
          onFollowLink={undefined}
          linksOutlined={false}
          // NOR ARE FIELDS FILLED there (ADR-0168), for the links' reason.
          onFillField={undefined}
          unit={preferences.unit}
          // NAMED WITH ITS SIDE AND DOCUMENT: two scrollable regions a screen-reader user cannot tell apart is what the
          // label exists to prevent.
          label={SIDE_HALF_LABEL}
          labelValues={{ side: i18n._(side === 'left' ? SIDE_LEFT : SIDE_RIGHT), name: shown.name }}
          // NOTHING: the find bar searched the document in the tab, not this half.
          search={undefined}
          // NOTHING TYPED HERE: a comparison's halves take no tool, so nothing asks either one for words.
          writing={undefined}
          differences={differences}
          // NO SPOTLIGHT: the accessibility tools mark the document in its own view, not a comparison's half.
          spotlights={undefined}
          // PDF.JS, ALWAYS: a difference a reader sees has to be one between the DOCUMENTS, and §6.1's second engine
          // draws measurably differently (12.716 levels over inked pixels), which one half could show and not the other.
          secondRasteriser={undefined}
          tileAbove={preferences.tileAbove}
          quality={preferences.quality}
          pageBadges={preferences.pageBadges}
          smoothScroll={preferences.smoothScroll}
          // CONTINUOUS, the owner's design: each half scrolls through its whole document.
          layout="continuous"
          // NO PAGE MENU: every page item acts on the document in the tab, and these pages are not that.
          menuAt={undefined}
        />
      )}
    </div>
  );
}

/** The summary list: one row per change, chosen to take both halves to it. */
function Differences({
  state,
  chosen,
  onChoose,
  onClose,
}: {
  readonly state: Exclude<Comparing, { readonly kind: 'idle' }>;
  readonly chosen: number | undefined;
  readonly onChoose: (index: number, row: CompareRow) => void;
  /** Hides the panel and its marks; a walk still running stops. */
  readonly onClose: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const headingId = useId();
  return (
    <aside aria-labelledby={headingId} className="m-side__list" data-side-differences="">
      <div className="m-side__list-head">
        <h2 className="m-side__heading" id={headingId}>
          {i18n._(SIDE_DIFFERENCES)}
        </h2>
        <IconButton icon={X} label={SIDE_DIFFERENCES_CLOSE} onClick={onClose} size="dense" />
      </div>
      {state.kind === 'running' ? null : state.kind === 'refused' ? (
        <p className="m-side__note">{i18n._(SIDE_REFUSED)}</p>
      ) : state.kind === 'moved' ? (
        <p className="m-side__note">{i18n._(SIDE_MOVED)}</p>
      ) : state.kind === 'failed' ? (
        <p className="m-side__note">{i18n._(SIDE_FAILED)}</p>
      ) : state.result.rows.length === 0 ? (
        <>
          <p className="m-side__note" data-side-what="">
            {i18n._(SIDE_WHAT)}
          </p>
          <p className="m-side__note">{i18n._(SIDE_NONE)}</p>
        </>
      ) : (
        <>
          {/* WHAT IS COMPARED, said first: the owner compared two unrelated files and read *Page removed* and *Page added*
              as an error (2026-10-06). Pages are matched by what is on them before anything else is compared, and a
              page with no match is added or removed — which is a finding about the two documents, not a fault. */}
          <p className="m-side__note" data-side-what="">
            {i18n._(SIDE_WHAT)}
          </p>
          {/* NO PAGE IN COMMON is its own sentence, above a list that would otherwise read as one removal and one
              addition per page: two documents that share nothing are different documents, and the list says so. */}
          {state.result.matched === 0 ? (
            <p className="m-side__note m-side__note--lead" data-side-no-common="" role="note">
              {i18n._(SIDE_NO_COMMON)}
            </p>
          ) : null}
          <p className="m-side__note" data-side-count="">
            {i18n._(SIDE_COUNT, { count: state.result.found })}
          </p>
          {state.result.more ? <p className="m-side__note">{i18n._(SIDE_MORE, { count: state.result.rows.length })}</p> : null}
          {state.result.clipped > 0 ? <p className="m-side__note">{i18n._(SIDE_CLIPPED, { count: state.result.clipped })}</p> : null}
          <ol className="m-side__rows">
            {state.result.rows.map((row, index) => (
              // THE ROW'S PLACE IN ONE FINISHED LIST, which never reorders: a new comparison is a new list.
              <li key={index}>
                <button
                  aria-current={chosen === index ? 'true' : undefined}
                  className="m-side__row"
                  data-side-row={row.kind}
                  onClick={() => {
                    onChoose(index, row);
                  }}
                  type="button"
                >
                  <span className={`m-side__kind m-side__kind--${row.kind}`}>{i18n._(rowTitle(row))}</span>
                  <span className="m-side__where">{rowWhere(row, i18n._.bind(i18n))}</span>
                  {rowDetail(row, i18n._.bind(i18n))}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

function rowTitle(row: CompareRow): MessageKey {
  switch (row.kind) {
    case 'inserted':
      return SIDE_ROW_INSERTED;
    case 'removed':
      return SIDE_ROW_REMOVED;
    case 'text':
      return SIDE_ROW_TEXT;
    case 'graphics':
      return SIDE_ROW_GRAPHICS;
    case 'layout':
      return row.change.pageSize === true ? SIDE_ROW_PAGE_SIZE : SIDE_ROW_LAYOUT;
    case 'annotation':
      return row.change.annotation?.what === 'added'
        ? SIDE_ROW_ANNOTATION_ADDED
        : row.change.annotation?.what === 'removed'
          ? SIDE_ROW_ANNOTATION_REMOVED
          : SIDE_ROW_ANNOTATION_CHANGED;
  }
}

function rowWhere(row: CompareRow, _: Translate): string {
  if (row.kind === 'inserted') return _(SIDE_ROW_RIGHT, { page: pdfjsPageOf(row.right) });
  if (row.kind === 'removed') return _(SIDE_ROW_LEFT, { page: pdfjsPageOf(row.left) });
  return _(SIDE_ROW_PAGES, { left: pdfjsPageOf(row.left), right: pdfjsPageOf(row.right) });
}

function rowDetail(row: CompareRow, _: Translate): ReactElement | null {
  if (row.kind !== 'text') return null;
  const removed = row.change.removed ?? '';
  const inserted = row.change.inserted ?? '';
  const text =
    removed !== '' && inserted !== ''
      ? _(SIDE_ROW_REPLACED, { removed, inserted })
      : removed !== ''
        ? _(SIDE_ROW_DELETED_TEXT, { text: removed })
        : _(SIDE_ROW_ADDED_TEXT, { text: inserted });
  return <span className="m-side__detail">{text}</span>;
}

/** Each half's marks by page, the chosen row's drawn as active. */
function marksOf(
  rows: readonly CompareRow[],
  chosen: number | undefined,
): { readonly left: ReadonlyMap<number, readonly DifferenceMark[]>; readonly right: ReadonlyMap<number, readonly DifferenceMark[]> } {
  const left = new Map<number, DifferenceMark[]>();
  const right = new Map<number, DifferenceMark[]>();
  const put = (into: Map<number, DifferenceMark[]>, page: number, boxes: readonly CompareBox[], kind: DifferenceMark['kind'], active: boolean): void => {
    if (boxes.length === 0) return;
    const list = into.get(page) ?? [];
    for (const box of boxes) list.push({ box, kind, active });
    into.set(page, list);
  };
  rows.forEach((row, index) => {
    const active = index === chosen;
    if (row.kind === 'inserted') put(right, row.right, [row.box], 'page', active);
    else if (row.kind === 'removed') put(left, row.left, [row.box], 'page', active);
    else {
      put(left, row.left, row.change.left, row.kind, active);
      put(right, row.right, row.change.right, row.kind, active);
    }
  });
  return { left, right };
}
