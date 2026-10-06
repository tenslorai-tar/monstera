import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DocumentView } from '../documentView.js';
import {
  ORGANIZE_GRID_COUNT,
  ORGANIZE_GRID_HINTS,
  ORGANIZE_GRID_LABEL,
  ORGANIZE_GRID_SELECTED,
  ORGANIZE_GRID_SIZE_OPTION_TITLES,
  ORGANIZE_GRID_SIZE_TITLE,
} from '../messages/en.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { ORGANIZE_GRID_SIZE_SETTING, ORGANIZE_THUMBNAIL_WIDTH } from '../settings/appearance.js';
import type { SettingsStore } from '../settingsStore.js';
import { Thumbnails } from '../Thumbnails.js';
import type { MenuAt } from './ContextMenu.js';
import { useSetting } from '../useSetting.js';

const SIZE_OPTIONS = [
  { value: 'thumbnail', label: ORGANIZE_GRID_SIZE_OPTION_TITLES.thumbnail },
  { value: 'full-page', label: ORGANIZE_GRID_SIZE_OPTION_TITLES['full-page'] },
] as const;

/**
 * How long a strip being prepared may take before it is shown as it is. A liveness bound and not a figure for how long
 * drawing takes: it exists so a page the engine never answers for cannot leave a size choice doing nothing.
 */
export const PREPARE_LIMIT_MS = 2000;

type OrganizeGridSize = (typeof SIZE_OPTIONS)[number]['value'];

/** The strip on show: its size, under a key that stays with a strip from prepared to shown. */
interface Shown {
  readonly key: number;
  readonly size: OrganizeGridSize;
}

/** What a strip being prepared reports to as it scrolls: nothing, since it is not the one a person is reading. */
const NOT_READING = { onViewing: (): void => undefined };

/**
 * The width a *Full page* card's picture may take: the grid's own box, less its padding and less what a card draws
 * either side of its picture (its border and padding). All of it is READ from the laid-out grid rather than restated
 * here, so a stylesheet change to a card cannot leave a page a few pixels wider than the room it was given — which
 * would be a sideways scroll. `undefined` until there is a card to read, or where the box has no room at all.
 */
function fullPageWidth(grid: HTMLElement): number | undefined {
  // THE LAYER BEING PREPARED when there is one, since that is the strip the width is for (see `PageGrid`).
  const pages =
    grid.querySelector<HTMLElement>('[data-layer="pending"] .m-thumbnails') ?? grid.querySelector<HTMLElement>('.m-thumbnails');
  const card = pages?.querySelector<HTMLElement>('.m-thumb') ?? null;
  if (pages === null || card === null) return undefined;
  const px = (value: string): number => parseFloat(value) || 0;
  const strip = getComputedStyle(pages);
  // `clientWidth` IS THE ROOM LESS A SCROLLBAR, which a long document's strip draws.
  const room = pages.clientWidth - px(strip.paddingLeft) - px(strip.paddingRight);
  // WHAT A CARD DRAWS AROUND ITS PICTURE, from the parts of it that do not depend on the fit — never the card's width
  // less its picture's, which follows the fit at once while a drawn canvas keeps its old size until it redraws, so
  // the output would feed back into its own input.
  const face = getComputedStyle(card);
  const around = px(face.paddingLeft) + px(face.paddingRight) + px(face.borderLeftWidth) + px(face.borderRightWidth);
  const width = Math.floor(room - around);
  return width > 0 ? width : undefined;
}

/**
 * The Organize section's canvas: every page as a card (the owner's v5-09, ADR-0104).
 *
 * ## The strip, laid out across the canvas
 *
 * The cards are `Thumbnails` with its `grid` half, so dragging, the keyboard reorder and the lazy drawing are
 * the side strip's own — one implementation of each (B3a). What this adds is the line above them — how many
 * pages, how many ticked, what the gestures are — and the Thumbnail / Full page control, which is the grid's own
 * remembered value.
 *
 * ## The selection is the document's, and this only reports it
 *
 * `selected` comes from the document's store and `onSelect` writes it there; the commands read it through
 * `targetPages`. Nothing here holds a copy that could disagree with what a command acts on.
 *
 * ## A NEW SIZE IS PREPARED OUT OF SIGHT, and shown finished (the owner's item 13h)
 *
 * Choosing *Full page* changed every card's width at once while its canvas still held the thumbnail: for a frame or a
 * few the page was the small drawing stretched to the grid's width, then the sharp one, card by card — measured
 * frame by frame in Chromium 151, the first card `stale` at 616 px tall for 100 ms with reads slowed to 150 ms. The
 * owner's rule is *never show an unfinished screen*, so a new size is laid out and drawn in a second strip under the
 * one on show, hidden and inert, and replaces it in one frame once every card in its view is drawn at the width asked
 * (`Thumbnails`' `onReady`). The new strip is the same React element afterwards (a stable key), so nothing it drew is
 * drawn again. A strip that is never ready — a page the engine cannot answer for — is shown after
 * {@link PREPARE_LIMIT_MS} with its cards as they are, so a choice never does nothing.
 *
 * THE SIZE ONLY, never a width within one: a window being resized changes the width every frame, and a strip that
 * waited to be ready each time would show the old width overflowing its room — a sideways scroll — for as long as the
 * resize lasts. A size the grid opens in has nothing drawn to go stale, so it is shown at once, as the side strip is.
 */
export function PageGrid({
  client,
  docId,
  version,
  view,
  pageCount,
  current,
  selected,
  settings,
  onSelect,
  onCurrent,
  onViewing,
  goTo,
  onWentTo,
  onOpen,
  onMove,
  onDelete,
  menuAt,
}: {
  readonly client: ContractClient;
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly view: DocumentView;
  readonly pageCount: number;
  readonly current: number;
  readonly selected: readonly number[];
  readonly settings: SettingsStore;
  readonly onSelect: (pages: readonly number[]) => void;
  /** A clicked card becomes the current page — the document's one current page, which the status bar names. */
  readonly onCurrent: (page: number) => void;
  /** The page Full page shows most of, as it scrolls. Thumbnail reports none: many pages are on screen at once. */
  readonly onViewing: (page: number) => void;
  /** The navigator's request for a page: the grid scrolls to its card and reports it taken. */
  readonly goTo: number | undefined;
  readonly onWentTo: () => void;
  /** Goes to a page in the reading view. */
  readonly onOpen: (page: number) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly onDelete: (pages: readonly number[]) => void;
  readonly menuAt: MenuAt<number>;
}): ReactElement {
  const { i18n } = useLingui();
  const size = useSetting(settings, ORGANIZE_GRID_SIZE_SETTING);
  const section = useRef<HTMLElement>(null);
  // FULL PAGE'S WIDTH, measured before the browser paints and again whenever the grid's box changes, so the first
  // frame after choosing it already shows whole-width pages rather than thumbnails that then grow.
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = section.current;
    if (size !== 'full-page' || element === null) return;
    const measure = (): void => {
      setMeasured(fullPageWidth(element));
    };
    measure();
    // THE STRIP'S OWN BOX as well as the section's: the width is read from the strip, which the window and the panels
    // beside it change, and which gains a scrollbar once its pages are taller than it.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const strip = element.querySelector('.m-thumbnails');
    if (strip !== null) observer.observe(strip);
    return (): void => {
      observer.disconnect();
    };
  }, [size]);
  // A THUMBNAIL'S WIDTH while Full page has nothing to measure yet: a card drawn small for a moment is the honest
  // fallback, where a guessed width would be a page cut off or a sideways scroll.
  const widthOf = (of: OrganizeGridSize): number =>
    of === 'full-page' && measured !== undefined ? measured : ORGANIZE_THUMBNAIL_WIDTH;

  // THE STRIP ON SHOW, and the one being prepared whenever the size asked is another (see above). Derived in render,
  // not set by an effect, so the strip to measure is in the page by the time the measuring effect runs.
  const [shown, setShown] = useState<Shown>(() => ({ key: 0, size }));
  const pendingKey = shown.key + 1;
  const pendingSize = shown.size === size ? undefined : size;
  const promote = useCallback((key: number, to: OrganizeGridSize): void => {
    // ONLY THE STRIP STILL BEING PREPARED: a size chosen and unchosen again mints the same key for a new strip, and a
    // report or a limit from the one before must not show it.
    setShown((now) => (now.key + 1 === key ? { key, size: to } : now));
  }, []);
  useEffect(() => {
    if (pendingSize === undefined) return;
    const limit = setTimeout(() => {
      promote(pendingKey, pendingSize);
    }, PREPARE_LIMIT_MS);
    return (): void => {
      clearTimeout(limit);
    };
  }, [pendingKey, pendingSize, promote]);
  // READY AT THE WIDTH ASKED, and for Full page only once that width is measured: a strip drawn at the thumbnail
  // fallback is not the page Full page shows.
  const readyAt = pendingSize === 'full-page' ? measured : ORGANIZE_THUMBNAIL_WIDTH;
  const onReady = useCallback(
    (at: number): void => {
      if (pendingSize !== undefined && at === readyAt) promote(pendingKey, pendingSize);
    },
    [pendingKey, pendingSize, promote, readyAt],
  );
  const layers: readonly Shown[] = pendingSize === undefined ? [shown] : [shown, { key: pendingKey, size: pendingSize }];

  return (
    <section aria-label={i18n._(ORGANIZE_GRID_LABEL)} className="m-page-grid" data-page-view={shown.size} ref={section}>
      <header className="m-page-grid__head">
        {/* THE CLIP AND THE ROW ARE TWO BOXES so a wrapped line cannot start with a separator (app.css). */}
        <div className="m-page-grid__summary">
          <p className="m-page-grid__items">
            <strong>{i18n._(ORGANIZE_GRID_COUNT, { count: pageCount })}</strong>
            {selected.length === 0 ? null : <span>{i18n._(ORGANIZE_GRID_SELECTED, { count: selected.length })}</span>}
            {ORGANIZE_GRID_HINTS.map((hint) => (
              <span className="m-page-grid__hint" key={hint}>
                {i18n._(hint)}
              </span>
            ))}
          </p>
        </div>
        <SegmentedControl
          label={ORGANIZE_GRID_SIZE_TITLE}
          options={SIZE_OPTIONS}
          value={size}
          onChange={(next) => {
            settings.set(ORGANIZE_GRID_SIZE_SETTING.id, next);
          }}
        />
      </header>
      <div className="m-page-grid__pages">
        {layers.map((layer) => {
          const onShow = layer === shown;
          return (
            <div
              key={layer.key}
              className="m-page-grid__layer"
              data-page-view={layer.size}
              data-layer={onShow ? 'shown' : 'pending'}
              inert={!onShow}
            >
              <Thumbnails
                client={client}
                docId={docId}
                version={version}
                view={view}
                pageCount={pageCount}
                current={current}
                onJump={onOpen}
                onMove={onMove}
                menuAt={menuAt}
                onReady={onShow ? undefined : onReady}
                grid={{
                  width: widthOf(layer.size),
                  selected,
                  onSelect,
                  onCurrent,
                  onOpen,
                  onDelete,
                  // THE NAVIGATOR MOVES THE STRIP A PERSON SEES; the one being prepared opens on the current page.
                  goTo: onShow ? goTo : undefined,
                  onWentTo,
                  // ONE PAGE TO A ROW is a reading position, so its scroll names a page; a grid of thumbnails shows many.
                  onePage: layer.size === 'full-page' ? (onShow ? { onViewing } : NOT_READING) : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
