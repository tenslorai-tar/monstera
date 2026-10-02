import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type UiCommand } from '../registries/commands.js';
import { displayChord, shortcutRows, validateChord, withChosenShortcuts } from './shortcutChoice.js';

/** The rules a chosen key must pass, and how stored choices meet the registered defaults (ADR-0111). */

const TITLE = messageKey('command.test.title');
const command = (id: string, shortcut?: string, alsoShortcuts?: readonly string[]): UiCommand => ({
  id,
  feedback: { kind: 'visible' },
  title: TITLE,
  placements: [],
  run: () => undefined,
  ...(shortcut === undefined ? {} : { shortcut }),
  ...(alsoShortcuts === undefined ? {} : { alsoShortcuts }),
});

const TAKEN = new Map([
  ['ctrl+s', 'document.save'],
  ['ctrl+z', 'document.undo'],
]);

describe('validateChord — refused where it is made, each with its reason', () => {
  it('CONTROL: a free Ctrl chord and a function key may be chosen', () => {
    expect(validateChord('ctrl+shift+m', 'view.grid', TAKEN, undefined)).toBeNull();
    expect(validateChord('f7', 'view.grid', TAKEN, undefined)).toBeNull();
  });

  it('a chord another command answers is refused, NAMING that command', () => {
    expect(validateChord('ctrl+s', 'view.grid', TAKEN, undefined)).toStrictEqual({ kind: 'conflict', with: 'document.save' });
    // ITS OWN CURRENT CHORD is not a conflict with itself.
    expect(validateChord('ctrl+s', 'document.save', TAKEN, 'ctrl+s')).toBeNull();
  });

  it('keys Windows, an input method or the application’s navigation own are refused', () => {
    for (const chord of ['alt+f4', 'alt+tab', 'ctrl+space', 'escape', 'tab', 'f10', 'meta+e', 'ctrl+alt+x']) {
      expect(validateChord(chord, 'view.grid', TAKEN, undefined), chord).toStrictEqual({ kind: 'reserved' });
    }
  });

  it('a key a text field keeps is refused — unmodified keys, and the Ctrl keys a field answers — except the command’s own default', () => {
    for (const chord of ['g', 'shift+g', 'delete', 'ctrl+a', 'ctrl+shift+arrowleft']) {
      expect(validateChord(chord, 'view.grid', TAKEN, undefined), chord).toStrictEqual({ kind: 'typing' });
    }
    // UNDO GETS CTRL+Z BACK: a person restoring a default has chosen nothing new.
    expect(validateChord('ctrl+z', 'document.undo', TAKEN, 'ctrl+z')).toBeNull();
  });

  it('modifiers alone are not a chord', () => {
    expect(validateChord('ctrl+shift', 'view.grid', TAKEN, undefined)).toStrictEqual({ kind: 'incomplete' });
  });
});

describe('withChosenShortcuts — applied before the registry is built', () => {
  const COMMANDS = [command('document.save', 'Ctrl+S'), command('view.grid', 'Ctrl+G'), command('view.rulers', 'Ctrl+R')];

  it('a choice replaces the default, and null removes the key', () => {
    const { commands, dropped } = withChosenShortcuts(COMMANDS, { 'view.grid': 'ctrl+shift+m', 'view.rulers': null });
    expect(commands.map((each) => [each.id, each.shortcut])).toStrictEqual([
      ['document.save', 'Ctrl+S'],
      ['view.grid', 'Ctrl+Shift+M'],
      ['view.rulers', undefined],
    ]);
    expect(dropped).toStrictEqual([]);
  });

  it('a stored choice that collides with another command goes back to its default, and is REPORTED', () => {
    // A LATER BUILD GAVE CTRL+S AWAY AS A DEFAULT, say, while a person had chosen it for the grid.
    const { commands, dropped } = withChosenShortcuts(COMMANDS, { 'view.grid': 'ctrl+s' });
    expect(commands.find((each) => each.id === 'view.grid')?.shortcut).toBe('Ctrl+G');
    expect(dropped).toStrictEqual(['view.grid']);
  });

  it('a stored choice the rules now refuse is dropped too, and a choice for a command that no longer exists changes nothing', () => {
    const { commands, dropped } = withChosenShortcuts(COMMANDS, { 'view.grid': 'alt+f4', 'retired.command': 'ctrl+q' });
    expect(commands.find((each) => each.id === 'view.grid')?.shortcut).toBe('Ctrl+G');
    expect(dropped).toStrictEqual(['view.grid']);
  });

  it('a chosen chord colliding with another command’s FURTHER chord is dropped as well', () => {
    const withRedo = [...COMMANDS, command('document.redo', 'Ctrl+Y', ['Ctrl+Shift+Z'])];
    const { dropped } = withChosenShortcuts(withRedo, { 'view.grid': 'ctrl+shift+z' });
    expect(dropped).toStrictEqual(['view.grid']);
  });
});

describe('shortcutRows — every command, for the dialog where any can be given a key', () => {
  it('lists bound commands in chord order — including one unavailable right now — then the rest, each with its default', () => {
    const defaults = [
      // REGISTERED OUT OF ORDER, and one hidden by `when`: a chord that works only with a document open is still one
      // a person should be able to look up and change.
      { ...command('a.zeta', 'Ctrl+Z'), when: () => false },
      command('a.alpha', 'Alt+A', ['Alt+Shift+A']),
      // A COMMAND WITH NO KEY has a row too — the founding record's "rebind ANY registry command".
      command('a.unbound'),
    ];
    const { commands } = withChosenShortcuts(defaults, { 'a.alpha': 'ctrl+shift+q' });
    expect(shortcutRows(defaults, new CommandRegistry(commands))).toStrictEqual([
      { id: 'a.alpha', title: TITLE, chord: 'Ctrl+Shift+Q', fallback: 'Alt+A', also: ['Alt+Shift+A'] },
      { id: 'a.zeta', title: TITLE, chord: 'Ctrl+Z', fallback: 'Ctrl+Z', also: [] },
      { id: 'a.unbound', title: TITLE, chord: null, fallback: null, also: [] },
    ]);
  });
});

describe('displayChord', () => {
  it('reads a stored chord as a registered one is written', () => {
    expect(displayChord('ctrl+shift+plus')).toBe('Ctrl+Shift+Plus');
    expect(displayChord('ctrl+pagedown')).toBe('Ctrl+PageDown');
    expect(displayChord('f7')).toBe('F7');
    expect(displayChord('alt+space')).toBe('Alt+Space');
  });
});
