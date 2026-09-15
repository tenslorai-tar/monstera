import { KEYBOARD_SHORTCUTS_DIALOG_ID } from '../dialogs/keyboardShortcuts.js';
import { GROUP_APPLICATION, KEYBOARD_SHORTCUTS_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { ShortcutEntry } from '../surfaces/projections.js';

/**
 * Opens the list of keyboard shortcuts (§10.3's footer: *"Press F1 for keyboard shortcuts"*).
 *
 * ## The list is read WHEN IT RUNS, through a function
 *
 * The list is the registry's, and this command is one of the registry's entries, so the registry cannot exist when this
 * is made. `shortcuts` is therefore a function the shell answers from the finished registry, and it is called in `run`
 * — a list captured when the command was made would be empty, and one captured at any other moment could be stale.
 *
 * ## F1, and the ribbon beside About
 *
 * F1 because §10.3 names it. The ribbon placement puts it in Tools › Application beside About, which is where a person
 * with a document open looks for help; with no document open the start screen's footer names the chord.
 */
export function keyboardShortcutsCommand(deps: {
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly shortcuts: () => readonly ShortcutEntry[];
}): UiCommand {
  return {
    id: 'app.keyboard-shortcuts',
    icon: 'Keyboard',
    title: KEYBOARD_SHORTCUTS_COMMAND_TITLE,
    shortcut: 'F1',
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 30 }],
    run: (): void => {
      // Voided, for `showAbout`'s reason: this dialog declares no result and settles only on dismissal.
      void deps.ask(KEYBOARD_SHORTCUTS_DIALOG_ID, { entries: [...deps.shortcuts()] });
    },
  };
}
