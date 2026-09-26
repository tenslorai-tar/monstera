import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SECTION_IDS, type Placement } from '../registries/placement.js';
import {
  MENU_BAR_SECTIONS,
  ShortcutConflict,
  contextMenuModel,
  menuBarModel,
  normaliseChord,
  paletteModel,
  quickToolbarModel,
  railModel,
  ribbonModel,
  shortcutListModel,
  shortcutMapOf,
  startScreenModel,
  statusBarModel,
} from './projections.js';

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const ANY_TITLE = messageKey('command.any.label');

function command(id: string, placements: readonly Placement[], over: Partial<UiCommand> = {}): UiCommand {
  // AN ICON BY DEFAULT, because the registry refuses a command drawn on a surface
  // without one; these cases are about ordering, not about glyphs.
  return { id, title: ANY_TITLE, icon: 'File', placements, run: () => undefined, ...over };
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
    // THE OWNER'S v5 ORDER since ADR-0105 (M3's Home, Comment, Edit, Organize… until 2026-09-26).
    expect(model.map((section) => section.section)).toStrictEqual([
      'home',
      'organize',
      'edit',
      'comment',
      'forms',
      'protect',
      'review',
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
      command('edit.b', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.text'), order: 2 }]),
      command('edit.a', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.text'), order: 2 }]),
      command('edit.first', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.text'), order: 1 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');

    // `edit.a` before `edit.b` is the TIE-BREAK, and it is the assertion that
    // separates this from registration order — they were registered b, a.
    expect(ids(edit?.groups[0]?.entries ?? [])).toStrictEqual(['edit.first', 'edit.a', 'edit.b']);
  });

  it('orders groups by their earliest member, not by name', () => {
    const registry = new CommandRegistry([
      command('edit.z', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.alpha'), order: 9 }]),
      command('edit.y', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.omega'), order: 1 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');

    // Alphabetically 'alpha' would come first, so a name-ordered projection
    // produces the opposite of this. That is what makes the case separate
    // anything.
    expect(edit?.groups.map((group) => group.group)).toStrictEqual([
      messageKey('group.omega'),
      messageKey('group.alpha'),
    ]);
  });

  it('takes only ribbon placements, and one command may hold several', () => {
    const highlight = command('comment.highlight', [
      { surface: 'ribbon', section: 'home', group: messageKey('group.quick-tools'), order: 1 },
      { surface: 'ribbon', section: 'comment', group: messageKey('group.markup'), order: 1 },
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
      command('edit.hidden', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.text'), order: 1 }], {
        when: () => false,
      }),
      command('edit.shown', [{ surface: 'ribbon', section: 'edit', group: messageKey('group.text'), order: 2 }]),
    ]);

    const edit = ribbonModel(registry, context).find((section) => section.section === 'edit');
    expect(ids(edit?.groups[0]?.entries ?? [])).toStrictEqual(['edit.shown']);
  });
});

describe('secondary placements and the rail (ADR-0098)', () => {
  // IN TOOLS, which is a menu: a fixture in Home alone would need a menu-bar placement too (ADR-0107's correction),
  // and these cases are about prominence, not about Home.
  const FILE = messageKey('test.group.file');

  it('carries PROMINENCE through: absent is primary, secondary is marked', () => {
    const registry = new CommandRegistry([
      command('doc.open', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 1 }]),
      command('doc.pdfa', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 2, prominence: 'secondary' }]),
    ]);
    const entries = ribbonModel(registry, context).find((section) => section.section === 'tools')?.groups[0]?.entries;
    expect(entries?.map((entry) => [entry.command.id, entry.secondary])).toStrictEqual([
      ['doc.open', false],
      ['doc.pdfa', true],
    ]);
  });

  it('a group whose primaries `when` hides draws its FIRST remaining tool, never a lone More', () => {
    const registry = new CommandRegistry([
      command('doc.open', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 1 }], { when: () => false }),
      command('doc.save-copy', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 2, prominence: 'secondary' }]),
      command('doc.pdfa', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 3, prominence: 'secondary' }]),
    ]);
    const entries = ribbonModel(registry, context).find((section) => section.section === 'tools')?.groups[0]?.entries;
    expect(entries?.map((entry) => [entry.command.id, entry.secondary])).toStrictEqual([
      ['doc.save-copy', false],
      ['doc.pdfa', true],
    ]);
  });

  it('the REGISTRY refuses a group whose placements are all secondary, naming it', () => {
    expect(
      () =>
        new CommandRegistry([
          command('doc.pdfa', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 1, prominence: 'secondary' }]),
        ]),
    ).toThrow(/tools › test\.group\.file holds only secondary tools/u);
    // CONTROL: the same group with one primary beside it is accepted.
    expect(
      () =>
        new CommandRegistry([
          command('doc.open', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 0 }]),
          command('doc.pdfa', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 1, prominence: 'secondary' }]),
        ]),
    ).not.toThrow();
  });

  it('the RAIL projects its own placements in order, and nothing else', () => {
    const registry = new CommandRegistry([
      command('app.about', [{ surface: 'rail', order: 20 }]),
      command('app.settings', [{ surface: 'rail', order: 10 }]),
      command('doc.open', [{ surface: 'ribbon', section: 'tools', group: FILE, order: 1 }]),
    ]);
    expect(ids(railModel(registry, context))).toStrictEqual(['app.settings', 'app.about']);
  });

  it('the registry refuses a RAIL command with no icon, since the rail draws a glyph', () => {
    // BUILT WITHOUT THE HELPER, which supplies an icon by default.
    const bare: UiCommand = { id: 'app.settings', title: ANY_TITLE, placements: [{ surface: 'rail', order: 1 }], run: () => undefined };
    expect(() => new CommandRegistry([bare])).toThrow(/placed on the rail and names no icon/u);
  });
});

describe('the other placement surfaces', () => {
  const everywhere = [
    command('a.quick', [{ surface: 'quick-toolbar', order: 2 }]),
    command('a.quick-first', [{ surface: 'quick-toolbar', order: 1 }]),
    command('a.page', [{ surface: 'context-menu', context: 'page', order: 1 }]),
    command('a.annotation', [{ surface: 'context-menu', context: 'annotation', order: 1 }]),
    // THE START SCREEN'S THREE SLOTS (ADR-0068), each holding something, the shortcuts registered out of order.
    command('a.start-footer', [{ surface: 'start-screen', slot: 'footer', order: 1 }]),
    command('a.start-shortcut-2', [{ surface: 'start-screen', slot: 'shortcut', order: 2 }]),
    command('a.start-shortcut-1', [{ surface: 'start-screen', slot: 'shortcut', order: 1 }]),
    command('a.start-primary', [{ surface: 'start-screen', slot: 'primary', order: 1 }]),
    command('a.ribbon', [
      { surface: 'ribbon', section: 'home', group: messageKey('group.g'), order: 1 },
      // A HOME TOOL IS IN SOME MENU, which the registry requires (ADR-0107's correction).
      { surface: 'menu-bar', menu: 'file', group: 0, order: 1 },
    ]),
    // THE STATUS BAR'S FOUR SLOTS, each holding something, and registered OUT of order so the
    // projection has to sort. Every other case in this block names its exact ids, so a status-bar
    // command leaking onto another surface turns that case red too.
    command('a.nav-after', [{ surface: 'status-bar', cluster: 'navigation', side: 'after', order: 1 }]),
    command('a.nav-before-2', [{ surface: 'status-bar', cluster: 'navigation', side: 'before', order: 2 }]),
    command('a.nav-before-1', [{ surface: 'status-bar', cluster: 'navigation', side: 'before', order: 1 }]),
    command('a.zoom-before', [{ surface: 'status-bar', cluster: 'zoom', side: 'before', order: 1 }]),
    command('a.zoom-between', [{ surface: 'status-bar', cluster: 'zoom', side: 'between', order: 1 }]),
    command('a.zoom-after', [{ surface: 'status-bar', cluster: 'zoom', side: 'after', order: 1 }]),
    command('a.chrome', [{ surface: 'status-bar', cluster: 'chrome', order: 1 }]),
  ];
  const registry = new CommandRegistry(everywhere);

  it('the status bar sorts each command into its CLUSTER and SIDE, in order, and takes nothing else', () => {
    const model = statusBarModel(registry, context);
    // All four slots are asserted, because a projection that ignored `side` would put both
    // navigation commands in one list and pass a check of that list alone.
    expect(ids(model.navigation.before)).toStrictEqual(['a.nav-before-1', 'a.nav-before-2']);
    expect(ids(model.navigation.after)).toStrictEqual(['a.nav-after']);
    expect(ids(model.zoom.before)).toStrictEqual(['a.zoom-before']);
    expect(ids(model.zoom.between)).toStrictEqual(['a.zoom-between']);
    expect(ids(model.zoom.after)).toStrictEqual(['a.zoom-after']);
    expect(ids(model.chrome)).toStrictEqual(['a.chrome']);
  });

  it('a status-bar gap that does not exist cannot be SPELT (ADR-0067, corrected 2026-09-15)', () => {
    // Compile-time cases, and `npm run typecheck` is what runs them: an unused `@ts-expect-error` is
    // itself an error, so a type that started accepting either line reddens the build.
    const gaps: Placement[] = [
      // @ts-expect-error — the page field is one control, so navigation has no `between`.
      { surface: 'status-bar', cluster: 'navigation', side: 'between', order: 1 },
      // @ts-expect-error — the chrome cluster has no control of the bar's own, so no `side`.
      { surface: 'status-bar', cluster: 'chrome', side: 'after', order: 1 },
    ];
    expect(gaps).toHaveLength(2);
  });

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

  it('the start screen sorts each command into its SLOT, in order, and takes nothing else (ADR-0068)', () => {
    const model = startScreenModel(registry, context);
    // All three slots are asserted, because a projection that ignored `slot` would put every command in one list and
    // pass a check of any one of them.
    expect(ids(model.primary)).toStrictEqual(['a.start-primary']);
    expect(ids(model.shortcut)).toStrictEqual(['a.start-shortcut-1', 'a.start-shortcut-2']);
    expect(ids(model.footer)).toStrictEqual(['a.start-footer']);
  });

  it('a start-screen placement cannot be written WITHOUT a slot', () => {
    // Compile-time, run by `npm run typecheck`: an unused `@ts-expect-error` is itself an error, so a type that made
    // the slot optional again reddens the build.
    const unslotted: Placement[] = [
      // @ts-expect-error — the screen has three places, and a placement must say which.
      { surface: 'start-screen', order: 1 },
    ];
    expect(unslotted).toHaveLength(1);
  });
});

describe('shortcutListModel', () => {
  it('lists every BOUND chord with its command’s title, in chord order — including a command unavailable right now', () => {
    const OPEN = messageKey('command.open-test.title');
    const HIDDEN = messageKey('command.hidden-test.title');
    const registry = new CommandRegistry([
      // REGISTERED OUT OF ORDER, and one command hidden by `when`: the list is the map's, and the map is built over all
      // commands, so a chord that works only with a document open is still a chord a person should be able to look up.
      command('a.zeta', [], { shortcut: 'Ctrl+Z', title: HIDDEN, when: () => false }),
      command('a.alpha', [], { shortcut: 'Alt+A', title: OPEN }),
      // THE CONTROL: a command with no chord has no row.
      command('a.unbound', []),
    ]);

    expect(shortcutListModel(registry)).toStrictEqual([
      { chord: 'Alt+A', title: OPEN },
      { chord: 'Ctrl+Z', title: HIDDEN },
    ]);
  });
});

describe('paletteModel', () => {
  it('holds a command with NO placements, which is what makes a hidden surface restorable', () => {
    // §7: chrome visibility is itself commanded, so the palette must show
    // commands that appear nowhere else. A palette derived from placements —
    // the obvious implementation — would return nothing here.
    const registry = new CommandRegistry([
      command('view.toggle-quick-toolbar', []),
      command('edit.rotate', [
        { surface: 'ribbon', section: 'edit', group: messageKey('group.page'), order: 1 },
      ]),
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
    command('a.mover', [{ surface: 'start-screen', slot: 'footer', order: 1 }], { shortcut: 'Ctrl+Shift+M' }),
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
    expect(ids(startScreenModel(before, context).footer)).toStrictEqual([]);
    expect(ids(startScreenModel(after, context).footer)).toStrictEqual(['a.mover']);
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

describe('menuBarModel (ADR-0107)', () => {
  const MARKUP = messageKey('test.group.markup');
  const EXPORT = messageKey('test.group.export');
  const ZOOM = messageKey('test.menu.zoom');
  const menuOf = (registry: CommandRegistry, id: string, at: CommandContext = context) =>
    menuBarModel(registry, at).find((menu) => menu.id === id);
  const itemIds = (menu: ReturnType<typeof menuOf>): string[][] =>
    (menu?.groups ?? []).map((group) => group.items.map((item) => item.command.id));

  it('draws the menus in v5-14’s order — never Home — and drops a menu with nothing in it', () => {
    // THE LITERAL IS THE ANCHOR: the section menus are the prototype's order, which is not the rail's.
    expect(MENU_BAR_SECTIONS).toStrictEqual(['organize', 'comment', 'forms', 'review', 'protect', 'tools']);
    const registry = new CommandRegistry([
      command('a.help', [{ surface: 'menu-bar', menu: 'help', group: 0, order: 1 }]),
      command('a.file', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }]),
      command('a.tools', [{ surface: 'ribbon', section: 'tools', group: MARKUP, order: 1 }]),
      command('a.comment', [{ surface: 'ribbon', section: 'comment', group: MARKUP, order: 1 }]),
      command('a.home', [
        { surface: 'ribbon', section: 'home', group: MARKUP, order: 1 },
        { surface: 'menu-bar', menu: 'view', group: 0, order: 1 },
      ]),
    ]);
    expect(menuBarModel(registry, context).map((menu) => menu.id)).toStrictEqual([
      'file',
      'view',
      'comment',
      'tools',
      'help',
    ]);
  });

  it('a SECTION menu is its ribbon section — secondaries and a named menu’s members included — in the ribbon’s order', () => {
    const registry = new CommandRegistry([
      command('b.second', [{ surface: 'ribbon', section: 'forms', group: EXPORT, order: 2, menu: EXPORT }]),
      command('b.first', [{ surface: 'ribbon', section: 'forms', group: EXPORT, order: 1, menu: EXPORT }]),
      command('a.mark', [{ surface: 'ribbon', section: 'forms', group: MARKUP, order: 0 }]),
      command('a.more', [{ surface: 'ribbon', section: 'forms', group: MARKUP, order: 5, prominence: 'secondary' }]),
    ]);
    const forms = menuOf(registry, 'forms');
    expect(forms?.groups.map((group) => group.caption)).toStrictEqual([MARKUP, EXPORT]);
    expect(itemIds(forms)).toStrictEqual([['a.mark', 'a.more'], ['b.first', 'b.second']]);
  });

  it('Edit is its application groups FIRST, then the Edit section’s', () => {
    const registry = new CommandRegistry([
      command('e.section', [{ surface: 'ribbon', section: 'edit', group: MARKUP, order: 0 }]),
      command('e.redo', [{ surface: 'menu-bar', menu: 'edit', group: 0, order: 20 }]),
      command('e.cut', [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 10 }]),
      command('e.undo', [{ surface: 'menu-bar', menu: 'edit', group: 0, order: 10 }]),
    ]);
    expect(itemIds(menuOf(registry, 'edit'))).toStrictEqual([['e.undo', 'e.redo'], ['e.cut'], ['e.section']]);
  });

  it('an application group takes its CAPTION from its placements, and a group without one has none', () => {
    const registry = new CommandRegistry([
      command('v.out', [{ surface: 'menu-bar', menu: 'view', group: 2, order: 2, caption: ZOOM }]),
      command('v.in', [{ surface: 'menu-bar', menu: 'view', group: 2, order: 1, caption: ZOOM }]),
      command('v.hand', [{ surface: 'menu-bar', menu: 'view', group: 4, order: 1 }]),
    ]);
    const view = menuOf(registry, 'view');
    expect(view?.groups.map((group) => group.caption)).toStrictEqual([ZOOM, undefined]);
    expect(itemIds(view)).toStrictEqual([['v.in', 'v.out'], ['v.hand']]);
  });

  it('lists EVERY command and DISABLES one whose `when` is false, where the ribbon hides it', () => {
    const registry = new CommandRegistry([
      command('f.can', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }]),
      command('f.cannot', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 2 }], { when: () => false }),
      command('t.cannot', [{ surface: 'ribbon', section: 'tools', group: MARKUP, order: 1 }], { when: () => false }),
    ]);
    expect(menuOf(registry, 'file')?.groups[0]?.items.map((item) => [item.command.id, item.enabled])).toStrictEqual([
      ['f.can', true],
      ['f.cannot', false],
    ]);
    // A SECTION MENU OVER A HIDDEN TOOL still lists it, disabled — and the ribbon, the control, does not draw it.
    expect(menuOf(registry, 'tools')?.groups[0]?.items.map((item) => item.enabled)).toStrictEqual([false]);
    expect(ribbonModel(registry, context).find((section) => section.section === 'tools')?.groups).toStrictEqual([]);
  });

  it('carries `checked` from the command in this context, and `undefined` for one that sets no state', () => {
    let on = false;
    const registry = new CommandRegistry([
      command('v.toggle', [{ surface: 'menu-bar', menu: 'view', group: 0, order: 1 }], { checked: () => on }),
      command('v.plain', [{ surface: 'menu-bar', menu: 'view', group: 0, order: 2 }]),
    ]);
    const checks = (): (boolean | undefined)[] => menuOf(registry, 'view')?.groups[0]?.items.map((item) => item.checked) ?? [];
    expect(checks()).toStrictEqual([false, undefined]);
    on = true;
    expect(checks()).toStrictEqual([true, undefined]);
  });
});

describe('the registry’s menu-bar rules (ADR-0107 and its correction)', () => {
  const GROUP = messageKey('test.group.g');

  it('REFUSES a command on the Home ribbon alone, naming it — Home is not a menu', () => {
    expect(() => new CommandRegistry([command('h.only', [{ surface: 'ribbon', section: 'home', group: GROUP, order: 1 }])])).toThrow(
      /"h\.only" is on the Home ribbon and in no menu/u,
    );
  });

  it('CONTROL: accepts the same command with a menu-bar placement, or with a place in a section that is a menu', () => {
    expect(
      () =>
        new CommandRegistry([
          command('h.menu', [
            { surface: 'ribbon', section: 'home', group: GROUP, order: 1 },
            { surface: 'menu-bar', menu: 'file', group: 0, order: 1 },
          ]),
          command('h.also', [
            { surface: 'ribbon', section: 'home', group: GROUP, order: 2 },
            { surface: 'ribbon', section: 'tools', group: GROUP, order: 1 },
          ]),
        ]),
    ).not.toThrow();
  });

  it('REFUSES two captions for one application group, and CONTROL: accepts the same caption twice', () => {
    const first = messageKey('test.menu.one');
    const second = messageKey('test.menu.two');
    expect(
      () =>
        new CommandRegistry([
          command('c.a', [{ surface: 'menu-bar', menu: 'view', group: 1, order: 1, caption: first }]),
          command('c.b', [{ surface: 'menu-bar', menu: 'view', group: 1, order: 2, caption: second }]),
        ]),
    ).toThrow(/captions the menu group view #1/u);
    expect(
      () =>
        new CommandRegistry([
          command('c.a', [{ surface: 'menu-bar', menu: 'view', group: 1, order: 1, caption: first }]),
          command('c.b', [{ surface: 'menu-bar', menu: 'view', group: 1, order: 2, caption: first }]),
        ]),
    ).not.toThrow();
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
