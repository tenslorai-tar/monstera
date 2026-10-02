import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import type { DocumentView } from '../documentView.js';
import {
  ORGANIZE_GRID_COUNT,
  ORGANIZE_GRID_HINT,
  ORGANIZE_GRID_LABEL,
  ORGANIZE_GRID_SELECTED,
  ORGANIZE_GRID_SIZE_OPTION_TITLES,
  ORGANIZE_GRID_SIZE_TITLE,
} from '../messages/en.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { ORGANIZE_GRID_SIZE_SETTING, ORGANIZE_THUMBNAIL_WIDTH } from '../settings/appearance.js';
import type { SettingsStore } from '../settingsStore.js';
import { Thumbnails } from '../Thumbnails.js';
import { useSetting } from '../useSetting.js';

const SIZE_OPTIONS = [
  { value: 'thumbnail', label: ORGANIZE_GRID_SIZE_OPTION_TITLES.thumbnail },
  { value: 'full-page', label: ORGANIZE_GRID_SIZE_OPTION_TITLES['full-page'] },
] as const;

/**
 * The width a *Full page* card's picture may take: the grid's own box, less its padding and less what a card draws
 * either side of its picture (its border and padding). All of it is READ from the laid-out grid rather than restated
 * here, so a stylesheet change to a card cannot leave a page a few pixels wider than the room it was given — which
 * would be a sideways scroll. `undefined` until there is a card to read, or where the box has no room at all.
 */
function fullPageWidth(grid: HTMLElement): number | undefined {
  const pages = grid.querySelector<HTMLElement>('.m-thumbnails');
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
  onOpen,
  onMove,
  onDelete,
  pageMenu,
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
  /** Goes to a page in the reading view. */
  readonly onOpen: (page: number) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly onDelete: (pages: readonly number[]) => void;
  readonly pageMenu: (page: number, element: ReactElement) => ReactNode;
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
  const width = size === 'full-page' && measured !== undefined ? measured : ORGANIZE_THUMBNAIL_WIDTH;

  return (
    <section aria-label={i18n._(ORGANIZE_GRID_LABEL)} className="m-page-grid" data-page-view={size} ref={section}>
      <header className="m-page-grid__head">
        <p className="m-page-grid__summary">
          <strong>{i18n._(ORGANIZE_GRID_COUNT, { count: pageCount })}</strong>
          {selected.length === 0 ? null : <span>{i18n._(ORGANIZE_GRID_SELECTED, { count: selected.length })}</span>}
          <span className="m-page-grid__hint">{i18n._(ORGANIZE_GRID_HINT)}</span>
        </p>
        <SegmentedControl
          label={ORGANIZE_GRID_SIZE_TITLE}
          options={SIZE_OPTIONS}
          value={size}
          onChange={(next) => {
            settings.set(ORGANIZE_GRID_SIZE_SETTING.id, next);
          }}
        />
      </header>
      <Thumbnails
        client={client}
        docId={docId}
        version={version}
        view={view}
        pageCount={pageCount}
        current={current}
        onJump={onOpen}
        onMove={onMove}
        pageMenu={pageMenu}
        grid={{ width, selected, onSelect, onOpen, onDelete }}
      />
    </section>
  );
}
