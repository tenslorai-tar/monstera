import type { MessageKey } from '@monstera/shared';

import {
  TIP_ASSISTANT,
  TIP_BACK,
  TIP_COMPARE,
  TIP_FIND,
  TIP_FLOAT_BAR,
  TIP_FLOAT_BAR_RESET,
  TIP_FOCUS,
  TIP_GO_TO,
  TIP_HELP,
  TIP_KEY,
  TIP_KEY_CHECK,
  TIP_LOUPE,
  TIP_OCR,
  TIP_PALETTE,
  TIP_PANES,
  TIP_PLACE,
  TIP_REDACT,
  TIP_RIGHT_CLICK,
  TIP_RULERS,
  TIP_SHORTCUTS,
  TIP_SPELLING,
  TIP_TIPS_OFF,
  TIP_UNDO,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { SectionId } from '../registries/placement.js';

/**
 * The status bar's tips ([ADR-0159](../../../../docs/DECISIONS/0159-a-tip-is-registered-names-its-commands-and-is-shown-in-the-status-bar.md)).
 *
 * ## A tip names commands by id, and its words take their titles and keys from the registry
 *
 * A written tip's `names` maps a placeholder to a command id. `{name}` is drawn as that command's title and `{nameKey}`
 * as its shortcut, both read from the built registry when the tip is shown, so a renamed command renames every tip that
 * names it and a rebound key is the key the tip says. `App.test.tsx` resolves every id here against the application's
 * registry, as it does the help articles', and refuses a `{nameKey}` for a command with no key.
 *
 * ## Most tips are derived, so they cannot be untrue
 *
 * Every command with a key gives a tip saying its key, and every command on the ribbon one saying where it is. They say
 * only what the registry says.
 */
export interface WrittenTip {
  readonly id: string;
  readonly words: MessageKey;
  /** Placeholder to command id. Each placeholder `{name}` is the command's title; `{nameKey}` is its shortcut. */
  readonly names: Readonly<Record<string, string>>;
}

/** A tip ready to draw: its words and every value they take, resolved against the registry. */
export interface Tip {
  readonly id: string;
  readonly words: MessageKey;
  readonly values: Readonly<Record<string, string>>;
}

export const WRITTEN_TIPS: readonly WrittenTip[] = [
  { id: 'help', words: TIP_HELP, names: { help: 'app.help' } },
  { id: 'palette', words: TIP_PALETTE, names: { palette: 'view.command-palette' } },
  { id: 'shortcuts', words: TIP_SHORTCUTS, names: { shortcuts: 'app.keyboard-shortcuts' } },
  { id: 'float-bar', words: TIP_FLOAT_BAR, names: { floatBar: 'view.toggle-quick-toolbar' } },
  { id: 'float-bar-reset', words: TIP_FLOAT_BAR_RESET, names: { reset: 'view.reset-float-bar' } },
  { id: 'focus', words: TIP_FOCUS, names: { focus: 'view.layout-focus', leave: 'view.leave-focus' } },
  { id: 'panes', words: TIP_PANES, names: { next: 'view.next-pane', previous: 'view.previous-pane' } },
  { id: 'compare', words: TIP_COMPARE, names: { compare: 'document.compare' } },
  { id: 'undo', words: TIP_UNDO, names: { undo: 'document.undo', redo: 'document.redo' } },
  { id: 'go-to', words: TIP_GO_TO, names: { goTo: 'view.go-to' } },
  { id: 'back', words: TIP_BACK, names: { back: 'view.go-back', forward: 'view.go-forward' } },
  { id: 'rulers', words: TIP_RULERS, names: { rulers: 'view.toggle-rulers', grid: 'view.toggle-grid' } },
  { id: 'loupe', words: TIP_LOUPE, names: { loupe: 'view.toggle-loupe' } },
  { id: 'spelling', words: TIP_SPELLING, names: { spelling: 'document.spell-check' } },
  { id: 'key-check', words: TIP_KEY_CHECK, names: { settings: 'app.settings' } },
  { id: 'redact', words: TIP_REDACT, names: { apply: 'document.apply-redactions' } },
  { id: 'ocr', words: TIP_OCR, names: { ocr: 'document.ocr' } },
  { id: 'assistant', words: TIP_ASSISTANT, names: { assistant: 'ai.open-assistant' } },
  { id: 'right-click', words: TIP_RIGHT_CLICK, names: {} },
  { id: 'tips-off', words: TIP_TIPS_OFF, names: { settings: 'app.settings' } },
  { id: 'find', words: TIP_FIND, names: { find: 'document.find' } },
];

/** The key a placeholder's shortcut is drawn under: `{help}` is the title, `{helpKey}` the key. */
export function keyPlaceholder(name: string): string {
  return `${name}Key`;
}

/**
 * A title as a tip says it: without the trailing ellipsis that marks a command opening a dialog, which reads as a
 * stray mark inside a sentence.
 */
function spoken(title: string): string {
  return title.replace(/…$/u, '');
}

/**
 * Every tip this registry can show: the written ones whose commands are all registered, then a key tip for each command
 * with a shortcut and a place tip for each command on the ribbon, in registry order.
 *
 * A written tip naming a command that is not registered is left out here rather than drawn with a hole in it; the case
 * in `App.test.tsx` is what refuses it.
 */
export function tipsOf(
  commands: readonly UiCommand[],
  say: (key: MessageKey) => string,
  sectionTitle: (section: SectionId) => MessageKey,
): readonly Tip[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const tips: Tip[] = [];
  for (const tip of WRITTEN_TIPS) {
    const values: Record<string, string> = {};
    let whole = true;
    for (const [name, id] of Object.entries(tip.names)) {
      const command = byId.get(id);
      if (command === undefined) {
        whole = false;
        break;
      }
      values[name] = spoken(say(command.title));
      if (command.shortcut !== undefined) values[keyPlaceholder(name)] = command.shortcut;
    }
    if (whole) tips.push({ id: tip.id, words: tip.words, values });
  }
  for (const command of commands) {
    if (command.shortcut !== undefined) {
      tips.push({ id: `key:${command.id}`, words: TIP_KEY, values: { command: spoken(say(command.title)), key: command.shortcut } });
    }
  }
  for (const command of commands) {
    const place = command.placements.find((placement) => placement.surface === 'ribbon');
    if (place?.surface === 'ribbon') {
      tips.push({
        id: `place:${command.id}`,
        words: TIP_PLACE,
        values: { command: spoken(say(command.title)), section: say(sectionTitle(place.section)), group: say(place.group) },
      });
    }
  }
  return tips;
}

/**
 * The next tip and the round it leaves: one not yet shown in this round, chosen by `random`, and a new round once every
 * tip has been. A stored id that names no tip now is dropped from the round rather than counted.
 *
 * @param random a number in [0, 1), `Math.random` in the application and a fixed sequence in a case
 */
export function nextTip(
  tips: readonly Tip[],
  shown: readonly string[],
  random: () => number,
): { readonly tip: Tip; readonly shown: readonly string[] } | undefined {
  if (tips.length === 0) return undefined;
  const known = new Set(tips.map((tip) => tip.id));
  const round = shown.filter((id) => known.has(id));
  const left = tips.filter((tip) => !round.includes(tip.id));
  const pool = left.length === 0 ? tips : left;
  const tip = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  if (tip === undefined) return undefined;
  return { tip, shown: left.length === 0 ? [tip.id] : [...round, tip.id] };
}
