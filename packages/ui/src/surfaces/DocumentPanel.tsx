import { useLingui } from '@lingui/react';
import { Tabs } from '@base-ui/react/tabs';
import { useCallback, type ReactElement, type ReactNode } from 'react';

import type { MessageKey } from '@monstera/shared';

import { PANEL_COLLAPSE, PANEL_REOPEN, PANEL_STRIP_LABEL, PANEL_TOOL_CLOSE } from '../messages/en.js';
import { type PanelPresence, usePanelForm } from '../panelPresence.js';
import { Icon } from '../primitives/Icon.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { DOCUMENT_PANEL_MIN_WIDTH, DOCUMENT_PANEL_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { PanelSheet } from './PanelSheet.js';
import { PANEL_IDS, PANELS, type PanelId } from './panels.js';

/**
 * §10.3's document panel: *"one document panel at a time — Pages, Bookmarks, Comments,
 * Forms, Layers, Search — switched by a panel-tab strip of six icon tabs (24 px tabs, 14 px
 * icons) at the panel's top, with the collapse chevron at the strip's end."*
 *
 * ## WHERE IT LIVES, and why that is not App
 *
 * The Pages panel is the thumbnail strip, and the strip draws through the PDF.js view
 * only `PageCanvas` holds. A strip that opened its own would parse the document twice
 * (see `PageCanvas`' own note on the sidebar). So this host renders inside `PageCanvas`,
 * and the other five panels, whose state lives in `App`, arrive as `panels`.
 *
 * ## THE SETTINGS ARE THE ONE OWNER of which panel shows and whether it is open
 *
 * §10.3: *"State is persisted per panel."* `document.find` opens the Search panel through
 * the same setting, so there is no second place that decides. Whether it is open is written
 * only through `panelPresence.ts`, which also decides whether a narrow row draws it in the
 * row, as a sheet over the page's edge, or as its handle (ADR-0146).
 *
 * ## One panel is mounted, not six hidden
 *
 * Only the chosen panel's content renders. A hidden panel still mounted would keep asking
 * main for outlines and annotation lists nobody can see, and would keep its controls in
 * the tab order behind a panel a reader cannot see.
 */
/**
 * A tool that holds the panel's body for as long as it is in use (ADR-0189): the accessibility tools. It is not a
 * panel of the strip — no tab, no setting — so a launch never opens with one, and closing it leaves the panel as it was.
 */
export interface PanelTool {
  readonly title: MessageKey;
  readonly content: ReactNode;
  readonly onClose: () => void;
}

export interface DocumentPanelProps {
  /** The tool using the panel, or `undefined` for the panel's own chosen one. */
  readonly tool: PanelTool | undefined;
  readonly settings: SettingsStore;
  /** Whether the panel is in the row, a sheet or its handle, and the one writer of its open setting. */
  readonly presence: PanelPresence;
  /** The Pages panel: the thumbnail strip, built where the document view is. */
  readonly pages: ReactNode;
  /** The other five panels, built by `App` where their state lives. */
  readonly panels: Readonly<Record<Exclude<PanelId, 'pages'>, ReactNode>>;
}

export function DocumentPanel({ tool, settings, presence, pages, panels }: DocumentPanelProps): ReactElement {
  const { i18n } = useLingui();
  const chosen = useSetting(settings, DOCUMENT_PANEL_SETTING);
  const form = usePanelForm(presence, 'start');
  const dismiss = useCallback(() => {
    presence.hide('start');
  }, [presence]);

  const panel = (
    <Tabs.Root
      data-pane="document-panel"
      className="m-document-panel"
      value={chosen}
      onValueChange={(value) => {
        // A VALUE FROM THE ROSTER ONLY. Base UI types a tab's value as `unknown`, and every
        // value this strip renders comes from `PANEL_IDS`; anything else is refused by the
        // setting's own schema at `set`.
        settings.set(DOCUMENT_PANEL_SETTING.id, value);
      }}
    >
      <div className="m-document-panel__strip">
        <Tabs.List aria-label={i18n._(PANEL_STRIP_LABEL)} className="m-document-panel__tabs">
          {PANEL_IDS.map((id) => (
            <Tooltip key={id} label={PANELS[id].title}>
              <Tabs.Tab
                aria-label={i18n._(PANELS[id].title)}
                className="m-panel-tab"
                data-panel-tab={id}
                // A TAB CHOSEN WHILE A TOOL IS OPEN CLOSES THE TOOL, including the one already chosen, which fires no
                // change: the tool had the body, and the tab is the way back to the panel.
                onClick={tool?.onClose}
                value={id}
              >
                <Icon name={PANELS[id].icon} size="dense" />
              </Tabs.Tab>
            </Tooltip>
          ))}
        </Tabs.List>
        {/* No Tooltip here: IconButton renders its own from `label`. A wrapper would hand its
            trigger props to a component that does not pass them on, so it could never open. */}
        <IconButton
          icon={ICONS.ChevronsLeft}
          label={PANEL_COLLAPSE}
          size="dense"
          onClick={() => {
            presence.hide('start');
          }}
        />
      </div>
      {tool === undefined ? (
        <Tabs.Panel className="m-document-panel__body" data-panel={chosen} value={chosen}>
          {chosen === 'pages' ? pages : panels[chosen]}
        </Tabs.Panel>
      ) : (
        <div className="m-document-panel__body m-document-panel__tool" data-panel-tool="open">
          <div className="m-document-panel__tool-head">
            <h2 className="m-document-panel__tool-title">{i18n._(tool.title)}</h2>
            <IconButton icon={ICONS.X} label={PANEL_TOOL_CLOSE} size="dense" onClick={tool.onClose} />
          </div>
          {tool.content}
        </div>
      )}
    </Tabs.Root>
  );

  if (form === 'row') return panel;
  // THE SLIM EDGE HANDLE §10.3 reopens a collapsed panel with, and a panel that has given way to a narrow row draws the
  // same one (ADR-0146). Absent while the panel is in the row: one control at a time says where the panel went. While
  // the panel is a sheet it closes it, so its name says which it does now.
  return (
    <div className="m-document-panel-handle" data-panel-handle="start">
      <IconButton
        icon={form === 'sheet' ? ICONS.ChevronsLeft : ICONS.ChevronsRight}
        label={form === 'sheet' ? PANEL_COLLAPSE : PANEL_REOPEN}
        size="dense"
        onClick={() => {
          presence.toggle('start');
        }}
      />
      {form === 'sheet' ? (
        <PanelSheet side="start" width={DOCUMENT_PANEL_MIN_WIDTH} onDismiss={dismiss}>
          {panel}
        </PanelSheet>
      ) : null}
    </div>
  );
}
