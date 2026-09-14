import type { ReactElement, ReactNode } from 'react';

import { PANEL_RESIZE } from '../messages/en.js';
import { Splitter } from '../primitives/Splitter.js';
import {
  DOCUMENT_PANEL_MAX_WIDTH,
  DOCUMENT_PANEL_MIN_WIDTH,
  DOCUMENT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_WIDTH_SETTING,
} from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';

/**
 * The document's row: the document panel beside the page area, the panel resizable (§10.3:
 * *"panels resizable with persisted widths"*).
 *
 * ## ONE row for all three of `PageCanvas`' states
 *
 * The panel renders while a document is loading, when PDF.js could not parse it, and once it has
 * (design pass C). A splitter needs the panel and the page area as siblings under one root, so the
 * row is its own surface and each state hands it the two panes — three copies of the arrangement
 * would be three places for the width to be forgotten.
 *
 * ## Collapsed has no splitter, and the open setting stays the one owner
 *
 * The machine can collapse a panel itself. Using that would be a second writer of *"is the panel
 * open"*, beside `appearance.document-panel-open` (B3). So a collapsed panel renders without a
 * splitter at all — `DocumentPanel` draws its reopen handle — and nothing about the width changes
 * while it is shut.
 *
 * ## The width is a setting, written when a resize ends
 *
 * `appearance.document-panel-width` is the writer of record, in CSS pixels. The splitter reports a
 * finished resize in those pixels, so one drag is one write and a launch opens at the stored width.
 */
export interface DocumentBodyProps {
  readonly settings: SettingsStore;
  /** The document panel, which draws its own reopen handle when collapsed. */
  readonly panel: ReactNode;
  /** The page area beside it. */
  readonly page: ReactNode;
}

export function DocumentBody({ settings, panel, page }: DocumentBodyProps): ReactElement {
  const open = useSetting(settings, DOCUMENT_PANEL_OPEN_SETTING);
  const width = useSetting(settings, DOCUMENT_PANEL_WIDTH_SETTING);

  if (!open) {
    return (
      <div className="m-document-body">
        {panel}
        {page}
      </div>
    );
  }

  return (
    <div className="m-document-body">
      <Splitter
        label={PANEL_RESIZE}
        width={width}
        minWidth={DOCUMENT_PANEL_MIN_WIDTH}
        maxWidth={DOCUMENT_PANEL_MAX_WIDTH}
        onWidthChange={(next) => {
          settings.set(DOCUMENT_PANEL_WIDTH_SETTING.id, next);
        }}
        start={panel}
        end={page}
      />
    </div>
  );
}
