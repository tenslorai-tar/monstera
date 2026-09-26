import type { ReactElement, ReactNode } from 'react';

import { CONTEXT_PANEL_RESIZE, PANEL_RESIZE } from '../messages/en.js';
import { Splitter } from '../primitives/Splitter.js';
import {
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  CONTEXT_PANEL_OPEN_SETTING,
  CONTEXT_PANEL_WIDTH_SETTING,
  DOCUMENT_PANEL_MAX_WIDTH,
  DOCUMENT_PANEL_MIN_WIDTH,
  DOCUMENT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_WIDTH_SETTING,
  LAYOUT_MODE_SETTING,
  SIDE_PANEL_MAX_SHARE,
} from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';

/**
 * The document's row: the document panel, the page area and the right contextual panel, each side
 * panel resizable (§10.3: *"panels resizable with persisted widths"*).
 *
 * ## ONE row for all three of `PageCanvas`' states
 *
 * The panels render while a document is loading, when PDF.js could not parse it, and once it has
 * (design pass C). A splitter needs every pane as a sibling under one root, so the row is its own
 * surface and each state hands it the panes — three copies of the arrangement would be three
 * places for a width to be forgotten.
 *
 * ## A collapsed side is a pane at zero, and each open setting stays the one owner
 *
 * The machine can collapse a panel itself. Using that would be a second writer of *"is the panel
 * open"*, beside each panel's own open setting (B3). So the setting decides, and the splitter is told
 * through `open`: a collapsed side stays in the row as a zero-width pane with no content and no
 * handle, and its surface draws its reopen handle beside the row instead. Nothing about its width
 * changes while it is shut.
 *
 * It stays IN the row rather than being left out, which is what this did until 2026-09-15: leaving
 * it out changed the number of panes, and the machine lays panes out by index from a size list it
 * re-syncs in a later effect. Read once right after the collapse, on CI, the left pane was 81.92 px
 * wider, on two pushes of three (`Splitter.tsx`, "a shut side is still a pane").
 *
 * ## Each width is a setting, written when a resize at its own handle ends
 *
 * `appearance.document-panel-width` and `appearance.context-panel-width` are the writers of record,
 * in CSS pixels. The splitter writes only the pane that moved, so a drag at one handle is one write
 * and leaves the other side's width alone.
 *
 * ## FOCUS HIDES BOTH SIDES WITHOUT TOUCHING EITHER SETTING
 *
 * §10.3: *"Focus supersedes per-panel collapse state; each panel restores its own prior state on exit"*, and M3:
 * *"reopen handles are hidden in Focus"*. So in Focus neither side renders in any form — open, or collapsed to its
 * reopen handle — and neither open setting is written. Leaving Focus restores each side by construction: the settings
 * never moved.
 */
export interface DocumentBodyProps {
  readonly settings: SettingsStore;
  /** The document panel, which draws its own reopen handle when collapsed. */
  readonly panel: ReactNode;
  /** The page area. */
  readonly page: ReactNode;
  /** The right contextual panel, which draws its own reopen handle when collapsed. */
  readonly contextPanel: ReactNode;
  /**
   * §10.3's floating quick toolbar, *"a vertical pill on the canvas edge"*. It is positioned against
   * the page area it floats over, so it sits inside that pane; fixed to the window it covered the
   * section rail and the document panel (measured 2026-09-15, JOURNAL).
   */
  readonly quickToolbar?: ReactNode;
}

export function DocumentBody({ settings, panel, page, contextPanel, quickToolbar }: DocumentBodyProps): ReactElement {
  const panelOpen = useSetting(settings, DOCUMENT_PANEL_OPEN_SETTING);
  const panelWidth = useSetting(settings, DOCUMENT_PANEL_WIDTH_SETTING);
  const contextOpen = useSetting(settings, CONTEXT_PANEL_OPEN_SETTING);
  const contextWidth = useSetting(settings, CONTEXT_PANEL_WIDTH_SETTING);
  const focus = useSetting(settings, LAYOUT_MODE_SETTING) === 'focus';

  return (
    <div className="m-document-body">
      {focus || panelOpen ? null : panel}
      <Splitter
        start={{
          content: panel,
          label: PANEL_RESIZE,
          width: panelWidth,
          minWidth: DOCUMENT_PANEL_MIN_WIDTH,
          maxWidth: DOCUMENT_PANEL_MAX_WIDTH,
          maxShare: SIDE_PANEL_MAX_SHARE,
          open: !focus && panelOpen,
          onWidthChange: (next) => {
            settings.set(DOCUMENT_PANEL_WIDTH_SETTING.id, next);
          },
        }}
        middle={
          <div className="m-canvas-area">
            {page}
            {quickToolbar}
          </div>
        }
        end={{
          content: contextPanel,
          label: CONTEXT_PANEL_RESIZE,
          width: contextWidth,
          minWidth: CONTEXT_PANEL_MIN_WIDTH,
          maxWidth: CONTEXT_PANEL_MAX_WIDTH,
          maxShare: SIDE_PANEL_MAX_SHARE,
          open: !focus && contextOpen,
          onWidthChange: (next) => {
            settings.set(CONTEXT_PANEL_WIDTH_SETTING.id, next);
          },
        }}
      />
      {focus || contextOpen ? null : contextPanel}
    </div>
  );
}
