import { Tabs } from '@base-ui/react/tabs';
import { useLingui } from '@lingui/react';
import { useCallback, type ReactElement, type ReactNode } from 'react';

import {
  CONTEXT_PANEL_COLLAPSE,
  CONTEXT_PANEL_LABEL,
  CONTEXT_PANEL_REOPEN,
  CONTEXT_PANEL_TAB_ASSISTANT,
  CONTEXT_PANEL_TAB_PROPERTIES,
  CONTEXT_PANEL_TAB_SPELLING,
  CONTEXT_PANEL_TAB_STRIP,
} from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { ICONS } from '../primitives/icons.js';
import { type PanelPresence, usePanelForm } from '../panelPresence.js';
import { IconButton } from '../primitives/IconButton.js';
import { CONTEXT_PANEL_MIN_WIDTH, CONTEXT_PANEL_TAB_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { PanelSheet } from './PanelSheet.js';

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
 * `appearance.context-panel-open` owns it, written only through `panelPresence.ts` (ADR-0146). Collapsing one side
 * changes nothing about the other. Collapsed, the panel is a slim handle at the canvas's trailing edge that reopens it;
 * `DocumentBody` places that handle outside the splitter, since a shut panel is not a pane anyone can resize. A panel
 * that has given way to a narrow row draws the same handle, and opens from it as a sheet over the page's edge.
 */
export interface ContextPanelProps {
  readonly settings: SettingsStore;
  /** Whether the panel is in the row, a sheet or its handle, and the one writer of its open setting. */
  readonly presence: PanelPresence;
  /** The Properties tab: the style controls and the selection's styles, from `App`. */
  readonly children: ReactNode;
  /** The Assistant tab (ADR-0083), built where its conversation lives. */
  readonly assistant: ReactNode;
  /** The Spelling tab (ADR-0156), built where the focused document's store is. */
  readonly spelling: ReactNode;
}

/**
 * The panel's tabs, in strip order: each tab's name and the glyph beside it — *info* for Properties, *sparkles* for the
 * Assistant (v5's), and the spell check command's own glyph for Spelling, so the tab and the command that opens it are
 * one picture.
 */
const TABS = [
  { id: 'properties', title: CONTEXT_PANEL_TAB_PROPERTIES, icon: 'Info' },
  { id: 'assistant', title: CONTEXT_PANEL_TAB_ASSISTANT, icon: 'Sparkles' },
  { id: 'spelling', title: CONTEXT_PANEL_TAB_SPELLING, icon: 'SpellCheck' },
] as const;

export function ContextPanel({ settings, presence, children, assistant, spelling }: ContextPanelProps): ReactElement {
  const { i18n } = useLingui();
  const form = usePanelForm(presence, 'end');
  const tab = useSetting(settings, CONTEXT_PANEL_TAB_SETTING);
  const dismiss = useCallback(() => {
    presence.hide('end');
  }, [presence]);

  const panel = (
    <Tabs.Root
      aria-label={i18n._(CONTEXT_PANEL_LABEL)}
      className="m-context-panel"
      data-pane="context-panel"
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
              // EVERY TAB SHOWS ITS GLYPH and only the selected one also shows its name (the owner's agreement). The name
              // is the accessible name on every tab, so an icon-only tab is still announced, and the tooltip says it.
              aria-label={i18n._(entry.title)}
              className="m-context-panel__tab"
              data-context-tab={entry.id}
              key={entry.id}
              title={i18n._(entry.title)}
              value={entry.id}
            >
              <Icon name={entry.icon} size="dense" />
              {/* ITS OWN BOX, so a language longer than the header shortens the label and never pushes out the chevron. */}
              {entry.id === tab ? <span className="m-context-panel__tab-label">{i18n._(entry.title)}</span> : null}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <IconButton
          icon={ICONS.ChevronsRight}
          label={CONTEXT_PANEL_COLLAPSE}
          size="dense"
          onClick={() => {
            presence.hide('end');
          }}
        />
      </div>
      {/* ONE TAB IS MOUNTED, the document panel's rule and its reason: the other would keep
          asking for what nobody can see, and keep its controls in the tab order. */}
      <Tabs.Panel className="m-context-panel__body" data-context-panel={tab} value={tab}>
        {tab === 'properties' ? children : tab === 'assistant' ? assistant : spelling}
      </Tabs.Panel>
    </Tabs.Root>
  );

  if (form === 'row') return panel;
  // THE HANDLE, for a shut side and for one that has given way (ADR-0146): it shows the panel, and while the panel is a
  // sheet it is the way to close it again, so its name says which it does now.
  return (
    <div className="m-context-panel-handle" data-panel-handle="end">
      <IconButton
        icon={form === 'sheet' ? ICONS.ChevronsRight : ICONS.ChevronsLeft}
        label={form === 'sheet' ? CONTEXT_PANEL_COLLAPSE : CONTEXT_PANEL_REOPEN}
        size="dense"
        onClick={() => {
          presence.toggle('end');
        }}
      />
      {form === 'sheet' ? (
        <PanelSheet side="end" width={CONTEXT_PANEL_MIN_WIDTH} onDismiss={dismiss}>
          {panel}
        </PanelSheet>
      ) : null}
    </div>
  );
}
