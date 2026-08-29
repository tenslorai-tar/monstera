import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import { SECTION_IDS, type MenuContext, type Placement, type SectionId } from '../registries/placement.js';

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
}

/** One captioned group within a ribbon section. */
export interface RibbonGroup {
  readonly group: string;
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
  const bySection = new Map<SectionId, Map<string, RibbonEntry[]>>();
  for (const section of SECTION_IDS) bySection.set(section, new Map());

  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const slot = ribbonSlot(placement);
      if (slot === undefined) continue;
      const groups = bySection.get(slot.section);
      // A `SectionId` the rail does not list is unrepresentable — the union is
      // the eight — so this cannot be reached, and is not defended against.
      if (groups === undefined) continue;
      const entries = groups.get(slot.group) ?? [];
      entries.push({ command, order: slot.order });
      groups.set(slot.group, entries);
    }
  }

  return SECTION_IDS.map((section) => ({
    section,
    groups: [...(bySection.get(section) ?? new Map<string, RibbonEntry[]>())]
      // Groups are ordered by their earliest member, so a feature controls where
      // its group sits by the same number that controls its buttons — rather
      // than by a second ordering nobody would know to set.
      .map(([group, entries]) => ({ group, entries: ordered(entries) }))
      .sort(
        (left, right) =>
          (left.entries[0]?.order ?? 0) - (right.entries[0]?.order ?? 0) ||
          left.group.localeCompare(right.group),
      ),
  }));
}

/** The ribbon's view of one placement, or `undefined` when it belongs elsewhere. */
function ribbonSlot(
  placement: Placement,
): { readonly section: SectionId; readonly group: string; readonly order: number } | undefined {
  switch (placement.surface) {
    case 'ribbon':
      return { section: placement.section, group: placement.group, order: placement.order };
    case 'quick-toolbar':
    case 'context-menu':
    case 'start-screen':
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
 * Its visibility is itself a command (`view.toggleQuickToolbar`), which is what
 * guarantees a hidden toolbar can be restored from the palette. That command is
 * an ordinary registry entry and needs nothing from this function.
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
      return undefined;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

/**
 * The start screen's feature shortcuts — §10.3's grid of six, *"each a real
 * entry point"*.
 *
 * Six is the layout's number and is not enforced here: a projection that
 * refused a seventh would be the layout deciding what the registry may contain,
 * which is the direction this whole seam runs the other way.
 */
export function startScreenModel(
  registry: CommandRegistry,
  context: CommandContext,
): readonly OrderedEntry[] {
  const entries: OrderedEntry[] = [];
  for (const command of registry.available(context)) {
    for (const placement of command.placements) {
      const order = startScreenOrder(placement);
      if (order !== undefined) entries.push({ command, order });
    }
  }
  return ordered(entries);
}

function startScreenOrder(placement: Placement): number | undefined {
  switch (placement.surface) {
    case 'start-screen':
      return placement.order;
    case 'ribbon':
    case 'quick-toolbar':
    case 'context-menu':
      return undefined;
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
