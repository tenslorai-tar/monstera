import type { MessageKey } from '@monstera/shared';

import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import {
  SECTION_IDS,
  type MenuBarMenu,
  type MenuBarPlacement,
  type MenuContext,
  type Placement,
  type SectionId,
  type StartScreenSlot,
  type StatusBarPlacement,
  type TitleBarPlacement,
} from '../registries/placement.js';

/**
 * Every surface, derived from the command registry. **There is no second place
 * where a feature is wired.**
 *
 * These are data, not components: a projection decides *what appears and in what
 * order*, and a React tree decides how it looks. Splitting them here is what
 * lets the ordering rules be tested without a DOM, and it is why this module
 * lands in A7-core — the registries and their projections need no screen.
 *
 * ## Decision 4's exhaustiveness, and how to read it
 *
 * Each function below narrows on `placement.surface` and ends in a `never`
 * case. Adding a variant to {@link Placement} therefore **fails to compile in
 * every surface that has not handled it** — the cheapest available *you have
 * not finished* signal, and the one thing that makes "projection" a fact rather
 * than a convention.
 *
 * The `never` cases are not dead code and must not be deleted as such. They are
 * the mechanism.
 *
 * ## What exhaustiveness cannot see
 *
 * A surface that renders a hand-written list of ids BESIDE the projection type-
 * checks perfectly. `check:secondwiring` is the mechanism for that, and it
 * scans this directory — which is why the directory is named in the scan and
 * why creating `registries/commands.ts` without it is a refusal rather than a
 * pass.
 */

/**
 * Sorts by `order`, then by id.
 *
 * **The tie-break is load-bearing, not tidiness.** Two features that never see
 * each other's code will pick the same number, and without a second key the
 * result would depend on registration order — which Decision 1 spent its whole
 * argument making irrelevant. A projection that quietly depended on it would
 * put the argument back.
 */
function ordered<T extends { readonly order: number; readonly command: UiCommand }>(
  entries: readonly T[],
): readonly T[] {
  return [...entries].sort(
    (left, right) => left.order - right.order || left.command.id.localeCompare(right.command.id),
  );
}

/** One command's appearance on the ribbon. */
export interface RibbonEntry {
  readonly command: UiCommand;
  readonly order: number;
  /**
   * Drawn in the group's *More* at every width (ADR-0098). The registry refuses a group with no
   * primary at all; this is `false` for the first entry of a group whose primaries are all hidden by
   * `when`, so a group never draws as a caption over a lone *More*.
   */
  readonly secondary: boolean;
  /** The menu this entry is drawn under, or `undefined` for its own button (ADR-0101). */
  readonly menu: MessageKey | undefined;
}

/** One captioned group within a ribbon section. */
export interface RibbonGroup {
  readonly group: MessageKey;
  readonly entries: readonly RibbonEntry[];
}

/** One section's ribbon contents. */
export interface RibbonSection {
  readonly section: SectionId;
  readonly groups: readonly RibbonGroup[];
}

/**
 * The ribbon, as §10.3 describes it: the eight sections, each with captioned
 * groups.
 *
 * Sections come from {@link SECTION_IDS} rather than from the placements found,
 * because the rail shows all eight whether or not a section currently has
 * tools — a section that vanished when its commands were unavailable would be a
 * layout that moves under the user.
 *
 * Groups come from the placements, because a group with nothing in it has
 * nothing to caption.
 */
export function ribbonModel(
  registry: CommandRegistry,
  context: CommandContext,
): readonly RibbonSection[] {
  return sectionsOf(registry.available(context));
}

/** The sections' captioned groups over a set of commands: the available ones for the ribbon, all of them for a menu. */
function sectionsOf(commands: readonly UiCommand[]): readonly RibbonSection[] {
  const bySection = new Map<SectionId, Map<MessageKey, RibbonEntry[]>>();
  for (const section of SECTION_IDS) bySection.set(section, new Map());

  for (const command of commands) {
    for (const placement of command.placements) {
      const slot = ribbonSlot(placement);
      if (slot === undefined) continue;
      const groups = bySection.get(slot.section);
      // A `SectionId` the rail does not list is unrepresentable — the union is
      // the eight — so this cannot be reached, and is not defended against.
      if (groups === undefined) continue;
      const entries = groups.get(slot.group) ?? [];
      entries.push({ command, order: slot.order, secondary: slot.secondary, menu: slot.menu });
      groups.set(slot.group, entries);
    }
  }

  return SECTION_IDS.map((section) => ({
    section,
    groups: [...(bySection.get(section) ?? new Map<MessageKey, RibbonEntry[]>())]
      // Groups are ordered by their earliest member, so a feature controls where
      // its group sits by the same number that controls its buttons — rather
      // than by a second ordering nobody would know to set.
      .map(([group, entries]) => ({ group, entries: withAPrimary(ordered(entries)) }))
      .sort(
        (left, right) =>
          (left.entries[0]?.order ?? 0) - (right.entries[0]?.order ?? 0) ||
          left.group.localeCompare(right.group),
      ),
  }));
}

/**
 * A group's entries with at least one drawn as primary.
 *
 * The registry refuses a group whose placements are ALL secondary. What it cannot see is a group
 * whose primaries `when` hides in this context, and that would draw a caption over a lone *More*. So
 * the first remaining entry is drawn instead, which is the least surprising stand-in: it is the tool
 * the group's order already puts first.
 */
function withAPrimary(entries: readonly RibbonEntry[]): readonly RibbonEntry[] {
  if (entries.length === 0 || entries.some((entry) => !entry.secondary)) return entries;
  return entries.map((entry, index) => (index === 0 ? { ...entry, secondary: false } : entry));
}

/**
 * The commands at the rail's foot, below the eight sections (§10.3,
 * [ADR-0098](../../../../docs/DECISIONS/0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md)).
 */
export function railModel(registry: CommandRegistry, context: CommandContext): readonly OrderedEntry[] {
  const entries: OrderedEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const order = railOrder(placement);
      if (order !== undefined) entries.push({ command, order });
    }
  }
  return ordered(entries);
}

function railOrder(placement: Placement): number | undefined {
  switch (placement.surface) {
    case 'rail':
      return placement.order;
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * The commands at the foot of the Properties tab, drawn while marks are selected (§7,
 * [ADR-0102](../../../../docs/DECISIONS/0102-a-selection-survives-a-command-that-keeps-the-walk.md)).
 * `available` has already applied each command's `when`, so a foot never offers what the annotation
 * menu has hidden.
 */
export function propertiesModel(registry: CommandRegistry, context: CommandContext): readonly OrderedEntry[] {
  const entries: OrderedEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const order = propertiesOrder(placement);
      if (order !== undefined) entries.push({ command, order });
    }
  }
  return ordered(entries);
}

function propertiesOrder(placement: Placement): number | undefined {
  switch (placement.surface) {
    case 'properties':
      return placement.order;
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/** The ribbon's view of one placement, or `undefined` when it belongs elsewhere. */
function ribbonSlot(
  placement: Placement,
):
  | {
      readonly section: SectionId;
      readonly group: MessageKey;
      readonly order: number;
      readonly secondary: boolean;
      readonly menu: MessageKey | undefined;
    }
  | undefined {
  switch (placement.surface) {
    case 'ribbon':
      return {
        section: placement.section,
        group: placement.group,
        order: placement.order,
        secondary: placement.prominence === 'secondary',
        menu: placement.menu,
      };
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      // Decision 4. A new `Placement` variant lands here as a compile error, in
      // this surface and in every other, until somebody decides where it goes.
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/** One command on a projecting surface that carries no extra structure. */
export interface OrderedEntry {
  readonly command: UiCommand;
  readonly order: number;
}

/**
 * The floating quick toolbar — §10.3's vertical pill on the canvas edge.
 *
 * Its visibility is a command, `view.toggle-quick-toolbar` (§7), registered since
 * design pass F (2026-09-15) — which is what guarantees a hidden toolbar can be
 * restored from the palette, its chord and the status bar. *Corrected 2026-09-15:*
 * this said the command did not exist yet, which stopped being true when pass F
 * registered it.
 */
export function quickToolbarModel(
  registry: CommandRegistry,
  context: CommandContext,
): readonly OrderedEntry[] {
  const entries: OrderedEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const order = quickToolbarOrder(placement);
      if (order !== undefined) entries.push({ command, order });
    }
  }
  return ordered(entries);
}

function quickToolbarOrder(placement: Placement): number | undefined {
  switch (placement.surface) {
    case 'quick-toolbar':
      return placement.order;
    case 'ribbon':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * One context menu — §7's four contexts.
 *
 * The context is a parameter rather than part of `CommandContext`, because it
 * is a property of the gesture that opened the menu and not of the application
 * state. Putting it in the context object would make every `when` able to read
 * it, and a `when` that behaved differently per menu would be a command that
 * exists in one place and not another for reasons no surface could show.
 */
export function contextMenuModel(
  registry: CommandRegistry,
  context: CommandContext,
  menu: MenuContext,
): readonly OrderedEntry[] {
  const entries: OrderedEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const order = contextMenuOrder(placement, menu);
      if (order !== undefined) entries.push({ command, order });
    }
  }
  return ordered(entries);
}

function contextMenuOrder(placement: Placement, menu: MenuContext): number | undefined {
  switch (placement.surface) {
    case 'context-menu':
      return placement.context === menu ? placement.order : undefined;
    case 'ribbon':
    case 'quick-toolbar':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/** The start screen's three slots, each in its own order (ARCHITECTURE §7, ADR-0068). */
export interface StartScreenModel {
  readonly primary: readonly OrderedEntry[];
  readonly shortcut: readonly OrderedEntry[];
  readonly footer: readonly OrderedEntry[];
}

/**
 * The start screen's commands, by slot — §10.3's one primary button, its grid of six feature shortcuts *"each a real
 * entry point"*, and the footer.
 *
 * No slot is capped: a projection that refused a second primary button or a seventh shortcut would be the layout
 * deciding what the registry may contain, which is the direction this whole seam runs the other way.
 */
export function startScreenModel(registry: CommandRegistry, context: CommandContext): StartScreenModel {
  const slots: Record<StartScreenSlot, OrderedEntry[]> = { primary: [], shortcut: [], footer: [] };
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const at = startScreenSlot(placement);
      if (at !== undefined) slots[at.slot].push({ command, order: at.order });
    }
  }
  return { primary: ordered(slots.primary), shortcut: ordered(slots.shortcut), footer: ordered(slots.footer) };
}

function startScreenSlot(
  placement: Placement,
): { readonly slot: StartScreenSlot; readonly order: number } | undefined {
  switch (placement.surface) {
    case 'start-screen':
      return { slot: placement.slot, order: placement.order };
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * The status bar's projected buttons, by cluster and gap (§10.3, ARCHITECTURE §7, ADR-0067 and its
 * 2026-09-15 correction). Each list is one gap between the bar's own controls, so the shape here is
 * the placement type's, and a gap the type cannot spell has no list.
 */
export interface StatusBarModel {
  /** Around the page field. */
  readonly navigation: { readonly before: readonly OrderedEntry[]; readonly after: readonly OrderedEntry[] };
  /** Before the slider, between the slider and the percentage, and after the percentage. */
  readonly zoom: {
    readonly before: readonly OrderedEntry[];
    readonly between: readonly OrderedEntry[];
    readonly after: readonly OrderedEntry[];
  };
  /** The commands about the chrome itself, which have no control of the bar's own to sit around. */
  readonly chrome: readonly OrderedEntry[];
}

/** Every gap in the bar, as one key, so the projection fills one map rather than a nest of them. */
type StatusBarGap = 'navigation.before' | 'navigation.after' | 'zoom.before' | 'zoom.between' | 'zoom.after' | 'chrome';

/**
 * The status bar's buttons — §10.3's page navigation, zoom cluster and chrome toggles.
 *
 * **Only the buttons.** The page field, the zoom slider and the percentage are the bar's own —
 * the first two take a value, which a command's `run` cannot, and the third is a readout — so they
 * are not here. What this answers is which commands sit in each gap between them, in order, so no
 * command list is written into the bar.
 */
export function statusBarModel(registry: CommandRegistry, context: CommandContext): StatusBarModel {
  const gaps = new Map<StatusBarGap, OrderedEntry[]>();
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const slot = statusBarSlot(placement);
      if (slot === undefined) continue;
      const entries = gaps.get(slot.gap) ?? [];
      entries.push({ command, order: slot.order });
      gaps.set(slot.gap, entries);
    }
  }
  const at = (gap: StatusBarGap): readonly OrderedEntry[] => ordered(gaps.get(gap) ?? []);
  return {
    navigation: { before: at('navigation.before'), after: at('navigation.after') },
    zoom: { before: at('zoom.before'), between: at('zoom.between'), after: at('zoom.after') },
    chrome: at('chrome'),
  };
}

function statusBarSlot(placement: Placement): { readonly gap: StatusBarGap; readonly order: number } | undefined {
  switch (placement.surface) {
    case 'status-bar':
      return { gap: statusBarGap(placement), order: placement.order };
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'title-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * One title-bar button: the command, where it sits, and how the design draws it.
 *
 * `emphasis` is carried through from the placement rather than resolved here, because the bar renders
 * it and the projection's job is to say what is there — the same split every other model keeps.
 */
export interface TitleBarEntry extends OrderedEntry {
  readonly emphasis: TitleBarPlacement['emphasis'];
}

/**
 * The title bar's projected buttons — the owner's Donate and Rate Us (§10.3, ARCHITECTURE §7,
 * [ADR-0095](../../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)).
 *
 * **Only the buttons.** The document tabs, the command search and the layout switcher each hold a
 * value — the open set and the active tab, the query, the current mode — so none of them is a command
 * and none is here. That is the status bar's rule above, unchanged.
 */
export function titleBarModel(registry: CommandRegistry, context: CommandContext): readonly TitleBarEntry[] {
  const entries: TitleBarEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const slot = titleBarSlot(placement);
      if (slot !== undefined) entries.push({ command, order: slot.order, emphasis: slot.emphasis });
    }
  }
  return ordered(entries);
}

function titleBarSlot(placement: Placement): TitleBarPlacement | undefined {
  switch (placement.surface) {
    case 'title-bar':
      return placement;
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'rail':
    case 'properties':
    case 'menu-bar':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/** One menu item: its command, whether it can run in the context the bar was drawn in, and whether it is on. */
export interface MenuBarItem {
  readonly command: UiCommand;
  readonly enabled: boolean;
  /** `undefined` for a command that sets no state; otherwise its `checked` in this context. */
  readonly checked: boolean | undefined;
}

/** A run of items between separators, under its caption where it has one. */
export interface MenuBarGroup {
  readonly caption: MessageKey | undefined;
  readonly items: readonly MenuBarItem[];
}

/** One menu on the bar: an application menu, or a ribbon section's. */
export interface MenuBarMenuModel {
  /** An application menu, or one of the sections that is a menu — never Home, which is not. */
  readonly id: MenuBarMenu | (typeof MENU_BAR_SECTIONS)[number];
  readonly groups: readonly MenuBarGroup[];
}

/**
 * The section menus, in v5-14's order, which is the prototype's and not the rail's (ADR-0107). Home is not a menu: its
 * tools are placed on the application menus.
 */
export const MENU_BAR_SECTIONS = ['organize', 'comment', 'forms', 'review', 'protect', 'tools'] as const satisfies readonly SectionId[];

/**
 * THE MENU BAR (§7, §10.3, [ADR-0107](../../../../docs/DECISIONS/0107-the-menu-bar-is-a-projection.md)): *File · Edit ·
 * View · Organize · Comment · Forms · Review · Protect · Tools · Window · Help*.
 *
 * A section's menu IS its ribbon section — every tool in it, primary, secondary and a named menu's members — so a tool
 * registered into a ribbon group is in the matching menu with no second placement. The application menus come from
 * `menu-bar` placements. Edit is both: its application groups first, then the Edit section's.
 *
 * **Over ALL commands, not the available ones.** The ribbon hides what cannot apply; a menu lists what exists and
 * disables what cannot run now, so it is the one projection besides the shortcut map that reads `when` as a state
 * rather than as a filter.
 */
export function menuBarModel(registry: CommandRegistry, context: CommandContext): readonly MenuBarMenuModel[] {
  const enabled = new Set(registry.available(context).map((command) => command.id));
  const item = (command: UiCommand): MenuBarItem => ({
    command,
    enabled: enabled.has(command.id),
    checked: command.checked?.(context),
  });

  type Collected = Map<number, { caption: MessageKey | undefined; entries: OrderedEntry[] }>;
  const application = new Map<MenuBarMenu, Collected>();
  for (const command of registry.all()) {
    for (const placement of command.placements) {
      const slot = menuBarSlot(placement);
      if (slot === undefined) continue;
      const menu: Collected = application.get(slot.menu) ?? new Map<number, { caption: MessageKey | undefined; entries: OrderedEntry[] }>();
      const group = menu.get(slot.group) ?? { caption: undefined, entries: [] };
      group.caption ??= slot.caption;
      group.entries.push({ command, order: slot.order });
      menu.set(slot.group, group);
      application.set(slot.menu, menu);
    }
  }
  const applicationGroups = (menu: MenuBarMenu): MenuBarGroup[] =>
    [...(application.get(menu) ?? [])]
      .sort(([left], [right]) => left - right)
      .map(([, group]) => ({ caption: group.caption, items: ordered(group.entries).map((entry) => item(entry.command)) }));

  const sections = new Map(sectionsOf(registry.all()).map((section) => [section.section, section.groups]));
  const sectionGroups = (section: SectionId): MenuBarGroup[] =>
    (sections.get(section) ?? []).map((group) => ({
      caption: group.group,
      items: group.entries.map((entry) => item(entry.command)),
    }));

  const menus: MenuBarMenuModel[] = [
    { id: 'file', groups: applicationGroups('file') },
    { id: 'edit', groups: [...applicationGroups('edit'), ...sectionGroups('edit')] },
    { id: 'view', groups: applicationGroups('view') },
    ...MENU_BAR_SECTIONS.map((section) => ({ id: section, groups: sectionGroups(section) })),
    { id: 'window', groups: applicationGroups('window') },
    { id: 'help', groups: applicationGroups('help') },
  ];
  return menus.filter((menu) => menu.groups.length > 0);
}

function menuBarSlot(placement: Placement): MenuBarPlacement | undefined {
  switch (placement.surface) {
    case 'menu-bar':
      return placement;
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
    case 'status-bar':
    case 'title-bar':
    case 'rail':
    case 'properties':
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * Which gap a status-bar placement names. A `never` default for Decision 4's reason, one level
 * down: a fourth cluster fails to compile here until somebody says where it renders.
 */
function statusBarGap(placement: StatusBarPlacement): StatusBarGap {
  switch (placement.cluster) {
    case 'navigation':
      return placement.side === 'before' ? 'navigation.before' : 'navigation.after';
    case 'zoom': {
      const { side } = placement;
      switch (side) {
        case 'before':
          return 'zoom.before';
        case 'between':
          return 'zoom.between';
        case 'after':
          return 'zoom.after';
        default: {
          const unhandled: never = side;
          return unhandled;
        }
      }
    }
    case 'chrome':
      return 'chrome';
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * The command palette — Ctrl+K.
 *
 * **Reads no placements at all, and that is the point.** §7 says a hidden
 * surface can always be restored from the palette, which only holds if the
 * palette shows commands that appear nowhere else. A command with an empty
 * `placements` array is palette-only and legitimate.
 *
 * Sorted by id, because the palette is searched rather than scanned and a
 * stable order is worth more than any ranking that would need a second field.
 */
export function paletteModel(
  registry: CommandRegistry,
  context: CommandContext,
): readonly UiCommand[] {
  return [...registry.available(context)].sort((left, right) => left.id.localeCompare(right.id));
}

/** A chord conflict: two commands claiming one shortcut. */
export class ShortcutConflict extends Error {
  override readonly name = 'ShortcutConflict';

  constructor(chord: string, first: string, second: string) {
    super(
      `"${chord}" is claimed by both "${first}" and "${second}". A chord that dispatched to ` +
        `whichever command was registered later would be a feature that stops working with ` +
        `nothing red, which is Decision 3's argument about ids applied to the other key a user ` +
        `reaches a command by.`,
    );
  }
}

/**
 * The shortcut map — chord to command.
 *
 * ## Built over ALL commands, never the available ones
 *
 * A chord's meaning must not depend on application state: a conflict that only
 * exists when a document is open is a conflict that ships. `available` is
 * applied when a chord is pressed, not when the map is built, so this is the
 * one projection that ignores `when`.
 *
 * Chords are compared case-insensitively with modifiers normalised, so
 * `Ctrl+S` and `ctrl+s` collide rather than coexisting — two spellings of one
 * chord is the collision that looks like two chords.
 */
export function shortcutMapOf(registry: CommandRegistry): ReadonlyMap<string, UiCommand> {
  const map = new Map<string, UiCommand>();
  for (const command of registry.all()) {
    if (command.shortcut === undefined) continue;
    const chord = normaliseChord(command.shortcut);
    const existing = map.get(chord);
    if (existing !== undefined) throw new ShortcutConflict(chord, existing.id, command.id);
    map.set(chord, command);
  }
  return map;
}

/** One row of the keyboard shortcuts list: the chord as its command spells it, and that command's title. */
export interface ShortcutEntry {
  readonly chord: string;
  readonly title: MessageKey;
}

/**
 * Every bound chord and what it runs, for the F1 list — over ALL commands, as the map is.
 *
 * Read off {@link shortcutMapOf} rather than re-derived from each command's `shortcut`, because the map is the one place
 * a chord is decided: a list that walked the registry itself would show two rows for a conflict the map refuses.
 * Sorted by the normalised chord, so the order does not follow registration order.
 */
export function shortcutListModel(registry: CommandRegistry): readonly ShortcutEntry[] {
  return [...shortcutMapOf(registry)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([chord, command]) => ({ chord: command.shortcut ?? chord, title: command.title }));
}

/**
 * One spelling per chord: lower case, modifiers in a fixed order, no spaces.
 *
 * The fixed order is what makes `Ctrl+Shift+P` and `Shift+Ctrl+P` one chord. A
 * user pressing keys does not distinguish them, so a map that did would hold a
 * conflict it reported as two entries.
 */
export function normaliseChord(chord: string): string {
  const parts = chord
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  const modifiers = ['ctrl', 'alt', 'shift', 'meta'];
  const held = modifiers.filter((modifier) => parts.includes(modifier));
  const keys = parts.filter((part) => !modifiers.includes(part));
  return [...held, ...keys].join('+');
}
