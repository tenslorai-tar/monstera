import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { KEYBOARD_SHORTCUTS_DIALOG_ID } from '../dialogs/keyboardShortcuts.js';
import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SHORTCUTS_SETTING } from '../settings/keyboard.js';
import { SettingsStore } from '../settingsStore.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';
import { applyShortcutAnswer, keyboardShortcutsCommand } from './keyboardShortcuts.js';

const context = {} as CommandContext;

const ROW: ShortcutRow = {
  id: 'view.toggle-grid',
  title: messageKey('command.grid.title'),
  chord: 'Ctrl+G',
  fallback: 'Ctrl+G',
  also: [],
};

/** The command, recording what it opens and whether it handed the dialog any way to report. */
function harness(rows: () => readonly ShortcutRow[] = () => [ROW]) {
  const opened: { id: string; props: unknown; arguments: number }[] = [];
  const command = keyboardShortcutsCommand({
    // `arguments` IS WHAT THE COMMAND PASSED: a third one would be a reporter, and ADR-0191 gives this list none.
    ask: (...given: [string, unknown]) => {
      opened.push({ id: given[0], props: given[1], arguments: given.length });
      return Promise.resolve(undefined);
    },
    rows,
    dropped: () => ['view.toggle-rulers'],
  });
  return { command, opened };
}

describe('the keyboard shortcuts command', () => {
  it('is bound to Ctrl+/, since ADR-0112 gave F1 to the Help centre', () => {
    expect(harness().command.shortcut).toBe('Ctrl+/');
  });

  it('opens the dialog with the rows read when it RUNS, and the dropped choices', () => {
    let rows: readonly ShortcutRow[] = [ROW];
    const { command, opened } = harness(() => rows);
    // CHANGED AFTER THE COMMAND WAS MADE, the shell's situation: the registry these come from is built after it.
    rows = [...rows, { ...ROW, id: 'app.keyboard-shortcuts', chord: 'F1', fallback: 'F1' }];
    void command.run(context);
    expect(opened).toStrictEqual([
      { id: KEYBOARD_SHORTCUTS_DIALOG_ID, props: { rows, dropped: ['view.toggle-rulers'] }, arguments: 2 },
    ]);
  });

  it('is a list to READ: it passes no reporter, so nothing it opens can write a key (ADR-0191)', () => {
    const { command, opened } = harness();
    void command.run(context);
    expect(opened[0]?.arguments).toBe(2);
  });
});

describe('applyShortcutAnswer', () => {
  const fallbacks = new Map([[ROW.id, ROW.fallback]]);
  const stored = (settings: SettingsStore): unknown => settings.get(SHORTCUTS_SETTING.id);
  const fresh = (): SettingsStore => new SettingsStore(new SettingsRegistry(ALL_SETTINGS));

  it('stores a chosen key NORMALISED, and only as a difference from the default', () => {
    const settings = fresh();
    applyShortcutAnswer(settings, fallbacks, { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' });
    expect(stored(settings)).toStrictEqual({ 'view.toggle-grid': 'ctrl+shift+m' });

    // BACK TO THE DEFAULT removes the entry, so a default a later build changes still reaches this person.
    applyShortcutAnswer(settings, fallbacks, { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+G' });
    expect(stored(settings)).toStrictEqual({});
  });

  it('stores NO KEY as null, and Reset all empties the choices', () => {
    const settings = fresh();
    applyShortcutAnswer(settings, fallbacks, { kind: 'choose', id: 'view.toggle-grid', chord: null });
    expect(stored(settings)).toStrictEqual({ 'view.toggle-grid': null });
    applyShortcutAnswer(settings, fallbacks, { kind: 'reset' });
    expect(stored(settings)).toStrictEqual({});
  });

  it('CONTROL: a report the result schema refuses changes nothing', () => {
    const settings = fresh();
    applyShortcutAnswer(settings, fallbacks, { kind: 'choose', id: 'view.toggle-grid' });
    expect(stored(settings)).toStrictEqual({});
  });
});
