import {
  CONTEXT_PANEL_TOGGLE_TITLE,
  DOCUMENT_PANEL_TOGGLE_TITLE,
  LAYOUT_FOCUS_COMMAND_TITLE,
  LAYOUT_RIBBON_COMMAND_TITLE,
  LAYOUT_STUDIO_COMMAND_TITLE,
  LEAVE_FOCUS_COMMAND_TITLE,
  QUICK_TOOLBAR_TOGGLE_SHORT,
  QUICK_TOOLBAR_TOGGLE_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_OPEN_SETTING,
  LAYOUT_MODE_SETTING,
  type LayoutMode,
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
 * ## The layout-mode switch has no `hasDocument`
 *
 * `layoutModeCommands` below: Ribbon, Studio and Focus change the whole surface's chrome, which
 * exists with or without a document, so the mode can be chosen before one is opened.
 */
export function toggleQuickToolbarCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-quick-toolbar',
    icon: 'PanelLeftDashed',
    title: QUICK_TOOLBAR_TOGGLE_TITLE,
    ribbonTitle: QUICK_TOOLBAR_TOGGLE_SHORT,
    shortcut: 'Ctrl+Shift+Q',
    // §10.3: "in the palette, on a shortcut, and as a status-bar toggle". The palette lists every
    // command, the chord is above, and this is the toggle (ADR-0067's chrome cluster). AND ON THE RAIL
    // (the owner, 2026-09-26): a button at the rail's foot above Settings (ADR-0098's foot), so the toolbar
    // that floats over the page is shown and hidden from beside it. Shown by default and remembered
    // (`QUICK_TOOLBAR_OPEN_SETTING`).
    placements: [
      { surface: 'status-bar', cluster: 'chrome', order: 10 },
      { surface: 'rail', order: 5 },
    ],
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

const LAYOUT_TITLES = {
  ribbon: LAYOUT_RIBBON_COMMAND_TITLE,
  studio: LAYOUT_STUDIO_COMMAND_TITLE,
  focus: LAYOUT_FOCUS_COMMAND_TITLE,
} as const;

/**
 * §7's layout-mode switch and §10.3's *"Esc returns"*, as the four commands that share one memory.
 *
 * ## One command per mode
 *
 * A command takes no argument, so a switch between three values is three commands the palette and a chord can each
 * reach. The segmented control in the title bar is the switch's other surface, writing the same setting.
 *
 * ## The mode before Focus is THIS FACTORY'S, for the session, never persisted
 *
 * *"Esc returns"* returns to the mode a person left, which is a fact about this session; a second setting holding it
 * would be a second writer of the layout's state, and one that could disagree with the first after a restart that
 * began in Focus. So it lives in a variable the four commands close over and nothing else can reach. It was a React ref
 * in `App` first, passed in through render-time deps, and `react-hooks`' *"Cannot access refs during render"* refused
 * that: the registry is built during render, and a ref read through it is a ref the rule cannot prove is read only
 * later. A variable owned by the commands has no render to be read in.
 *
 * ## Leave Focus exists only in Focus
 *
 * `when` decides existence, so outside Focus the Escape chord is unclaimed and reaches whatever else wants it. A dialog
 * closed with Escape never reaches it: Base UI's dismissal calls `stopPropagation` on the key (read in `useDismiss.mjs`),
 * and the command palette does the same since 2026-09-15.
 */
export function layoutModeCommands(deps: { readonly settings: SettingsStore }): readonly UiCommand[] {
  let beforeFocus: LayoutMode | undefined;

  const modeCommand = (mode: LayoutMode): UiCommand => ({
    id: `view.layout-${mode}`,
    title: LAYOUT_TITLES[mode],
    // No chord for Ribbon and Studio: §10.3 names none, and Escape is Focus's way out. Focus has one because a mode
    // that hides the ribbon is the one a person enters from the keyboard while reading.
    ...(mode === 'focus' ? { shortcut: 'Ctrl+Shift+F' } : {}),
    placements: [],
    run: (): void => {
      const current = deps.settings.get(LAYOUT_MODE_SETTING.id) as LayoutMode;
      if (mode === 'focus' && current !== 'focus') beforeFocus = current;
      deps.settings.set(LAYOUT_MODE_SETTING.id, mode);
    },
  });

  const leaveFocus: UiCommand = {
    id: 'view.leave-focus',
    title: LEAVE_FOCUS_COMMAND_TITLE,
    shortcut: 'Escape',
    placements: [],
    when: () => deps.settings.get(LAYOUT_MODE_SETTING.id) === 'focus',
    run: (): void => {
      deps.settings.set(LAYOUT_MODE_SETTING.id, beforeFocus ?? 'ribbon');
    },
  };

  return [modeCommand('ribbon'), modeCommand('studio'), modeCommand('focus'), leaveFocus];
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
