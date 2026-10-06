import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { KEYBOARD_SHORTCUTS_DIALOG_ID } from '../dialogs/keyboardShortcuts.js';
import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SHORTCUTS_SETTING } from '../settings/keyboard.js';
import { SettingsStore } from '../settingsStore.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';
import { keyboardShortcutsCommand } from './keyboardShortcuts.js';

const context = {} as CommandContext;

const ROW: ShortcutRow = {
  id: 'view.toggle-grid',
  title: messageKey('command.grid.title'),
  chord: 'Ctrl+G',
  fallback: 'Ctrl+G',
  also: [],
};

/** The command over a real settings store, with the dialog's reports delivered as the case says. */
function harness(reports: readonly unknown[], rows: () => readonly ShortcutRow[] = () => [ROW]) {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const opened: unknown[] = [];
  const command = keyboardShortcutsCommand({
    ask: (id, props, onUpdate) => {
      opened.push({ id, props });
      // NO REPLY IS EXPECTED of this command: a reply would throw here, which the cases would show.
      for (const report of reports) {
        onUpdate?.(report, () => {
          throw new Error('the shortcuts command replied to a report');
        });
      }
      return Promise.resolve(undefined);
    },
    rows,
    dropped: () => ['view.toggle-rulers'],
    settings,
  });
  return { command, settings, opened, stored: () => settings.get(SHORTCUTS_SETTING.id) };
}

describe('the keyboard shortcuts command', () => {
  it('is bound to Ctrl+/, since ADR-0112 gave F1 to the Help centre', () => {
    expect(harness([]).command.shortcut).toBe('Ctrl+/');
  });

  it('opens the dialog with the rows read when it RUNS, and the dropped choices', () => {
    let rows: readonly ShortcutRow[] = [ROW];
    const { command, opened } = harness([], () => rows);
    // CHANGED AFTER THE COMMAND WAS MADE, the shell's situation: the registry these come from is built after it.
    rows = [...rows, { ...ROW, id: 'app.keyboard-shortcuts', chord: 'F1', fallback: 'F1' }];
    void command.run(context);
    expect(opened).toStrictEqual([{ id: KEYBOARD_SHORTCUTS_DIALOG_ID, props: { rows, dropped: ['view.toggle-rulers'] } }]);
  });

  it('stores a chosen key NORMALISED, and only as a difference from the default', () => {
    const chosen = harness([{ kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' }]);
    void chosen.command.run(context);
    expect(chosen.stored()).toStrictEqual({ 'view.toggle-grid': 'ctrl+shift+m' });

    // BACK TO THE DEFAULT removes the entry, so a default a later build changes still reaches this person.
    const restored = harness([
      { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' },
      { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+G' },
    ]);
    void restored.command.run(context);
    expect(restored.stored()).toStrictEqual({});
  });

  it('stores NO KEY as null, and Reset all empties the choices', () => {
    const removed = harness([{ kind: 'choose', id: 'view.toggle-grid', chord: null }]);
    void removed.command.run(context);
    expect(removed.stored()).toStrictEqual({ 'view.toggle-grid': null });

    const reset = harness([{ kind: 'choose', id: 'view.toggle-grid', chord: null }, { kind: 'reset' }]);
    void reset.command.run(context);
    expect(reset.stored()).toStrictEqual({});
  });

  it('CONTROL: a report the result schema refuses changes nothing', () => {
    const refused = harness([{ kind: 'choose', id: 'view.toggle-grid' }]);
    void refused.command.run(context);
    expect(refused.stored()).toStrictEqual({});
  });
});
