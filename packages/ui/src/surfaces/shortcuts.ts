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
  /** The key's POSITION on the keyboard (`KeyS`, `Digit1`, `NumpadAdd`), whatever character the layout gives it. */
  readonly code: string;
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
  if (!modifierKeys.has(event.key)) parts.push(keyOf(event));
  return normaliseChord(parts.join('+'));
}

/**
 * The key a chord names, spelt so the same key is the same chord on every keyboard layout (ADR-0111 Decision 3).
 *
 * `event.key` is the CHARACTER the layout produces, and on a Cyrillic, Greek, Hebrew, Arabic or Thai layout Ctrl+S
 * produces a character that is not `s` — so every Ctrl+letter chord was dead there — and on French AZERTY Ctrl+1 and
 * Ctrl+0 produce `&` and `à`. Where the character is not a Latin letter or digit and the key's POSITION is one
 * (`KeyS`, `Digit1`), the position names it. Where the character IS one it wins, so a layout that moves a letter (the
 * `A` of AZERTY, where QWERTY has `Q`) keeps the letter its keycap shows.
 *
 * **The plus key has a name**, `plus`, from the character or the numpad's key: `+` is the separator every chord is
 * split on, so a chord ending in it could not be spelt at all — Ctrl+plus sign and numpad plus reached nothing.
 */
function keyOf(event: KeyChord): string {
  if (event.key === '+' || event.code === 'NumpadAdd') return 'plus';
  // THE SPACE BAR has a name for the same reason: `normaliseChord` trims each part, and a space trimmed is no key.
  if (event.key === ' ') return 'space';
  const character = event.key.toLowerCase();
  if (/^[a-z0-9]$/u.test(character)) return character;
  const position = /^(?:Key([A-Z])|Digit(\d))$/u.exec(event.code);
  if (event.key.length === 1 && position !== null) return (position[1] ?? position[2] ?? '').toLowerCase();
  return character;
}

/**
 * Whether a key press aimed at `target` belongs to the TEXT FIELD it was typed in.
 *
 * ## The dispatcher listens on the document, and a field has keys of its own
 *
 * Until 2026-09-23 there was no rule here, and it cost nothing visible while
 * the fields were a search box and a dialog's inputs. Text edited in place on
 * the page (ADR-0096) is where it bit: Ctrl+Home in the editor turned the
 * document to its first page and left the caret where it was, and Ctrl+Z would
 * have undone the document rather than the typing. `annotationData.ts` had
 * already kept Ctrl+V off the keyboard for this exact reason, waiting on this
 * rule.
 *
 * ## What a field owns
 *
 * Every key pressed without Ctrl, Alt or Meta — characters, Shift+characters,
 * Delete, Backspace, Enter, the arrows, Home and End — except the function
 * keys, which no field gives a meaning to. And the Ctrl chords every text field
 * answers itself: undo and redo, select all, copy, cut and paste, and moving or
 * deleting by word and to the ends of the text. Everything else — Ctrl+S,
 * Ctrl+K, F1 — stays the application's, because a shortcut that stopped
 * working whenever a field had focus is one people report as intermittent.
 */
export function fieldOwnsChord(target: EventTarget | null, event: KeyChord): boolean {
  if (!isTypingField(target)) return false;
  const key = event.key.toLowerCase();
  if (/^f\d{1,2}$/u.test(key)) return false;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return true;
  if (event.altKey || event.metaKey) return false;
  return FIELD_CTRL_KEYS.has(key);
}

/** The keys a text field answers itself when pressed with Ctrl (and Shift). */
const FIELD_CTRL_KEYS: ReadonlySet<string> = new Set([
  'z',
  'y',
  'a',
  'c',
  'x',
  'v',
  'home',
  'end',
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'backspace',
  'delete',
]);

/**
 * Whether an element is one a person types text into. Exported because the Edit menu's verbs ask the same question of
 * the element that had the focus (`typingFocus.ts`) — one answer to *is this a text field*, not two (B3a).
 */
export function isTypingField(target: EventTarget | null): target is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && TYPED_INPUTS.has(target.type);
  }
  return false;
}

/** The roles of a focused control that moves with the arrow and page keys itself. */
const ARROW_ROLES: ReadonlySet<string> = new Set([
  'slider',
  'spinbutton',
  'listbox',
  'option',
  'menu',
  'menubar',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'tablist',
  'tab',
  'grid',
  'gridcell',
  'tree',
  'treeitem',
  'radiogroup',
  'radio',
]);

/** The keys such a control answers. */
const ARROW_KEYS: ReadonlySet<string> = new Set([
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'pageup',
  'pagedown',
  'home',
  'end',
]);

/**
 * Whether a key press belongs to the focused CONTROL rather than the page — a slider, a select, a list, a menu, a tab
 * row — because it moves by the arrow and page keys itself. Without this, a selected annotation's nudge commands took
 * the arrows from the zoom slider and the document's page commands took PageDown from a list, and the control did not
 * move (ADR-0111 Decision 5). Only unmodified or Shift presses: Ctrl+Home is still the document's.
 */
export function controlOwnsChord(target: EventTarget | null, event: KeyChord): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (!ARROW_KEYS.has(event.key.toLowerCase())) return false;
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'radio')) return true;
  const role = target.getAttribute('role');
  return role !== null && ARROW_ROLES.has(role);
}

/** The input types a person types text into, as opposed to ticks, sliders and buttons. */
const TYPED_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

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
