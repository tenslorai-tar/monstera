import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { chordOf, dispatchChord, shortcutsFor, type KeyChord } from './shortcuts.js';

const ANY_TITLE = messageKey('command.any.label');

const context: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

function command(id: string, over: Partial<UiCommand> = {}): UiCommand {
  return { id, title: ANY_TITLE, placements: [], run: () => undefined, ...over };
}

function press(key: string, held: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...held };
}

describe('chordOf', () => {
  it('spells an event the way a declared shortcut is spelt', () => {
    // The two spellings coming from one function is the whole design: a lookup
    // that normalised the declaration one way and the event another would miss
    // every chord and report nothing — which looks exactly like a user who has
    // not pressed anything.
    expect(chordOf(press('S', { ctrlKey: true }))).toBe('ctrl+s');
    expect(chordOf(press('p', { ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+p');
  });

  it('does not spell a modifier twice when the modifier itself is the key', () => {
    // `Control` arrives as the key AND sets ctrlKey, so a naive join spells
    // `ctrl+control` — which matches nothing, and would swallow the modifier
    // press that begins every chord.
    expect(chordOf(press('Control', { ctrlKey: true }))).toBe('ctrl');
    expect(chordOf(press('Shift', { shiftKey: true }))).toBe('shift');
  });
});

describe('dispatchChord', () => {
  it('runs the command a chord names, and says which', () => {
    const ran: string[] = [];
    const registry = new CommandRegistry([
      command('file.save', {
        shortcut: 'Ctrl+S',
        run: () => {
          ran.push('file.save');
        },
      }),
    ]);
    const map = shortcutsFor(registry);

    const result = dispatchChord(registry, map, press('s', { ctrlKey: true }), context);

    // Both halves. The return value is what a caller uses to decide about
    // `preventDefault`, and `ran` is what proves the command was not merely
    // looked up — a dispatcher that found the command and forgot to call it
    // would satisfy the first assertion alone.
    expect(result).toStrictEqual({ kind: 'ran', command: registry.get('file.save') });
    expect(ran).toStrictEqual(['file.save']);
  });

  it('leaves a chord UNCLAIMED when its command does not exist in this context', () => {
    // The load-bearing case. `when` is applied here rather than when the map is
    // built, so an absent command's chord belongs to whoever would otherwise
    // receive it. A dispatcher that swallowed it would make the application eat
    // a browser shortcut to run nothing.
    const ran: string[] = [];
    const registry = new CommandRegistry([
      command('edit.paste', {
        shortcut: 'Ctrl+V',
        when: (ctx) => ctx.docId !== undefined,
        run: () => {
          ran.push('edit.paste');
        },
      }),
    ]);
    const map = shortcutsFor(registry);

    expect(dispatchChord(registry, map, press('v', { ctrlKey: true }), context)).toStrictEqual({
      kind: 'unclaimed',
    });
    expect(ran).toStrictEqual([]);
  });

  it('CONTROL: the same chord IS claimed once the context satisfies `when`', () => {
    // Without this, "unclaimed" is satisfied by a dispatcher that claims
    // nothing at all — and every shortcut in the application would be dead
    // while this file stayed green.
    const ran: string[] = [];
    const registry = new CommandRegistry([
      command('edit.paste', {
        shortcut: 'Ctrl+V',
        when: (ctx) => ctx.docId !== undefined,
        run: () => {
          ran.push('edit.paste');
        },
      }),
    ]);
    const map = shortcutsFor(registry);
    const withDocument = { ...context, docId: '00000000-0000-4000-8000-000000000001' as never };

    expect(dispatchChord(registry, map, press('v', { ctrlKey: true }), withDocument).kind).toBe(
      'ran',
    );
    expect(ran).toStrictEqual(['edit.paste']);
  });

  it('leaves a chord nobody declared unclaimed', () => {
    const registry = new CommandRegistry([command('file.save', { shortcut: 'Ctrl+S' })]);
    expect(
      dispatchChord(registry, shortcutsFor(registry), press('q', { ctrlKey: true }), context).kind,
    ).toBe('unclaimed');
  });

  it('matches a chord however the command spelt it', () => {
    // The declaration is `Shift+Ctrl+P` and the event arrives ctrl-then-shift.
    // A map keyed on the raw string would miss it, and the miss is silent.
    const ran: string[] = [];
    const registry = new CommandRegistry([
      command('view.palette', {
        shortcut: 'Shift+Ctrl+P',
        run: () => {
          ran.push('view.palette');
        },
      }),
    ]);
    dispatchChord(
      registry,
      shortcutsFor(registry),
      press('P', { ctrlKey: true, shiftKey: true }),
      context,
    );
    expect(ran).toStrictEqual(['view.palette']);
  });

  it('does not await `run`, so a slow command cannot hold the key handler', () => {
    // A dispatcher that awaited would return a promise and the caller could not
    // decide about `preventDefault` synchronously. Asserted as the RETURN being
    // a plain result while the command is still pending, which is the only
    // observable difference.
    let settle = (): void => undefined;
    const registry = new CommandRegistry([
      command('slow.thing', {
        shortcut: 'Ctrl+K',
        run: () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      }),
    ]);

    const result = dispatchChord(
      registry,
      shortcutsFor(registry),
      press('k', { ctrlKey: true }),
      context,
    );
    expect(result.kind).toBe('ran');
    settle();
  });
});
