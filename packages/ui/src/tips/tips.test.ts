import { type MessageKey, messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { TIP_HELP, TIP_KEY, TIP_PLACE } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import { type Tip, WRITTEN_TIPS, nextTip, tipsOf } from './tips.js';

/**
 * The tips' rules (ADR-0159): how a tip takes its titles and keys from the registry, which tips are derived, and the
 * order a round goes in. Whether every name a written tip uses is REGISTERED is `App.test.tsx`'s, against the
 * application's own registry, as the help articles' are.
 */

const say = (key: MessageKey): string => `«${key}»`;
const section = (): MessageKey => messageKey('surface.ribbon.section.home');

function command(id: string, over: Partial<UiCommand> = {}): UiCommand {
  return { id, title: messageKey(`title.${id}`), placements: [], run: () => undefined, feedback: VISIBLE, ...over };
}

describe('tipsOf', () => {
  it('draws a written tip with the title and key of each command it names, read from the registry', () => {
    const tips = tipsOf([command('app.help', { shortcut: 'F1' })], say, section);
    expect(tips.find((tip) => tip.id === 'help')).toStrictEqual({
      id: 'help',
      words: TIP_HELP,
      values: { help: '«title.app.help»', helpKey: 'F1' },
    });
  });

  it('LEAVES OUT a written tip one of whose commands is not registered, rather than drawing a hole', () => {
    const tips = tipsOf([command('document.undo', { shortcut: 'Ctrl+Z' })], say, section);
    // `undo` names undo AND redo; with redo missing the tip is not drawn at all.
    expect(tips.map((tip) => tip.id)).not.toContain('undo');
  });

  it('derives a KEY tip for each command with a shortcut, and a PLACE tip for each on the ribbon, and no other', () => {
    const tips = tipsOf(
      [
        command('a.keyed', { shortcut: 'Ctrl+K' }),
        command('a.placed', {
          placements: [{ surface: 'ribbon', section: 'home', group: messageKey('group.g'), order: 1 }],
        }),
        // CONTROL: neither a key nor a ribbon place, so no derived tip.
        command('a.bare', { placements: [{ surface: 'quick-toolbar', order: 1 }] }),
      ],
      say,
      section,
    );
    const derived = tips.filter((tip) => tip.id.includes(':'));
    expect(derived).toStrictEqual([
      { id: 'key:a.keyed', words: TIP_KEY, values: { command: '«title.a.keyed»', key: 'Ctrl+K' } },
      {
        id: 'place:a.placed',
        words: TIP_PLACE,
        values: { command: '«title.a.placed»', section: '«surface.ribbon.section.home»', group: '«group.g»' },
      },
    ]);
  });

  it('says a title without the ellipsis that marks a command opening a dialog', () => {
    const tips = tipsOf([command('document.open', { shortcut: 'Ctrl+O' })], () => 'Open PDF…', section);
    expect(tips.find((tip) => tip.id === 'key:document.open')?.values['command']).toBe('Open PDF');
  });

  it('every WRITTEN tip has a distinct id that no derived tip can take', () => {
    const ids = WRITTEN_TIPS.map((tip) => tip.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.includes(':'))).toStrictEqual([]);
  });
});

describe('nextTip', () => {
  const tips: readonly Tip[] = ['a', 'b', 'c'].map((id) => ({ id, words: TIP_HELP, values: {} }));
  /** A fixed sequence of draws, so the order is the case's. */
  const draws = (...values: number[]): (() => number) => {
    let at = 0;
    return () => values[at++ % values.length] ?? 0;
  };

  it('shows EVERY tip once before any again, in a random order, and then starts a new round', () => {
    let shown: readonly string[] = [];
    const random = draws(0.99, 0, 0.5, 0);
    const order: string[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      const next = nextTip(tips, shown, random);
      if (next === undefined) throw new Error('a tip');
      order.push(next.tip.id);
      shown = next.shown;
    }
    // c (the last of three), then a (the first of the two left), then b, then a NEW round of one.
    expect(order).toStrictEqual(['c', 'a', 'b', 'a']);
    expect(shown).toStrictEqual(['a']);
  });

  it('carries a stored round, and drops an id that names no tip now rather than counting it', () => {
    const next = nextTip(tips, ['a', 'gone', 'b'], () => 0);
    expect(next?.tip.id).toBe('c');
    expect(next?.shown).toStrictEqual(['a', 'b', 'c']);
  });

  it('answers nothing for no tips', () => {
    expect(nextTip([], [], () => 0)).toBeUndefined();
  });
});
