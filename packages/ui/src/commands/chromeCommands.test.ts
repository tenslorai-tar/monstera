import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_OPEN_SETTING,
  QUICK_TOOLBAR_OPEN_SETTING,
} from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { paletteModel, shortcutMapOf, statusBarModel } from '../surfaces/projections.js';
import { toggleContextPanelCommand, togglePanelCommand, toggleQuickToolbarCommand } from './chromeCommands.js';

/**
 * §7: *"Chrome visibility is itself commanded … which is what guarantees a hidden surface can always
 * be restored from the palette or a shortcut."* Each case hides a surface and restores it through the
 * command, and asserts the OTHER surfaces' settings did not move — a toggle writing the wrong setting
 * flips something, and only the untouched ones separate it.
 */

const withDocument: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};
const noDocument: CommandContext = {
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

const cases = [
  { make: toggleQuickToolbarCommand, owns: QUICK_TOOLBAR_OPEN_SETTING.id },
  { make: togglePanelCommand, owns: DOCUMENT_PANEL_OPEN_SETTING.id },
  { make: toggleContextPanelCommand, owns: CONTEXT_PANEL_OPEN_SETTING.id },
] as const;
const OPEN_IDS = cases.map((each) => each.owns);

describe('the chrome visibility commands', () => {
  for (const { make, owns } of cases) {
    it(`${make({ settings: store() }).id} hides and RESTORES exactly ${owns}, and nothing else`, () => {
      const settings = store();
      const command = make({ settings });
      for (const id of OPEN_IDS) expect(settings.get(id)).toBe(true);

      void command.run(withDocument);
      expect(settings.get(owns)).toBe(false);
      for (const id of OPEN_IDS.filter((other) => other !== owns)) expect(settings.get(id)).toBe(true);

      void command.run(withDocument);
      expect(settings.get(owns)).toBe(true);
    });
  }

  it('each is reachable from the PALETTE and a CHORD with a document open, and the chords do not collide', () => {
    const settings = store();
    const registry = new CommandRegistry(cases.map(({ make }) => make({ settings })));
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

  it('the quick-toolbar toggle is §10.3\'s STATUS-BAR toggle, in the chrome group', () => {
    const settings = store();
    const registry = new CommandRegistry(cases.map(({ make }) => make({ settings })));
    expect(statusBarModel(registry, withDocument).chrome.map((entry) => entry.command.id)).toStrictEqual([
      'view.toggle-quick-toolbar',
    ]);
  });
});
