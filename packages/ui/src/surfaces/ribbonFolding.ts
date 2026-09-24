import type { MessageKey } from '@monstera/shared';

/**
 * How many of each ribbon group's buttons are drawn, and which fold into that group's *More*.
 *
 * ## The owner's design folds PER GROUP, not once for the row
 *
 * `document-light-narrow.png` (2026-09-22) shows File keeping *Open* and *Save*, Quick tools
 * keeping *Select* and *Hand*, Display keeping *Fit Width* and *Rotate View*, and Export keeping
 * *Image* and *Word* — each with its own `More ⌄` carrying the rest. At 1920 the same groups show
 * every button and no *More* appears anywhere. So the count is not a constant and not a breakpoint:
 * it is whatever fits, which is also the only rule that can keep the order's *nothing scrolls
 * sideways* true at a width nobody has measured yet.
 *
 * ## Why this is a pure function over widths
 *
 * It takes numbers and returns counts, so every rule below is testable in milliseconds without a
 * DOM, a font or a window — and the surface's job shrinks to measuring and drawing. A fold computed
 * inside the component would be reachable only through a rendered screen, where a wrong answer
 * looks like a layout that is merely ugly.
 */

/** One group's measured parts, in CSS pixels. */
export interface GroupWidths {
  /** Each button's natural width, in the order the projection put them. */
  readonly buttons: readonly number[];
  /**
   * What the group costs besides its buttons: padding, the hairline separator, and the caption if
   * the caption is wider than the buttons that remain.
   */
  readonly chrome: number;
  /**
   * The space between two adjacent buttons in the group's row, a More included.
   *
   * **Its own field because nothing else carries it**: a button's width excludes the gap beside it,
   * and `chrome` is measured as the group minus its buttons row, which already contains the gaps. So
   * a sum of buttons plus chrome is short by one gap per neighbour pair. It was absent until
   * 2026-09-24 and nothing showed it, because the More was being charged at the widest button's
   * width, which over-paid by more than the gaps under-paid; measuring the More properly moved one
   * section 4.7 px past its row at 1024.
   */
  readonly gap: number;
  /**
   * How many of this group's tools are SECONDARY (ADR-0098), drawn in its *More* at every width.
   *
   * They are not in `buttons`, because they are never drawn in the row and so have no width to fold
   * by. What they cost the row is the *More* itself, which a group carrying any secondary always draws.
   */
  readonly secondaries: number;
}

/** What the ribbon draws for one group. */
export interface GroupFold {
  /** How many of this group's buttons are drawn in place, from the start. */
  readonly shown: number;
  /** Whether this group draws a *More* button for the rest. */
  readonly more: boolean;
}

/**
 * A group's width when `shown` of its buttons are drawn.
 *
 * The *More* button is charged for whenever anything is folded, because it is a button in the row
 * like any other — a fold that forgot it would free exactly the space it then spends.
 */
function widthOf(group: GroupWidths, shown: number, moreWidth: number): number {
  let total = group.chrome;
  for (let index = 0; index < shown; index += 1) total += group.buttons[index] ?? 0;
  const folded = shown < group.buttons.length || group.secondaries > 0;
  if (folded) total += moreWidth;
  const items = shown + (folded ? 1 : 0);
  return total + group.gap * Math.max(items - 1, 0);
}

/**
 * How many buttons each group shows so the row fits `available`.
 *
 * ## One button at a time, from the group SHOWING THE MOST, widest first among equals
 *
 * Folding a whole group at once would empty one and leave its neighbour untouched, which is not
 * what the design shows. `document-light-narrow.png` folds every group to the **same count** — two
 * buttons and a More, in File, Quick tools, Display and Export alike — so the count is the axis the
 * loss is spread along, and width only breaks a tie. It terminates: each step removes one button and
 * there are finitely many.
 *
 * **Width was the axis until 2026-09-24, and it chose badly on the Comment ribbon at 1280.** A group
 * of eleven short marks folded to two, because together they were wide, while *Measure distance ·
 * Measure area · Measure perimeter* stayed whole, because three long labels were each narrower than
 * the marks combined. The loss was even in pixels and uneven in controls — and a person scans
 * controls, not pixels. Folding by count keeps each group's first few, which are its most used.
 *
 * **The first fold of a group can make it WIDER**, and that is not a corner case — it happens
 * whenever the button being hidden is narrower than the *More* that replaces it, which is most of
 * the small ones. A loop that only asked *which is widest* then folded a group, found the row still
 * too wide, and folded again, hiding controls to buy space it was spending as it went. So a group is
 * only folded when the fold actually reduces its width, and the loop stops when no group's next fold
 * would. Found by this module's own case, before it drew anything.
 *
 * **A group never folds below one button plus its *More*.** A group drawn as nothing but a *More*
 * is a caption over a single anonymous control, which tells a person less than the row it replaced;
 * past that point the answer is a smaller ribbon, not a smaller group. So this can return a row
 * wider than `available` — deliberately, because the alternative is to keep folding until the
 * ribbon says nothing. What the surface does with a row that still does not fit is its own
 * decision, and it is not to scroll.
 */
export function foldGroups(
  groups: readonly GroupWidths[],
  available: number,
  moreWidth: number,
): readonly GroupFold[] {
  // PAIRED WITH ITS GROUP, so nothing here indexes one array with another's position. The two were
  // parallel arrays and every read needed a cast to say what the compiler could not: that they are
  // the same length.
  const state = groups.map((group) => ({ group, shown: group.buttons.length }));
  const total = (): number => state.reduce((sum, entry) => sum + widthOf(entry.group, entry.shown, moreWidth), 0);

  while (total() > available) {
    // THE WIDEST GROUP WHOSE NEXT FOLD WOULD NARROW IT. `-1` means no fold left that buys anything
    // — every group is at its floor, or the only folds available would cost more than they free —
    // and the loop ends with the row still too wide rather than hiding controls for nothing.
    let chosen: { group: GroupWidths; shown: number } | undefined;
    let chosenWidth = -1;
    for (const entry of state) {
      if (entry.shown <= 1) continue;
      const width = widthOf(entry.group, entry.shown, moreWidth);
      // WOULD FOLDING THIS GROUP EVER HELP? Not *would the next step*: the width is strictly
      // decreasing once a group is folded at all, so the only step that can widen it is the first,
      // and a rule that refused that step would refuse every fold of a group whose widest button is
      // the problem. The floor — one button plus the More — is what the question is asked against.
      if (widthOf(entry.group, 1, moreWidth) >= width) continue;
      const shows = chosen === undefined ? -1 : chosen.shown;
      if (entry.shown > shows || (entry.shown === shows && width > chosenWidth)) {
        chosen = entry;
        chosenWidth = width;
      }
    }
    if (chosen === undefined) break;
    chosen.shown -= 1;
  }

  return state.map((entry) => ({
    shown: entry.shown,
    more: entry.shown < entry.group.buttons.length || entry.group.secondaries > 0,
  }));
}

/**
 * One button in a group's row: a single tool, or a named menu of tools (ADR-0101).
 *
 * `key` is the first member's command id, which is what the row measures a button by, so a menu and
 * the tool it would otherwise be are measured the same way.
 */
export interface RibbonUnit<T> {
  readonly key: string;
  readonly menu: MessageKey | undefined;
  readonly entries: readonly T[];
}

/** What a ribbon entry has to carry for the row to be built from it. */
interface UnitEntry {
  readonly secondary: boolean;
  readonly menu: MessageKey | undefined;
  readonly command: { readonly id: string };
}

/**
 * A group's PRIMARY entries as the buttons its row draws.
 *
 * **The one place a button is defined**, which the fold's measurement and the drawing both call: a
 * second opinion about whether two menu members are one button would make the fold charge for a
 * width the row never draws. Members of a menu are gathered where the first of them falls, in their
 * own order; secondaries are not buttons and are left out.
 */
export function ribbonUnits<T extends UnitEntry>(entries: readonly T[]): readonly RibbonUnit<T>[] {
  const units: { key: string; menu: MessageKey | undefined; entries: T[] }[] = [];
  const byMenu = new Map<MessageKey, { key: string; menu: MessageKey | undefined; entries: T[] }>();
  for (const entry of entries) {
    if (entry.secondary) continue;
    if (entry.menu === undefined) {
      units.push({ key: entry.command.id, menu: undefined, entries: [entry] });
      continue;
    }
    const existing = byMenu.get(entry.menu);
    if (existing !== undefined) {
      existing.entries.push(entry);
      continue;
    }
    const unit = { key: entry.command.id, menu: entry.menu, entries: [entry] };
    byMenu.set(entry.menu, unit);
    units.push(unit);
  }
  return units;
}

/**
 * Splits a group's entries into the ones drawn in place and the ones its *More* holds.
 *
 * **One function for both halves, because the property that matters is that they are a partition**:
 * every command a group has is either a button or in its overflow, never lost between them and never
 * in both. That is the wired-tools rule applied to folding — a tool that vanished when the window
 * narrowed would be a control that stops existing at a width — and as two separate slices at a call
 * site it is a property nothing states.
 *
 * `undefined` is *not measured yet*, which draws every PRIMARY and folds only the secondaries. It is
 * deliberately not the same as a fold that hides nothing: before the first measurement there is
 * nothing to fold from, and treating the two alike would draw a folded ribbon for one frame on a
 * window wide enough for the whole of it. Secondaries are folded from the first frame, because they
 * are folded at every width (ADR-0098) and would otherwise flash in the row once.
 *
 * **The *More* lists the width-folded primaries FIRST, then the secondaries.** A primary folded
 * because the window is narrow is one of the group's more-used tools, so it comes before the ones the
 * design always keeps out of the row.
 */
export function splitFold<T extends UnitEntry>(
  entries: readonly T[],
  fold: GroupFold | undefined,
): {
  /** The buttons drawn in the row, each a tool or a named menu. */
  readonly shown: readonly RibbonUnit<T>[];
  /** What the group's *More* lists, one command per line — a folded menu's members included. */
  readonly folded: readonly T[];
} {
  const units = ribbonUnits(entries);
  const secondaries = entries.filter((entry) => entry.secondary);
  if (fold === undefined) return { shown: units, folded: secondaries };
  return {
    shown: units.slice(0, fold.shown),
    folded: [...units.slice(fold.shown).flatMap((unit) => unit.entries), ...secondaries],
  };
}
