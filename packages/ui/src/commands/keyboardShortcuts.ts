import { KEYBOARD_SHORTCUTS_DIALOG_ID, KEYBOARD_SHORTCUTS_RESULT } from '../dialogs/keyboardShortcuts.js';
import { GROUP_APPLICATION, KEYBOARD_SHORTCUTS_COMMAND_TITLE } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import { SHORTCUTS_SETTING } from '../settings/keyboard.js';
import type { SettingsStore } from '../settingsStore.js';
import { normaliseChord } from '../surfaces/projections.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';

/**
 * Opens the keyboard shortcuts — the list to read (the founding record's D12 *"keyboard shortcut reference"*). A key is
 * changed in Settings › Keyboard, not here ([ADR-0191](../../../../docs/DECISIONS/0191-keys-are-changed-in-settings-keyboard-and-help-lists-them-without-the-editing.md),
 * correcting [ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)'s
 * place for it).
 *
 * ## The rows are read WHEN IT RUNS, through a function
 *
 * The rows are the registry's, and this command is one of the registry's entries, so the registry cannot exist when
 * this is made. `rows` is therefore a function the shell answers from the finished registry, called in `run`.
 *
 * ## It writes nothing
 *
 * The dialog takes no report, so there is no route from here to `keyboard.shortcuts`; {@link applyShortcutAnswer} below
 * is the one writer, called by the Settings command that opens the page where keys change.
 *
 * ## Ctrl+/, and the ribbon beside About
 *
 * Ctrl+/ since ADR-0112 gave F1 to the Help centre, which is the key the owner's list names for help; this was F1
 * because §10.3 named it before that amendment. The ribbon placement puts it in Tools › Application beside About.
 */
export function keyboardShortcutsCommand(deps: {
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly rows: () => readonly ShortcutRow[];
  /** The commands whose stored key went back to its default when the registry was built (`withChosenShortcuts`). */
  readonly dropped: () => readonly string[];
}): UiCommand {
  return {
    id: 'app.keyboard-shortcuts',
    feedback: VISIBLE,
    icon: 'Keyboard',
    title: KEYBOARD_SHORTCUTS_COMMAND_TITLE,
    shortcut: 'Ctrl+/',
    placements: [
      // SECONDARY since Help › Keyboard shortcuts exists (ADR-0107).
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 930, prominence: 'secondary' },
      { surface: 'menu-bar', menu: 'help', group: 0, order: 10 },
    ],
    run: (): void => {
      // A LIST TO READ (ADR-0191): no report is taken, so nothing here can write a key. Voided, for `showAbout`'s
      // reason: the dialog settles only on dismissal.
      void deps.ask(KEYBOARD_SHORTCUTS_DIALOG_ID, { rows: [...deps.rows()], dropped: [...deps.dropped()] });
    },
  };
}

/**
 * Writes a key change to `keyboard.shortcuts` — the ONE writer of that setting from a surface (B3), taken by Settings'
 * Keyboard page, which reports each change as it is made (ADR-0191).
 *
 * Only a DIFFERENCE from the registered key is stored: a choice equal to the default removes the entry, so a default a
 * later build changes still reaches a person who never chose otherwise. A report the result schema refuses changes
 * nothing. The shell rebuilds its registry from the setting, so the new key works as soon as it is written — the menus
 * and the palette read it from the same field.
 *
 * @param fallbacks each command's registered key, by id, as the rows give it
 */
export function applyShortcutAnswer(
  settings: SettingsStore,
  fallbacks: ReadonlyMap<string, string | null>,
  reported: unknown,
): void {
  const answer = KEYBOARD_SHORTCUTS_RESULT.safeParse(reported);
  if (!answer.success) return;
  if (answer.data.kind === 'reset') {
    settings.set(SHORTCUTS_SETTING.id, {});
    return;
  }
  const { id, chord } = answer.data;
  const current = SHORTCUTS_SETTING.schema.parse(settings.get(SHORTCUTS_SETTING.id));
  const { [id]: _previous, ...others } = current;
  const fallback = fallbacks.get(id) ?? null;
  const stored = chord === null ? null : normaliseChord(chord);
  const isDefault = (stored ?? null) === (fallback === null ? null : normaliseChord(fallback));
  settings.set(SHORTCUTS_SETTING.id, isDefault ? others : { ...others, [id]: stored });
}
