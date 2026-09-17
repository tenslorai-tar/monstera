import { Tabs } from '@base-ui/react/tabs';
import { useLingui } from '@lingui/react';
import type { ReactElement, ReactNode } from 'react';

import {
  CONTEXT_PANEL_COLLAPSE,
  CONTEXT_PANEL_LABEL,
  CONTEXT_PANEL_REOPEN,
  CONTEXT_PANEL_TAB_ASSISTANT,
  CONTEXT_PANEL_TAB_PROPERTIES,
  CONTEXT_PANEL_TAB_STRIP,
} from '../messages/en.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import { CONTEXT_PANEL_OPEN_SETTING, CONTEXT_PANEL_TAB_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';

/**
 * §10.3's right contextual panel: *"Canvas (the star, quiet chrome) → right contextual panel →
 * status bar"*, and *"Both side panels are collapsible: a chevron in the panel header collapses it;
 * a slim edge handle on the canvas reopens it. State is persisted per panel."*
 *
 * ## WHAT IT HOLDS is PROPERTIES, and the record is why
 *
 * The founding record names it *"right contextual panel (annotations list / properties)"*
 * (`BUILD-PROMPT.md`:1070). The architecture drops the parenthetical and places *Comments* — the
 * annotations list — in the left document panel's six tabs, where design pass C put it. A second
 * list here would be two surfaces for one list (B3), so this panel holds what is left of the
 * record's phrase: the style controls and the selection's styles. `App` hands them in as children,
 * because their state lives there.
 *
 * ## Open is its own setting, never the document panel's
 *
 * `appearance.context-panel-open` owns it. Collapsing one side changes nothing about the other.
 * Collapsed, the panel is a slim handle at the canvas's trailing edge that reopens it; `DocumentBody`
 * places that handle outside the splitter, since a shut panel is not a pane anyone can resize.
 */
export interface ContextPanelProps {
  readonly settings: SettingsStore;
  /** The Properties tab: the style controls and the selection's styles, from `App`. */
  readonly children: ReactNode;
  /** The Assistant tab (ADR-0083), built where its conversation lives. */
  readonly assistant: ReactNode;
}

/** The panel's tabs, in strip order. */
const TABS = [
  { id: 'properties', title: CONTEXT_PANEL_TAB_PROPERTIES },
  { id: 'assistant', title: CONTEXT_PANEL_TAB_ASSISTANT },
] as const;

export function ContextPanel({ settings, children, assistant }: ContextPanelProps): ReactElement {
  const { i18n } = useLingui();
  const open = useSetting(settings, CONTEXT_PANEL_OPEN_SETTING);
  const tab = useSetting(settings, CONTEXT_PANEL_TAB_SETTING);

  if (!open) {
    return (
      <div className="m-context-panel-handle">
        <IconButton
          icon={ICONS.ChevronsLeft}
          label={CONTEXT_PANEL_REOPEN}
          size="dense"
          onClick={() => {
            settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
          }}
        />
      </div>
    );
  }

  return (
    <Tabs.Root
      aria-label={i18n._(CONTEXT_PANEL_LABEL)}
      className="m-context-panel"
      render={<aside />}
      value={tab}
      onValueChange={(value) => {
        // THE SETTING IS THE ONE OWNER of which tab shows, the document panel's rule: a
        // command that opens the assistant and a person clicking the tab move one value.
        settings.set(CONTEXT_PANEL_TAB_SETTING.id, value);
      }}
    >
      <div className="m-context-panel__header">
        <Tabs.List aria-label={i18n._(CONTEXT_PANEL_TAB_STRIP)} className="m-context-panel__tabs">
          {TABS.map((entry) => (
            <Tabs.Tab
              className="m-context-panel__tab"
              data-context-tab={entry.id}
              key={entry.id}
              value={entry.id}
            >
              {i18n._(entry.title)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <IconButton
          icon={ICONS.ChevronsRight}
          label={CONTEXT_PANEL_COLLAPSE}
          size="dense"
          onClick={() => {
            settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
          }}
        />
      </div>
      {/* ONE TAB IS MOUNTED, the document panel's rule and its reason: the other would keep
          asking for what nobody can see, and keep its controls in the tab order. */}
      <Tabs.Panel className="m-context-panel__body" data-context-panel={tab} value={tab}>
        {tab === 'properties' ? children : assistant}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
