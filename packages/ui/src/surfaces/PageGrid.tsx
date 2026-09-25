import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import type { ReactElement, ReactNode } from 'react';

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
import { ORGANIZE_GRID_SIZE_SETTING, ORGANIZE_GRID_WIDTHS } from '../settings/appearance.js';
import type { SettingsStore } from '../settingsStore.js';
import { Thumbnails } from '../Thumbnails.js';
import { useSetting } from '../useSetting.js';

const SIZE_OPTIONS = [
  { value: 'medium', label: ORGANIZE_GRID_SIZE_OPTION_TITLES.medium },
  { value: 'large', label: ORGANIZE_GRID_SIZE_OPTION_TITLES.large },
] as const;

/**
 * The Organize section's canvas: every page as a card (the owner's v5-09, ADR-0104).
 *
 * ## The strip, laid out across the canvas
 *
 * The cards are `Thumbnails` with its `grid` half, so dragging, the keyboard reorder and the lazy drawing are
 * the side strip's own — one implementation of each (B3a). What this adds is the line above them — how many
 * pages, how many ticked, what the gestures are — and the Medium / Large control, which is the grid's own
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

  return (
    <section aria-label={i18n._(ORGANIZE_GRID_LABEL)} className="m-page-grid">
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
        grid={{ width: ORGANIZE_GRID_WIDTHS[size], selected, onSelect, onOpen, onDelete }}
      />
    </section>
  );
}
