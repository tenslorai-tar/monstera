import {
  CONTEXT_PANEL_TOGGLE_TITLE,
  DOCUMENT_PANEL_TOGGLE_TITLE,
  QUICK_TOOLBAR_TOGGLE_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_OPEN_SETTING,
  QUICK_TOOLBAR_OPEN_SETTING,
} from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { hasDocument } from './documentCommands.js';

/**
 * The chrome's visibility, as commands (ARCHITECTURE §7: *"Chrome visibility is itself commanded:
 * `view.toggle-quick-toolbar`, `view.toggle-panel` and the layout-mode switch are registry commands,
 * which is what guarantees a hidden surface can always be restored from the palette or a
 * shortcut"*).
 *
 * ## A command writing a setting, for `toggleRulersCommand`'s reason
 *
 * Each open setting is the writer of record for whether its surface shows, and each surface's own
 * control — the panels' chevrons and handles — is another caller of the same `set`. The command is
 * how a person reaches that value from the palette and a chord, which is the one guarantee a hidden
 * surface's own control cannot give: once the surface is gone, so is anything drawn on it.
 *
 * ## TWO panel commands, where §7 names one id
 *
 * §7's `view.toggle-panel` was written when there was one side panel. §10.3 now has two, each
 * *"collapsible … State is persisted per panel"*, and one command toggling both would make the
 * guarantee false for whichever side a person collapsed alone. So `view.toggle-panel` keeps the id
 * §7 gave the document panel, and `view.toggle-context-panel` is the right panel's.
 *
 * ## `when: hasDocument`
 *
 * All three surfaces exist only beside a document, so with none open there is nothing to show or
 * hide, and the setting is still reachable from the Settings dialog.
 *
 * ## The layout-mode switch is not here
 *
 * It switches between §10.3's Ribbon, Studio and Focus modes, which the title bar's pass builds. A
 * command that switched to a mode nothing renders would be a control that does nothing.
 */
export function toggleQuickToolbarCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-quick-toolbar',
    icon: 'PanelLeftDashed',
    title: QUICK_TOOLBAR_TOGGLE_TITLE,
    shortcut: 'Ctrl+Shift+Q',
    // §10.3: "in the palette, on a shortcut, and as a status-bar toggle". The palette lists every
    // command, the chord is above, and this is the toggle (ADR-0067's chrome cluster).
    placements: [{ surface: 'status-bar', cluster: 'chrome', order: 10 }],
    when: hasDocument,
    run: (): void => {
      // READ THROUGH THE STORE at run time, never a value captured at registration.
      deps.settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, deps.settings.get(QUICK_TOOLBAR_OPEN_SETTING.id) !== true);
    },
  };
}

/** The document panel's visibility. See the module header for the id. */
export function togglePanelCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-panel',
    icon: 'PanelLeft',
    title: DOCUMENT_PANEL_TOGGLE_TITLE,
    shortcut: 'Ctrl+Shift+B',
    // Palette and chord only: the panel's own chevron and edge handle are its on-screen controls.
    placements: [],
    when: hasDocument,
    run: (): void => {
      deps.settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, deps.settings.get(DOCUMENT_PANEL_OPEN_SETTING.id) !== true);
    },
  };
}

/** The right contextual panel's visibility, its own command for the module header's reason. */
export function toggleContextPanelCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-context-panel',
    icon: 'PanelRight',
    title: CONTEXT_PANEL_TOGGLE_TITLE,
    shortcut: 'Ctrl+Shift+J',
    placements: [],
    when: hasDocument,
    run: (): void => {
      deps.settings.set(CONTEXT_PANEL_OPEN_SETTING.id, deps.settings.get(CONTEXT_PANEL_OPEN_SETTING.id) !== true);
    },
  };
}
