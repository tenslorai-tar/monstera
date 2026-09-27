import type { MessageKey } from '@monstera/shared';

import type { CommandRegistry, UiCommand } from '../registries/commands.js';
import { chordsOf, normaliseChord } from './projections.js';

/**
 * One command as the keyboard shortcuts dialog shows it: its key now, the key it was registered with, and any
 * further keys it answers. Every chord is in its DISPLAY form (`Ctrl+Shift+Z`), as a surface prints one.
 */
export interface ShortcutRow {
  readonly id: string;
  readonly title: MessageKey;
  /** The key it runs on now — the chosen one, or the registered default — or `null` for none. */
  readonly chord: string | null;
  /** The key it was registered with, which *Reset* restores. */
  readonly fallback: string | null;
  /** Further keys it answers (Decision 4), shown beside the first and never rebound. */
  readonly also: readonly string[];
}

/**
 * Every command, for the dialog where any of them can be given a key — the founding record's *"rebind ANY registry
 * command"*, so a command with no key yet has a row too. Bound commands first in chord order, then the rest by id,
 * so the list a person scans to learn the keys reads as it did before rows without keys joined it.
 *
 * It walks the registry rather than the shortcut map, which the list it replaced did so a conflict could not show as
 * two rows: that still cannot happen, because the map is built at render — and throws on a conflict — before the
 * command that asks for these rows can run.
 *
 * @param defaults the commands as registered, before any choice — where each row's `fallback` comes from
 * @param applied the registry the choices were applied to — where each row's key now comes from
 */
export function shortcutRows(defaults: readonly UiCommand[], applied: CommandRegistry): ShortcutRow[] {
  const registered = new Map(defaults.map((command) => [command.id, command.shortcut ?? null]));
  const rows = applied.all().map((command) => ({
    id: command.id,
    title: command.title,
    chord: command.shortcut ?? null,
    fallback: registered.get(command.id) ?? null,
    also: [...(command.alsoShortcuts ?? [])],
  }));
  const sortKey = (row: ShortcutRow): string =>
    row.chord === null ? `1 ${row.id}` : `0 ${normaliseChord(row.chord)}`;
  return rows.sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
}

/**
 * The keys a person chose, and the rules a choice must pass
 * ([ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)).
 *
 * ## Two writers, one meeting point
 *
 * A command's registration writes its DEFAULT chord and the `keyboard.shortcuts` setting writes a person's CHOICE.
 * They meet here, once, in {@link withChosenShortcuts}, before the registry is built — so the shortcut map, the F1
 * list, the menu bar, the palette and every other projection keep reading one `shortcut` field.
 *
 * ## Validated where a choice is MADE, and again where it is APPLIED
 *
 * The map's conflict is a throw at render, so a bad stored choice would take the window down at every start.
 * {@link validateChord} refuses a choice in the dialog, naming why; {@link withChosenShortcuts} drops any stored choice
 * that no longer passes — a later build that gave its key to a new command, or a value from an older build — and
 * reports which, rather than trusting what was written.
 */

/** `keyboard.shortcuts`' value: a command id → the normalised chord chosen for it, or `null` for *no key*. */
export type ChosenShortcuts = Readonly<Record<string, string | null>>;

/** Why a chord cannot be chosen for a command. */
export type ChordRefusal =
  /** Another command already answers it, named so the dialog can say which. */
  | { readonly kind: 'conflict'; readonly with: string }
  /** Windows, the input method or the application's own navigation owns it, so it would never reach a command. */
  | { readonly kind: 'reserved' }
  /** A text field keeps it for itself, so the command would stop working whenever a person is typing. */
  | { readonly kind: 'typing' }
  /** Modifiers alone — nothing a command can be pressed with. */
  | { readonly kind: 'incomplete' };

const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;

/**
 * Keys that never reach a command. Windows keeps Alt+Tab, Alt+F4, Alt+Esc, Alt+Space, Ctrl+Esc and Ctrl+Shift+Esc; an
 * input method keeps Ctrl+Space, Shift+Space and Ctrl+.; and the application's own navigation needs Tab, Escape and
 * F10 (the menu bar) and the menu key. Anything with the Windows key, and Ctrl+Alt+anything (AltGr on many layouts),
 * is refused by rule below rather than listed.
 */
const RESERVED: ReadonlySet<string> = new Set([
  'alt+tab',
  'alt+f4',
  'alt+escape',
  'alt+space',
  'ctrl+escape',
  'ctrl+shift+escape',
  'ctrl+space',
  'shift+space',
  'ctrl+.',
  'tab',
  'shift+tab',
  'escape',
  'f10',
  'shift+f10',
  'contextmenu',
]);

/** The Ctrl chords a text field answers itself — `fieldOwnsChord`'s list, as chords. */
const FIELD_CTRL: ReadonlySet<string> = new Set(
  ['z', 'y', 'a', 'c', 'x', 'v', 'home', 'end', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'backspace', 'delete'].map(
    (key) => `ctrl+${key}`,
  ),
);

/**
 * Whether `chord` (normalised) may be chosen for `commandId`.
 *
 * @param taken every chord currently answered, normalised, and the command that answers it
 * @param own the command's DEFAULT chord, normalised — always allowed back, even where a field shares it (Undo's
 *   Ctrl+Z is a text field's too, and a person restoring it has not chosen anything new)
 * @returns `null` when it may be chosen
 */
export function validateChord(
  chord: string,
  commandId: string,
  taken: ReadonlyMap<string, string>,
  own: string | undefined,
): ChordRefusal | null {
  const parts = chord.split('+');
  const key = parts.filter((part) => !(MODIFIERS as readonly string[]).includes(part));
  if (key.length === 0) return { kind: 'incomplete' };
  const holder = taken.get(chord);
  if (holder !== undefined && holder !== commandId) return { kind: 'conflict', with: holder };
  if (chord === own) return null;
  if (RESERVED.has(chord) || parts.includes('meta') || (parts.includes('ctrl') && parts.includes('alt'))) {
    return { kind: 'reserved' };
  }
  const functionKey = key.length === 1 && /^f\d{1,2}$/u.test(key[0] ?? '');
  if (!functionKey && !parts.includes('ctrl') && !parts.includes('alt')) return { kind: 'typing' };
  if (FIELD_CTRL.has(chord.replace('shift+', ''))) return { kind: 'typing' };
  return null;
}

/**
 * A normalised chord as a person reads it: `ctrl+shift+plus` → `Ctrl+Shift+Plus`, `pagedown` → `PageDown`.
 *
 * The stored form is normalised so two spellings are one choice; this is the form a command's `shortcut` carries, so
 * a chosen chord reads like a registered one wherever a surface prints it.
 */
export function displayChord(chord: string): string {
  const names: Readonly<Record<string, string>> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win',
    plus: 'Plus',
    escape: 'Escape',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    delete: 'Delete',
    backspace: 'Backspace',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    enter: 'Enter',
  };
  return chord
    .split('+')
    .map((part) => names[part] ?? (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

/**
 * The commands as a person has chosen their keys: each chosen chord in place of the default, `null` as no key, and
 * any stored choice that would collide or is no longer allowed dropped back to the default — reported, never thrown.
 */
export function withChosenShortcuts(
  commands: readonly UiCommand[],
  chosen: ChosenShortcuts,
): { readonly commands: UiCommand[]; readonly dropped: readonly string[] } {
  const defaults = new Map(commands.map((command) => [command.id, command]));
  const dropped = new Set<string>();

  const apply = (): UiCommand[] =>
    commands.map((command) => {
      if (!(command.id in chosen) || dropped.has(command.id)) return command;
      const choice = chosen[command.id];
      if (choice === null || choice === undefined) {
        const { shortcut: _removed, ...rest } = command;
        return rest;
      }
      return { ...command, shortcut: displayChord(choice) };
    });

  // DROPPED UNTIL NOTHING COLLIDES. Defaults never collide among themselves — the registry refuses that at startup —
  // so each pass removes a choice involved in a collision, and the loop ends within one pass per stored choice.
  for (;;) {
    const applied = apply();
    const holders = new Map<string, string>();
    let collided: string | undefined;
    for (const command of applied) {
      for (const declared of chordsOf(command)) {
        const chord = normaliseChord(declared);
        const other = holders.get(chord);
        if (other !== undefined) {
          collided = [command.id, other].find((id) => id in chosen && !dropped.has(id));
          break;
        }
        holders.set(chord, command.id);
      }
      if (collided !== undefined) break;
    }
    // A STORED CHOICE THE RULES NOW REFUSE (reserved, a field's key) goes back to the default too.
    const refused =
      collided ??
      Object.entries(chosen).find(([id, choice]) => {
        if (dropped.has(id) || choice === null || !defaults.has(id)) return false;
        const own = defaults.get(id)?.shortcut;
        const refusal = validateChord(choice, id, new Map(), own === undefined ? undefined : normaliseChord(own));
        return refusal !== null;
      })?.[0];
    if (refused === undefined) return { commands: applied, dropped: [...dropped] };
    dropped.add(refused);
  }
}
