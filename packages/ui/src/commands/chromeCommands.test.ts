import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  CONTEXT_PANEL_TAB_SETTING,
  DOCUMENT_PANEL_OPEN_SETTING,
  FLOAT_BAR_POSITION_SETTING,
  QUICK_TOOLBAR_OPEN_SETTING,
} from '../settings/layout.js';
import { PanelPresence } from '../panelPresence.js';
import { SettingsStore } from '../settingsStore.js';
import { paletteModel, shortcutMapOf, statusBarModel } from '../surfaces/projections.js';
import {
  resetFloatBarCommand,
  showPropertiesCommand,
  themeCommands,
  toggleContextPanelCommand,
  togglePanelCommand,
  toggleQuickToolbarCommand,
} from './chromeCommands.js';

/**
 * §7: *"Chrome visibility is itself commanded … which is what guarantees a hidden surface can always
 * be restored from the palette or a shortcut."* Each case hides a surface and restores it through the
 * command, and asserts the OTHER surfaces' settings did not move — a toggle writing the wrong setting
 * flips something, and only the untouched ones separate it.
 */

const withDocument: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};
const noDocument: CommandContext = {
  selectedPages: [],
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

function store(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

/** A store and the window's presence over it — what every chrome command is built with. */
function chrome(): { readonly settings: SettingsStore; readonly presence: PanelPresence } {
  const settings = store();
  return { settings, presence: new PanelPresence(settings) };
}

const cases = [
  { make: toggleQuickToolbarCommand, owns: QUICK_TOOLBAR_OPEN_SETTING.id },
  { make: togglePanelCommand, owns: DOCUMENT_PANEL_OPEN_SETTING.id },
  { make: toggleContextPanelCommand, owns: CONTEXT_PANEL_OPEN_SETTING.id },
] as const;
const OPEN_IDS = cases.map((each) => each.owns);

describe('the chrome visibility commands', () => {
  for (const { make, owns } of cases) {
    it(`${make(chrome()).id} hides and RESTORES exactly ${owns}, and nothing else`, () => {
      const built = chrome();
      const { settings } = built;
      const command = make(built);
      for (const id of OPEN_IDS) expect(settings.get(id)).toBe(true);

      void command.run(withDocument);
      expect(settings.get(owns)).toBe(false);
      for (const id of OPEN_IDS.filter((other) => other !== owns)) expect(settings.get(id)).toBe(true);

      void command.run(withDocument);
      expect(settings.get(owns)).toBe(true);
    });
  }

  it('each is reachable from the PALETTE and a CHORD with a document open, and the chords do not collide', () => {
    const built = chrome();
    const registry = new CommandRegistry(cases.map(({ make }) => make(built)));
    const ids = ['view.toggle-context-panel', 'view.toggle-panel', 'view.toggle-quick-toolbar'];
    expect(paletteModel(registry, withDocument).map((command) => command.id)).toStrictEqual(ids);
    // `shortcutMapOf` throws on a collision, so building it is the no-collision assertion.
    const chords = [...shortcutMapOf(registry)].map(([chord, command]) => `${chord}=${command.id}`).sort();
    expect(chords).toStrictEqual([
      'ctrl+shift+b=view.toggle-panel',
      'ctrl+shift+j=view.toggle-context-panel',
      'ctrl+shift+q=view.toggle-quick-toolbar',
    ]);
    // With nothing open there is no chrome to hide.
    expect(paletteModel(registry, noDocument)).toStrictEqual([]);
  });

  for (const { make, side, owns } of [
    { make: togglePanelCommand, side: 'start', owns: DOCUMENT_PANEL_OPEN_SETTING.id },
    { make: toggleContextPanelCommand, side: 'end', owns: CONTEXT_PANEL_OPEN_SETTING.id },
  ] as const) {
    it(`${make(chrome()).id} in a NARROW ROW ticks what is on screen and opens a sheet, never a dead write (ADR-0146)`, () => {
      const built = chrome();
      const command = make(built);
      built.presence.measure(600);
      // THE SETTING IS ON AND THE PANEL IS NOT ON SCREEN, so the tick says off. Ticked from the setting it said on, and a
      // press then shut a panel nobody could see — the dead control this replaces.
      expect(built.settings.get(owns)).toBe(true);
      expect(command.checked?.(withDocument)).toBe(false);

      void command.run(withDocument);
      expect(built.presence.form(side)).toBe('sheet');
      expect(command.checked?.(withDocument)).toBe(true);

      // CLOSING THE SHEET leaves the person's choice as it was, so a wider window draws the panel again.
      void command.run(withDocument);
      expect(built.presence.form(side)).toBe('handle');
      expect(built.settings.get(owns)).toBe(true);
      built.presence.measure(1600);
      expect(built.presence.form(side)).toBe('row');
    });
  }

  it('the quick-toolbar toggle is §10.3\'s STATUS-BAR toggle, in the chrome group', () => {
    const built = chrome();
    const registry = new CommandRegistry(cases.map(({ make }) => make(built)));
    expect(statusBarModel(registry, withDocument).chrome.map((entry) => entry.command.id)).toStrictEqual([
      'view.toggle-quick-toolbar',
    ]);
  });
});

describe('View › Theme (ADR-0107)', () => {
  it('one command per value of the theme setting, each writing its value and CHECKED exactly while it is current', () => {
    const settings = store();
    const commands = themeCommands({ settings });
    expect(commands.map((command) => command.id)).toStrictEqual(['view.theme-system', 'view.theme-light', 'view.theme-dark']);
    // THE FALLBACK IS SYSTEM, so a case that only ran Dark could pass on a command that wrote nothing.
    expect(commands.map((command) => command.checked?.(withDocument))).toStrictEqual([true, false, false]);

    const dark = commands[2];
    void dark?.run(withDocument);
    expect(settings.get(THEME_SETTING.id)).toBe('dark');
    expect(commands.map((command) => command.checked?.(withDocument))).toStrictEqual([false, false, true]);

    void commands[1]?.run(withDocument);
    expect(settings.get(THEME_SETTING.id)).toBe('light');
    expect(commands.map((command) => command.checked?.(withDocument))).toStrictEqual([false, true, false]);
  });
});

describe('Window › Properties panel (ADR-0107)', () => {
  it('opens the right panel ON its Properties tab, and is checked only while both hold', () => {
    const built = chrome();
    const { settings } = built;
    settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
    settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
    const command = showPropertiesCommand(built);
    expect(command.checked?.(withDocument)).toBe(false);

    void command.run(withDocument);
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
    expect(settings.get(CONTEXT_PANEL_TAB_SETTING.id)).toBe('properties');
    expect(command.checked?.(withDocument)).toBe(true);

    // CONTROL: open on the OTHER tab is not checked — the mark is the panel's tab, not merely its being open.
    settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
    expect(command.checked?.(withDocument)).toBe(false);
    // AND THE OTHER HALF: closed on the Properties tab is not checked either — the mark is not the tab alone.
    settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'properties');
    settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
    expect(command.checked?.(withDocument)).toBe(false);
    expect(command.when?.(noDocument)).toBe(false);
  });
});

describe('Window › Reset Float bar position (the owner’s list, item 4)', () => {
  it('puts a moved bar back where it starts, and touches nothing else — not even whether it is shown', () => {
    const settings = store();
    settings.set(FLOAT_BAR_POSITION_SETTING.id, { x: 0.7, y: 0.2 });
    settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, false);
    const command = resetFloatBarCommand({ settings });

    void command.run(withDocument);
    expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toBe('start');
    // CONTROL: hidden stays hidden. A reset that also showed the bar would be a second writer of that setting.
    expect(settings.get(QUICK_TOOLBAR_OPEN_SETTING.id)).toBe(false);
  });

  it('is in the Window menu and the palette with a document open, and in neither without one', () => {
    const registry = new CommandRegistry([resetFloatBarCommand({ settings: store() })]);
    expect(paletteModel(registry, withDocument).map((command) => command.id)).toContain('view.reset-float-bar');
    expect(paletteModel(registry, noDocument).map((command) => command.id)).not.toContain('view.reset-float-bar');
    expect(resetFloatBarCommand({ settings: store() }).placements).toStrictEqual([
      { surface: 'menu-bar', menu: 'window', group: 1, order: 31 },
    ]);
  });
});
