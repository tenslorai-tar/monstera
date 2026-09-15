import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { KEYBOARD_SHORTCUTS_DIALOG_ID } from '../dialogs/keyboardShortcuts.js';
import type { CommandContext } from '../registries/commands.js';
import type { ShortcutEntry } from '../surfaces/projections.js';
import { keyboardShortcutsCommand } from './keyboardShortcuts.js';

const context = {} as CommandContext;

describe('the keyboard shortcuts command', () => {
  it('is bound to F1, the key §10.3’s footer names', () => {
    const command = keyboardShortcutsCommand({ ask: () => Promise.resolve(undefined), shortcuts: () => [] });
    expect(command.shortcut).toBe('F1');
  });

  it('opens the shortcuts dialog with EXACTLY the list it is given, read when it RUNS', () => {
    const opened: unknown[] = [];
    let list: readonly ShortcutEntry[] = [{ chord: 'Ctrl+O', title: messageKey('command.open.title') }];
    const command = keyboardShortcutsCommand({
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
      shortcuts: () => list,
    });

    // CHANGED AFTER THE COMMAND WAS MADE, which is the shell's situation: the registry this list comes from is built
    // after the command. A command that captured the list when it was made would open with the first entry alone.
    list = [...list, { chord: 'F1', title: messageKey('command.keyboard-shortcuts.title') }];
    void command.run(context);

    expect(opened).toStrictEqual([{ id: KEYBOARD_SHORTCUTS_DIALOG_ID, props: { entries: list } }]);
  });
});
