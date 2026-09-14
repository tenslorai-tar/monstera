import { useLingui } from '@lingui/react';
import { Tabs } from '@base-ui/react/tabs';
import type { ReactElement, ReactNode } from 'react';

import { PANEL_COLLAPSE, PANEL_REOPEN, PANEL_STRIP_LABEL } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { DOCUMENT_PANEL_OPEN_SETTING, DOCUMENT_PANEL_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
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
 * the same setting, so there is no second place that decides.
 *
 * ## One panel is mounted, not six hidden
 *
 * Only the chosen panel's content renders. A hidden panel still mounted would keep asking
 * main for outlines and annotation lists nobody can see, and would keep its controls in
 * the tab order behind a panel a reader cannot see.
 */
export interface DocumentPanelProps {
  readonly settings: SettingsStore;
  /** The Pages panel: the thumbnail strip, built where the document view is. */
  readonly pages: ReactNode;
  /** The other five panels, built by `App` where their state lives. */
  readonly panels: Readonly<Record<Exclude<PanelId, 'pages'>, ReactNode>>;
}

export function DocumentPanel({ settings, pages, panels }: DocumentPanelProps): ReactElement {
  const { i18n } = useLingui();
  const chosen = useSetting(settings, DOCUMENT_PANEL_SETTING);
  const open = useSetting(settings, DOCUMENT_PANEL_OPEN_SETTING);

  if (!open) {
    // THE SLIM EDGE HANDLE §10.3 reopens a collapsed panel with. Absent rather than
    // disabled when the panel is open: one control at a time says where the panel went.
    return (
      <div className="m-document-panel-handle">
        <Tooltip label={PANEL_REOPEN}>
          <IconButton
            icon={ICONS.ChevronsRight}
            label={PANEL_REOPEN}
            size="dense"
            onClick={() => {
              settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, true);
            }}
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <Tabs.Root
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
                value={id}
              >
                <Icon name={PANELS[id].icon} size="dense" />
              </Tabs.Tab>
            </Tooltip>
          ))}
        </Tabs.List>
        <Tooltip label={PANEL_COLLAPSE}>
          <IconButton
            icon={ICONS.ChevronsLeft}
            label={PANEL_COLLAPSE}
            size="dense"
            onClick={() => {
              settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, false);
            }}
          />
        </Tooltip>
      </div>
      <Tabs.Panel className="m-document-panel__body" data-panel={chosen} value={chosen}>
        {chosen === 'pages' ? pages : panels[chosen]}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
