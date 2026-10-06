/**
 * Whether the menu row's own commands can keep their words
 * ([ADR-0113](../../../../docs/DECISIONS/0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md)).
 *
 * ## Measured by the row, never a breakpoint
 *
 * The width that decides it is the menus', and a language changes that: a breakpoint chosen in English is wrong in the
 * proof locale by construction. So the menu bar measures its **slack** — the row's width less everything it must hold
 * (the mark and the menus, the commands as drawn, the drag track's minimum beside the window controls, and the gaps)
 * — and this decides from that one number.
 *
 * ## Two states, and the way back is not the way in
 *
 * Words go when the slack goes negative. They come back only when the slack covers **what the words would add**, which
 * is the width the labelled group had when it was last seen, less the width it has now. Coming back on any positive
 * slack would put the words back, overflow, drop them, and flicker at the one width where they almost fit.
 */
export interface RowFit {
  readonly iconsOnly: boolean;
  /** The commands group's width with its words, as last measured; `undefined` until it has been seen once. */
  readonly labelled: number | undefined;
}

export const LABELLED: RowFit = { iconsOnly: false, labelled: undefined };

/**
 * @param slack the row's free width in CSS pixels: negative when what it must hold does not fit
 * @param commands the commands group's width as currently drawn
 */
export function nextRowFit(fit: RowFit, slack: number, commands: number): RowFit {
  if (!fit.iconsOnly) {
    return slack < 0 ? { iconsOnly: true, labelled: commands } : { iconsOnly: false, labelled: commands };
  }
  if (fit.labelled === undefined) return fit;
  return slack >= fit.labelled - commands ? { iconsOnly: false, labelled: fit.labelled } : fit;
}

/**
 * How many menus, from the first, the row draws as its own triggers; the rest fold into a final *More*
 * ([ADR-0146](../../../../docs/DECISIONS/0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md) Decision 5).
 *
 * ## Read from a ruler, so what is folded cannot move the answer
 *
 * `widths` are the menus' names as a hidden ruler draws them, under the triggers' own rule, so a folded menu still has a
 * width and folding one changes nothing this reads. That is why there is no way back to guard here, as `nextRowFit`
 * has: the answer is a function of the room alone, and the same room gives the same answer whatever was drawn before.
 *
 * *More* takes room only when something is folded, so all of them are drawn when all of them fit without it.
 *
 * @param widths each menu's trigger width, in menu order
 * @param gap the space between two triggers
 * @param room the width the menus may take
 * @param more the *More* trigger's width
 */
export function menusThatFit(widths: readonly number[], gap: number, room: number, more: number): number {
  const span = (count: number): number =>
    widths.slice(0, count).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, count - 1);
  if (span(widths.length) <= room) return widths.length;
  for (let count = widths.length - 1; count > 0; count -= 1) {
    if (span(count) + gap + more <= room) return count;
  }
  return 0;
}
