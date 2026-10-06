import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { CONTEXT_PANEL_RESIZE, PANEL_RESIZE } from '../messages/en.js';
import { type PanelPresence, usePanelForm } from '../panelPresence.js';
import { Splitter } from '../primitives/Splitter.js';
import {
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  CONTEXT_PANEL_WIDTH_SETTING,
  DOCUMENT_PANEL_MAX_WIDTH,
  DOCUMENT_PANEL_MIN_WIDTH,
  DOCUMENT_PANEL_WIDTH_SETTING,
  LAYOUT_MODE_SETTING,
  PAGE_AREA_MIN_WIDTH,
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
 * open"*, beside each panel's own open setting (B3). So the setting decides — read through
 * `panelPresence.ts`, which also knows whether a narrow row holds the side — and the splitter is told
 * through `open`: a side out of the row stays in it as a zero-width pane with no content and no
 * handle, and its surface draws its reopen handle beside the row instead. Nothing about its width
 * changes while it is out.
 *
 * It stays IN the row rather than being left out, which is what this did until 2026-09-15: leaving
 * it out changed the number of panes, and the machine lays panes out by index from a size list it
 * re-syncs in a later effect. Read once right after the collapse, on CI, the left pane was 81.92 px
 * wider, on two pushes of three (`Splitter.tsx`, "a shut side is still a pane").
 *
 * ## A NARROW ROW KEEPS THE PAGE, and a side gives way rather than the page
 *
 * [ADR-0146](../../../../docs/DECISIONS/0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md): the page area
 * has a floor, `PAGE_AREA_MIN_WIDTH`, which the splitter holds for it, so the side panels narrow towards their own
 * minimums first. When the row cannot hold the floor beside them, the right side and then the left give way: each is
 * drawn as its handle, outside the splitter, as a shut side is, and opens from it as a sheet. Whether a side is in the
 * row is `panelPresence.ts`' answer from this row's measured width, not either open setting, which nothing here
 * writes — the same rule as Focus below, applied to width.
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
  /** Whether each side is in the row, and what this row's width says about it (ADR-0146). */
  readonly presence: PanelPresence;
  /**
   * Whether this row reports its width to `presence`. Exactly one does: the document on show. A layer kept behind it
   * (ADR-0129) is laid out in the same box and reads the same answer, and a second writer of one measurement is B3's
   * defect however equal the numbers happen to be.
   */
  readonly measuresRow: boolean;
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

export function DocumentBody({
  settings,
  presence,
  measuresRow,
  panel,
  page,
  contextPanel,
  quickToolbar,
}: DocumentBodyProps): ReactElement {
  const panelInRow = usePanelForm(presence, 'start') === 'row';
  const panelWidth = useSetting(settings, DOCUMENT_PANEL_WIDTH_SETTING);
  const contextInRow = usePanelForm(presence, 'end') === 'row';
  const contextWidth = useSetting(settings, CONTEXT_PANEL_WIDTH_SETTING);
  const focus = useSetting(settings, LAYOUT_MODE_SETTING) === 'focus';
  const body = useRef<HTMLDivElement>(null);

  // THE ROW'S WIDTH, as laid out, to the one place that decides from it (ADR-0146). Its own box, which neither a handle
  // nor a sheet changes: each is inside it, so what it decides cannot move because of what it drew.
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null || !measuresRow || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      presence.measure(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [measuresRow, presence]);

  return (
    <div className="m-document-body" ref={body}>
      {focus || panelInRow ? null : panel}
      <Splitter
        start={{
          content: panel,
          label: PANEL_RESIZE,
          width: panelWidth,
          minWidth: DOCUMENT_PANEL_MIN_WIDTH,
          maxWidth: DOCUMENT_PANEL_MAX_WIDTH,
          maxShare: SIDE_PANEL_MAX_SHARE,
          open: !focus && panelInRow,
          onWidthChange: (next) => {
            settings.set(DOCUMENT_PANEL_WIDTH_SETTING.id, next);
          },
        }}
        middle={
          <div className="m-canvas-area" data-pane="pages">
            {page}
            {quickToolbar}
          </div>
        }
        middleMinWidth={PAGE_AREA_MIN_WIDTH}
        end={{
          content: contextPanel,
          label: CONTEXT_PANEL_RESIZE,
          width: contextWidth,
          minWidth: CONTEXT_PANEL_MIN_WIDTH,
          maxWidth: CONTEXT_PANEL_MAX_WIDTH,
          maxShare: SIDE_PANEL_MAX_SHARE,
          open: !focus && contextInRow,
          onWidthChange: (next) => {
            settings.set(CONTEXT_PANEL_WIDTH_SETTING.id, next);
          },
        }}
      />
      {focus || contextInRow ? null : contextPanel}
    </div>
  );
}
