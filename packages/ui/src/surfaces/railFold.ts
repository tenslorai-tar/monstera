/**
 * Which rail entries fold into the rail's *More* in a column this tall
 * ([ADR-0147](../../../../docs/DECISIONS/0147-a-short-window-folds-the-rail.md)).
 *
 * The rail is one column: the sections, then the foot's commands. Its buttons shrink to their content first, so the
 * room is counted in buttons at that height, read from a ruler, never from what is drawn — the same height gives the
 * same answer whatever was folded before. *More* is itself a button and takes one of the places.
 *
 * Entries fold from the END of the column, so what stays drawn keeps the owner's order, and **the active section never
 * folds**: the entry before it goes instead, because a rail whose highlighted entry is inside a menu no longer says
 * where the person is.
 *
 * @param total how many entries the column holds
 * @param active the active section's place in the column, or `undefined` when none is
 * @param capacity how many buttons the column holds at their content height
 * @returns the places that fold, empty when every entry fits
 */
export function railFolded(total: number, active: number | undefined, capacity: number): ReadonlySet<number> {
  if (total <= capacity) return new Set();
  // ONE PLACE FOR MORE, and never fewer than the active section drawn beside it.
  const drawn = Math.max(capacity - 1, active === undefined ? 0 : 1);
  const folded = new Set<number>();
  for (let place = total - 1; place >= 0 && total - folded.size > drawn; place -= 1) {
    if (place !== active) folded.add(place);
  }
  return folded;
}

/** How many buttons of `unit` height, `gap` apart, a column of `inner` height holds. */
export function railCapacity(inner: number, unit: number, gap: number): number {
  if (unit <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((inner + gap) / (unit + gap)));
}
