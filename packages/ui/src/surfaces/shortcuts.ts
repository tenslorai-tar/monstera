import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import { normaliseChord, shortcutMapOf } from './projections.js';

/**
 * The keyboard, as a projection of the command registry.
 *
 * §7: the shortcut map is derived, so **there is no keymap file**. A hand-kept
 * one is the second wiring place the registry exists to forbid, and its failure
 * is the one nobody reports — a shortcut that quietly stops matching its menu
 * item.
 *
 * ## Why this is separate from `shortcutMapOf`
 *
 * That function builds the map, over **all** commands, so a chord conflict is a
 * startup crash rather than a race. This one *dispatches*, which is where
 * `when` finally applies: a chord whose command does not exist in the current
 * context must fall through to the browser rather than doing nothing, so the
 * two halves ask different questions and are tested against different fixtures.
 */

/** The parts of a `KeyboardEvent` this needs, so a case can construct one. */
export interface KeyChord {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Spells a key event the way {@link normaliseChord} spells a declared shortcut.
 *
 * **Both spellings come from one function**, which is the point: a lookup that
 * normalised the declaration one way and the event another would miss every
 * chord and report nothing — the failure that looks exactly like a user who has
 * not pressed anything (B3a).
 *
 * A bare modifier press produces a chord of modifiers only, which no command
 * can declare — `normaliseChord` keeps the modifiers and there is no key — so
 * it cannot match, without needing a case that says so.
 */
export function chordOf(event: KeyChord): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('meta');
  // Modifier keys arrive as their own `key` value while also setting their
  // flag; including them would spell `ctrl+control`, which matches nothing and
  // would silently swallow the modifier press that precedes every chord.
  const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta']);
  if (!modifierKeys.has(event.key)) parts.push(event.key.toLowerCase());
  return normaliseChord(parts.join('+'));
}

/** What a key press did, so a caller knows whether to let the browser have it. */
export type Dispatch =
  | { readonly kind: 'ran'; readonly command: UiCommand }
  /** A chord nothing claims, or one whose command does not exist right now. */
  | { readonly kind: 'unclaimed' };

/**
 * Runs the command a chord names, if it exists in this context.
 *
 * **`when` is applied HERE and not when the map is built.** A command hidden by
 * its predicate is absent, and an absent command's chord belongs to whatever
 * would otherwise receive it — so this answers `unclaimed`, and the caller does
 * not call `preventDefault`. Swallowing it instead would make the application
 * eat a browser shortcut to run nothing, which is the shape a user reports as
 * "Ctrl+F stopped working" and nobody can reproduce.
 *
 * `run` may return a promise. It is **not awaited**: a key handler that awaited
 * would hold the event loop through a document operation, and every caller
 * needs its answer synchronously to decide about `preventDefault`. A rejection
 * is therefore the caller's to observe, and `dispatchChord` returns the command
 * so it can.
 */
export function dispatchChord(
  registry: CommandRegistry,
  map: ReadonlyMap<string, UiCommand>,
  event: KeyChord,
  context: CommandContext,
): Dispatch {
  const command = map.get(chordOf(event));
  if (command === undefined) return { kind: 'unclaimed' };
  if (!(command.when?.(context) ?? true)) return { kind: 'unclaimed' };
  void command.run(context);
  return { kind: 'ran', command };
}

/** Builds the map once, for a caller that holds it for the session. */
export function shortcutsFor(registry: CommandRegistry): ReadonlyMap<string, UiCommand> {
  return shortcutMapOf(registry);
}
