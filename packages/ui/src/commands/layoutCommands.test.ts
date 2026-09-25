import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { CONTEXT_PANEL_OPEN_SETTING, DOCUMENT_PANEL_OPEN_SETTING, LAYOUT_MODE_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { paletteModel, shortcutMapOf } from '../surfaces/projections.js';
import { layoutModeCommands } from './chromeCommands.js';

/**
 * §7's layout-mode switch and §10.3's *"Esc returns"*, as commands writing one setting.
 */

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

function harness(): {
  readonly settings: SettingsStore;
  readonly registry: CommandRegistry;
  readonly run: (id: string) => void;
} {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  // THE SAME FACTORY App registers, so the session memory under test is the one the commands close over.
  const registry = new CommandRegistry(layoutModeCommands({ settings }));
  return {
    settings,
    registry,
    run: (id) => {
      const command = registry.get(id);
      if (command === undefined) throw new Error(`no command ${id}`);
      void command.run(context);
    },
  };
}

describe('the layout-mode commands', () => {
  it('each writes its own mode', () => {
    const { settings, run } = harness();
    for (const mode of ['studio', 'focus', 'ribbon'] as const) {
      run(`view.layout-${mode}`);
      expect(settings.get(LAYOUT_MODE_SETTING.id)).toBe(mode);
    }
  });

  it('Leave Focus EXISTS only in Focus, so outside it Escape is unclaimed', () => {
    const { registry, run } = harness();
    const leave = (): boolean => paletteModel(registry, context).some((command) => command.id === 'view.leave-focus');
    expect(leave()).toBe(false);
    run('view.layout-focus');
    expect(leave()).toBe(true);
    run('view.layout-studio');
    expect(leave()).toBe(false);
  });

  it('Escape RETURNS to the mode a person left, not to the default', () => {
    // The separating fixture: Studio, not Ribbon. A leave that always wrote the fallback passes a Ribbon-first case.
    const { settings, run } = harness();
    run('view.layout-studio');
    run('view.layout-focus');
    run('view.leave-focus');
    expect(settings.get(LAYOUT_MODE_SETTING.id)).toBe('studio');
  });

  it('and falls back to Ribbon when Focus was where the session began', () => {
    const { settings, run } = harness();
    settings.set(LAYOUT_MODE_SETTING.id, 'focus');
    run('view.leave-focus');
    expect(settings.get(LAYOUT_MODE_SETTING.id)).toBe('ribbon');
  });

  it('entering Focus again from Focus does not overwrite the mode to return to', () => {
    const { settings, run } = harness();
    run('view.layout-studio');
    run('view.layout-focus');
    run('view.layout-focus');
    run('view.leave-focus');
    expect(settings.get(LAYOUT_MODE_SETTING.id)).toBe('studio');
  });

  it('FOCUS WRITES NO PANEL SETTING: each panel keeps its own state to restore', () => {
    const { settings, run } = harness();
    settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, false);
    run('view.layout-focus');
    run('view.leave-focus');
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(false);
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
  });

  it('the chords are Escape and Ctrl+Shift+F, and they do not collide', () => {
    const chords = [...shortcutMapOf(harness().registry)].map(([chord, command]) => `${chord}=${command.id}`).sort();
    expect(chords).toStrictEqual(['ctrl+shift+f=view.layout-focus', 'escape=view.leave-focus']);
  });
});
