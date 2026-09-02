import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SECTION_IDS, type Placement } from '../registries/placement.js';
import {
  ShortcutConflict,
  contextMenuModel,
  normaliseChord,
  paletteModel,
  quickToolbarModel,
  ribbonModel,
  shortcutMapOf,
  startScreenModel,
} from './projections.js';

const context: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
};

const ANY_TITLE = messageKey('command.any.label');

function command(id: string, placements: readonly Placement[], over: Partial<UiCommand> = {}): UiCommand {
  return { id, title: ANY_TITLE, placements, run: () => undefined, ...over };
}

const ids = (entries: readonly { readonly command: UiCommand }[]): string[] =>
  entries.map((entry) => entry.command.id);

describe('ribbonModel', () => {
  it('always yields the eight sections of §10.3, in rail order, even when empty', () => {
    // A section that vanished when its commands were unavailable would be a
    // layout that moves under the user, so this asserts the SEQUENCE rather
    // than a count — eight in the wrong order is also eight.
    const model = ribbonModel(new CommandRegistry([]), context);

    // THE LITERAL IS THE ANCHOR (finding DDDDD-3), and the line below it is
    // not. Comparing the model against `SECTION_IDS` compares a derived value
    // with the roster it derives from, so both sides move together: delete a
    // section and the ribbon silently stops rendering it while this agrees.
    // §7 says `SectionId` is EXACTLY the eight sections of §10.3, which is a
    // claim about a number, and 4c's danger here runs toward shrinkage — where
    // a derived count agrees with any shrink.
    expect(model.map((section) => section.section)).toStrictEqual([
      'home',
      'comment',
      'edit',
      'organize',
      'forms',
      'review',
      'protect',
      'tools',
    ]);
    // Kept as well, because it is the half that catches a REORDER: the rail's
    // order is the ribbon's, and the literal above would have to be edited to
    // notice one while this goes red on its own.
    expect(model.map((section) => section.section)).toStrictEqual([...SECTION_IDS]);
    expect(model.every((section) => section.groups.length === 0)).toBe(true);
  });

  it('groups a section by group name, ordering entries by `order` and then by id', () => {
    const registry = new CommandRegistry([
      command('edit.b', [{ surface: 'ribbon', section: 'edit', group: 'text', order: 2 }]),
      command('edit.a', [{ surface: 'ribbon', section: 'edit', group: 'text', order: 2 }]),
      command('edit.first', [{ surface: 'ribbon', section: 'edit', group: 'text', order: 1 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');

    // `edit.a` before `edit.b` is the TIE-BREAK, and it is the assertion that
    // separates this from registration order — they were registered b, a.
    expect(ids(edit?.groups[0]?.entries ?? [])).toStrictEqual(['edit.first', 'edit.a', 'edit.b']);
  });

  it('orders groups by their earliest member, not by name', () => {
    const registry = new CommandRegistry([
      command('edit.z', [{ surface: 'ribbon', section: 'edit', group: 'alpha', order: 9 }]),
      command('edit.y', [{ surface: 'ribbon', section: 'edit', group: 'omega', order: 1 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');

    // Alphabetically 'alpha' would come first, so a name-ordered projection
    // produces the opposite of this. That is what makes the case separate
    // anything.
    expect(edit?.groups.map((group) => group.group)).toStrictEqual(['omega', 'alpha']);
  });

  it('takes only ribbon placements, and one command may hold several', () => {
    const highlight = command('comment.highlight', [
      { surface: 'ribbon', section: 'home', group: 'quick tools', order: 1 },
      { surface: 'ribbon', section: 'comment', group: 'markup', order: 1 },
      { surface: 'context-menu', context: 'annotation', order: 1 },
    ]);
    const model = ribbonModel(new CommandRegistry([highlight]), context);

    // §7's own example. The third placement must NOT appear on the ribbon, and
    // asserting only the two that do would pass for a projection that ignored
    // `surface` entirely — so the sections without it are asserted too.
    expect(ids(model.find((s) => s.section === 'home')?.groups[0]?.entries ?? [])).toStrictEqual([
      'comment.highlight',
    ]);
    expect(ids(model.find((s) => s.section === 'comment')?.groups[0]?.entries ?? [])).toStrictEqual([
      'comment.highlight',
    ]);
    expect(model.filter((s) => s.groups.length > 0)).toHaveLength(2);
  });

  it('omits a command whose `when` is false', () => {
    const registry = new CommandRegistry([
      command('edit.hidden', [{ surface: 'ribbon', section: 'edit', group: 'text', order: 1 }], {
        when: () => false,
      }),
      command('edit.shown', [{ surface: 'ribbon', section: 'edit', group: 'text', order: 2 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');
    expect(ids(edit?.groups[0]?.entries ?? [])).toStrictEqual(['edit.shown']);
  });
});

describe('the other placement surfaces', () => {
  const everywhere = [
    command('a.quick', [{ surface: 'quick-toolbar', order: 2 }]),
    command('a.quick-first', [{ surface: 'quick-toolbar', order: 1 }]),
    command('a.page', [{ surface: 'context-menu', context: 'page', order: 1 }]),
    command('a.annotation', [{ surface: 'context-menu', context: 'annotation', order: 1 }]),
    command('a.start', [{ surface: 'start-screen', order: 1 }]),
    command('a.ribbon', [{ surface: 'ribbon', section: 'home', group: 'g', order: 1 }]),
  ];
  const registry = new CommandRegistry(everywhere);

  it('the quick toolbar takes its own placements only, in order', () => {
    expect(ids(quickToolbarModel(registry, context))).toStrictEqual(['a.quick-first', 'a.quick']);
  });

  it('a context menu takes only the commands placed in THAT context', () => {
    // The control is the second line. A `contextMenuModel` that ignored
    // `placement.context` would return both entries for either menu, and the
    // first line alone cannot tell that apart from correct behaviour.
    expect(ids(contextMenuModel(registry, context, 'page'))).toStrictEqual(['a.page']);
    expect(ids(contextMenuModel(registry, context, 'annotation'))).toStrictEqual(['a.annotation']);
    expect(contextMenuModel(registry, context, 'tab')).toStrictEqual([]);
  });

  it('the start screen takes its own placements only', () => {
    expect(ids(startScreenModel(registry, context))).toStrictEqual(['a.start']);
  });
});

describe('paletteModel', () => {
  it('holds a command with NO placements, which is what makes a hidden surface restorable', () => {
    // §7: chrome visibility is itself commanded, so the palette must show
    // commands that appear nowhere else. A palette derived from placements —
    // the obvious implementation — would return nothing here.
    const registry = new CommandRegistry([
      command('view.toggle-quick-toolbar', []),
      command('edit.rotate', [{ surface: 'ribbon', section: 'edit', group: 'page', order: 1 }]),
    ]);

    expect(paletteModel(registry, context).map((c) => c.id)).toStrictEqual([
      'edit.rotate',
      'view.toggle-quick-toolbar',
    ]);
  });

  it('still respects `when`, because an absent command is absent everywhere', () => {
    const registry = new CommandRegistry([
      command('edit.hidden', [], { when: () => false }),
      command('edit.shown', []),
    ]);
    expect(paletteModel(registry, context).map((c) => c.id)).toStrictEqual(['edit.shown']);
  });
});

describe('shortcutMapOf', () => {
  it('refuses two commands claiming one chord', () => {
    const registry = new CommandRegistry([
      command('a.one', [], { shortcut: 'Ctrl+S' }),
      command('a.two', [], { shortcut: 'Ctrl+S' }),
    ]);
    expect(() => shortcutMapOf(registry)).toThrow(ShortcutConflict);
  });

  it('collides two SPELLINGS of one chord, which is the collision that hides', () => {
    // Two spellings look like two chords to a map that does not normalise, so
    // this is the case that separates normalisation from a plain `Map` — the
    // case above passes either way.
    const registry = new CommandRegistry([
      command('a.one', [], { shortcut: 'Ctrl+Shift+P' }),
      command('a.two', [], { shortcut: 'shift+ctrl+p' }),
    ]);
    expect(() => shortcutMapOf(registry)).toThrow(ShortcutConflict);
  });

  it('CONTROL: two genuinely different chords coexist', () => {
    // Without this, "refuses a conflict" is satisfied by a function that
    // refuses any two shortcuts at all, and the application would have one.
    const registry = new CommandRegistry([
      command('a.one', [], { shortcut: 'Ctrl+S' }),
      command('a.two', [], { shortcut: 'Ctrl+O' }),
    ]);
    expect([...shortcutMapOf(registry).keys()].sort()).toStrictEqual(['ctrl+o', 'ctrl+s']);
  });

  it('is built over ALL commands, so a chord cannot change meaning with state', () => {
    // The stated design, and the assertion is the CONFLICT rather than the map's
    // contents: a version that filtered by `when` would build a perfectly good
    // one-entry map here and ship the collision.
    const registry = new CommandRegistry([
      command('a.one', [], { shortcut: 'Ctrl+S' }),
      command('a.two', [], { shortcut: 'Ctrl+S', when: () => false }),
    ]);
    expect(() => shortcutMapOf(registry)).toThrow(ShortcutConflict);
  });

  it('leaves a command with no shortcut out of the map entirely', () => {
    const registry = new CommandRegistry([command('a.one', []), command('a.two', [], { shortcut: 'Ctrl+S' })]);
    expect(shortcutMapOf(registry).size).toBe(1);
  });
});

describe('ONE registration, and every surface follows it', () => {
  /**
   * §7's whole claim, asserted as a change rather than as a state.
   *
   * Each projection has its own cases above, and every one of them reads a
   * registry somebody wrote for that projection. That proves each surface can
   * project; it does not prove the surfaces share a source, because a build in
   * which the toolbar read a hand-maintained layout would satisfy all of them —
   * the toolbar test would simply be reading the second wiring place.
   *
   * What separates the two is **moving one registration and watching more than
   * one surface move together**. So this changes a single command's `shortcut`
   * and its `placements` at once, and asserts the chord map, the toolbar and the
   * palette all describe the new registration and none the old.
   */
  const before = new CommandRegistry([
    command('a.mover', [{ surface: 'quick-toolbar', order: 10 }], { shortcut: 'Ctrl+M' }),
    command('a.fixed', [{ surface: 'quick-toolbar', order: 20 }], { shortcut: 'Ctrl+F' }),
  ]);
  const after = new CommandRegistry([
    command('a.mover', [{ surface: 'start-screen', order: 1 }], { shortcut: 'Ctrl+Shift+M' }),
    command('a.fixed', [{ surface: 'quick-toolbar', order: 20 }], { shortcut: 'Ctrl+F' }),
  ]);

  it('the CHORD moves with the registration, and the old one stops resolving', () => {
    expect(shortcutMapOf(before).get('ctrl+m')?.id).toBe('a.mover');
    expect(shortcutMapOf(after).get('ctrl+m')).toBeUndefined();
    expect(shortcutMapOf(after).get('ctrl+shift+m')?.id).toBe('a.mover');
  });

  it('...and the TOOLBAR loses it in the same edit, while its neighbour is untouched', () => {
    // The neighbour is what makes this a move rather than a registry that
    // emptied: a projection reading the wrong registry, or one that returned
    // nothing, would satisfy "a.mover is gone" perfectly.
    expect(ids(quickToolbarModel(before, context))).toStrictEqual(['a.mover', 'a.fixed']);
    expect(ids(quickToolbarModel(after, context))).toStrictEqual(['a.fixed']);
  });

  it('...and the START SCREEN gains it, so the placement went somewhere', () => {
    // Without this the pair above is satisfied by deleting the placement. The
    // claim is that ONE declaration feeds every surface, so the command has to
    // arrive where it was re-declared.
    expect(ids(startScreenModel(before, context))).toStrictEqual([]);
    expect(ids(startScreenModel(after, context))).toStrictEqual(['a.mover']);
  });

  it('...and the PALETTE carries both throughout, because it is placement-blind', () => {
    // The palette lists every available command rather than a placed set, so it
    // is the surface that must NOT move — a projection that changed here would
    // mean placement had leaked into a model that does not read it.
    // `paletteModel` answers commands rather than placed entries, which is the
    // shape difference `ids` above cannot read — and is itself the point: a
    // palette entry has no placement to carry.
    const listed = (registry: CommandRegistry): string[] =>
      paletteModel(registry, context).map((entry) => entry.id);

    expect(listed(before)).toStrictEqual(['a.fixed', 'a.mover']);
    expect(listed(after)).toStrictEqual(['a.fixed', 'a.mover']);
  });
});

describe('normaliseChord', () => {
  it('fixes modifier order, case and spacing so one chord has one spelling', () => {
    expect(normaliseChord('Shift + Ctrl + P')).toBe('ctrl+shift+p');
    expect(normaliseChord('ctrl+shift+p')).toBe('ctrl+shift+p');
    expect(normaliseChord('Meta+Alt+K')).toBe('alt+meta+k');
  });

  it('CONTROL: it does not collapse chords that differ', () => {
    // A normaliser that dropped modifiers would satisfy every line above.
    expect(normaliseChord('Ctrl+P')).not.toBe(normaliseChord('Ctrl+Shift+P'));
    expect(normaliseChord('Ctrl+P')).not.toBe(normaliseChord('Alt+P'));
  });
});
