import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { RIBBON_SECTION_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { featureShortcutCommands } from './featureShortcuts.js';
import type { OpenOutcome } from './openDocument.js';

const noDocument = {
  selectedPages: [],
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
} as CommandContext;

const withDocument = {
  ...noDocument,
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
} as CommandContext;

function harness(outcome: OpenOutcome): {
  readonly settings: SettingsStore;
  readonly commands: ReturnType<typeof featureShortcutCommands>;
  readonly opens: () => number;
} {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  // STARTED ON A SECTION NONE OF THE SIX ROUTES TO, so a route that did not happen and a route to the default cannot
  // look the same — Export's section is Home, which is also the setting's fallback.
  settings.set(RIBBON_SECTION_SETTING.id, 'review');
  let opens = 0;
  const commands = featureShortcutCommands({
    open: () => {
      opens += 1;
      return Promise.resolve(outcome);
    },
    settings,
  });
  return { settings, commands, opens: () => opens };
}

describe('the start screen feature shortcuts', () => {
  it('are §10.3’s six, in its order, each in the shortcut slot', () => {
    const { commands } = harness('shown');
    expect(commands.map((command) => command.id)).toStrictEqual([
      'start.annotate',
      'start.forms',
      'start.ocr',
      'start.split-merge',
      'start.encrypt-sign',
      'start.export',
    ]);
    for (const command of commands) {
      expect(command.placements).toHaveLength(1);
      const [placement] = command.placements;
      expect(placement?.surface === 'start-screen' && placement.slot === 'shortcut').toBe(true);
    }
  });

  it('each OPENS, then takes the reader to the section BUILD-PROMPT maps its feature to', async () => {
    const sections = ['comment', 'forms', 'tools', 'organize', 'protect', 'home'];
    for (const [index, section] of sections.entries()) {
      const { settings, commands, opens } = harness('shown');
      await commands[index]?.run(noDocument);
      expect(opens()).toBe(1);
      expect(settings.get(RIBBON_SECTION_SETTING.id)).toBe(section);
    }
  });

  it('a picker dismissed, or a file that could not open, routes NOWHERE', async () => {
    // THE CONTROL for the case above: the same command, the same open, an outcome with no document on screen.
    for (const command of harness('none').commands) {
      const { settings, commands, opens } = harness('none');
      await commands.find((each) => each.id === command.id)?.run(noDocument);
      expect(opens()).toBe(1);
      expect(settings.get(RIBBON_SECTION_SETTING.id)).toBe('review');
    }
  });

  it('exist only while no document is open — they are the start screen’s way in', () => {
    for (const command of harness('shown').commands) {
      expect(command.when?.(noDocument)).toBe(true);
      expect(command.when?.(withDocument)).toBe(false);
    }
  });
});
