import { KEYBOARD_SHORTCUTS_DIALOG_ID, KEYBOARD_SHORTCUTS_RESULT } from '../dialogs/keyboardShortcuts.js';
import { GROUP_APPLICATION, KEYBOARD_SHORTCUTS_COMMAND_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { SHORTCUTS_SETTING } from '../settings/keyboard.js';
import type { SettingsStore } from '../settingsStore.js';
import { normaliseChord } from '../surfaces/projections.js';
import type { ShortcutRow } from '../surfaces/shortcutChoice.js';

/**
 * Opens the keyboard shortcuts — the list, and where any key is changed (§10.3's footer: *"Press F1 for keyboard
 * shortcuts"*; [ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)).
 *
 * ## The rows are read WHEN IT RUNS, through a function
 *
 * The rows are the registry's, and this command is one of the registry's entries, so the registry cannot exist when
 * this is made. `rows` is therefore a function the shell answers from the finished registry, called in `run`.
 *
 * ## THIS command writes the choice, never the dialog
 *
 * The dialog reports each change (ADR-0094) and this writes it to `keyboard.shortcuts`, storing only a DIFFERENCE from
 * the registered key: a choice equal to the default removes the entry, so a default a later build changes still
 * reaches a person who never chose otherwise. The shell rebuilds its registry from the setting, so the new key works
 * as soon as it is written — the menus and the palette read it from the same field.
 *
 * ## F1, and the ribbon beside About
 *
 * F1 because §10.3 names it. The ribbon placement puts it in Tools › Application beside About.
 */
export function keyboardShortcutsCommand(deps: {
  readonly ask: (id: string, props: unknown, onUpdate?: (result: unknown) => void) => Promise<unknown>;
  readonly rows: () => readonly ShortcutRow[];
  /** The commands whose stored key went back to its default when the registry was built (`withChosenShortcuts`). */
  readonly dropped: () => readonly string[];
  readonly settings: SettingsStore;
}): UiCommand {
  return {
    id: 'app.keyboard-shortcuts',
    icon: 'Keyboard',
    title: KEYBOARD_SHORTCUTS_COMMAND_TITLE,
    shortcut: 'F1',
    placements: [
      // SECONDARY since Help › Keyboard shortcuts exists (ADR-0107).
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 930, prominence: 'secondary' },
      { surface: 'menu-bar', menu: 'help', group: 0, order: 10 },
    ],
    run: (): void => {
      const rows = deps.rows();
      const fallbacks = new Map(rows.map((row) => [row.id, row.fallback]));
      const apply = (reported: unknown): void => {
        const answer = KEYBOARD_SHORTCUTS_RESULT.safeParse(reported);
        if (!answer.success) return;
        if (answer.data.kind === 'reset') {
          deps.settings.set(SHORTCUTS_SETTING.id, {});
          return;
        }
        const { id, chord } = answer.data;
        const current = SHORTCUTS_SETTING.schema.parse(deps.settings.get(SHORTCUTS_SETTING.id));
        const { [id]: _previous, ...others } = current;
        const fallback = fallbacks.get(id) ?? null;
        const stored = chord === null ? null : normaliseChord(chord);
        const isDefault = (stored ?? null) === (fallback === null ? null : normaliseChord(fallback));
        deps.settings.set(SHORTCUTS_SETTING.id, isDefault ? others : { ...others, [id]: stored });
      };
      // Voided, for `showAbout`'s reason: the dialog reports as it goes and settles only on dismissal.
      void deps.ask(KEYBOARD_SHORTCUTS_DIALOG_ID, { rows: [...rows], dropped: [...deps.dropped()] }, apply);
    },
  };
}
