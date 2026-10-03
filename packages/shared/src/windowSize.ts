/**
 * The smallest window this application may be resized to.
 *
 * ## Why there is a floor at all
 *
 * The ribbon folds each group down to one button and a *More*
 * (`surfaces/ribbonFolding.ts`), and that floor is a real one: past it a group would be a caption
 * over an anonymous control. So below some width the chrome stops fitting. This constant was the
 * answer until 2026-09-29: a window that cannot get there, since a row that scrolls sideways is
 * forbidden in the owner's words.
 *
 * **It is now the floor on a screen with room for it, and no more.** A 1080p screen at 200% has a
 * work area about 960 wide, where this floor is a window that cannot fit (WCAG 1.4.4). The owner's
 * order of 28 September makes the floor give way to the work area ({@link minimumWindowFor}) and has
 * the ribbon fold WHOLE groups into the row's own *More* below it (`foldRow`) — the third answer,
 * which keeps every tool reachable and still scrolls nothing.
 *
 * ## Where the number comes from, measured 2026-09-23
 *
 * Driven through the real browser at the Home section, one document open: the tools row overflows
 * its box by **13 px at 900**, and fits with every group folded at **960** and at **1000**. So the
 * measured floor for that section sits between 900 and 960.
 *
 * **1024 is that floor plus a margin of about 64 px, and the margin is the point**: the measurement
 * is of ONE section, and the sections differ — a section with one more group needs roughly one more
 * group's floor, which is a button plus a *More*. 1024 is also a width people recognise, so a window
 * that refuses to go below it does not read as arbitrary.
 *
 * **What this does NOT claim**: that every section fits at 1024. Only Home was measured, and the set
 * grows as features land. `renderedScreen.pw.ts` asserts the row does not scroll at exactly this
 * width, so a section that outgrows it fails there rather than on somebody's screen.
 *
 * ## The height
 *
 * 720 is the title bar, the ribbon and the status bar — about 227 px of chrome together — plus a
 * canvas tall enough to show a page at a readable zoom. It is not measured the way the width is,
 * because nothing in the chrome fights for vertical space: the panels scroll and the canvas takes
 * what is left.
 */
export const MINIMUM_WINDOW = { width: 1024, height: 720 } as const;

/**
 * The narrowest the page area may be drawn, in CSS pixels
 * ([ADR-0146](../../../docs/DECISIONS/0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md) Decision 1): the
 * document row's flexible pane, which is the canvas area and the gap on each side where a resize handle lies.
 *
 * **What {@link MINIMUM_WINDOW} leaves the page with both side panels at their minimums**, so the window this module
 * promises draws all of its chrome and only a smaller one — a display whose work area is under 1024 wide — makes a side
 * give way. Measured in Chromium 151 at 1024 × 720 on 2026-10-03, the document row is 936 px: less the document panel's
 * 256 and the contextual panel's 264 (`packages/ui/src/settings/layout.ts`), that is 416 — a US Letter page at about
 * 47%, with the 32 px gutter `zoom.ts` keeps around a fit.
 *
 * Here beside the window it is derived from, because the rendered case for ADR-0146 reads it too: it asserts that
 * nothing gives way at 1024 × 720, so chrome that widens the row's neighbours fails there rather than quietly hiding a
 * panel at the minimum window.
 */
export const PAGE_AREA_MIN_WIDTH = 416;

/**
 * A side panel's reopen handle, in CSS pixels: what a side costs the document row when it is shut or has given way.
 *
 * Read from the stylesheets: a dense icon button, a 14 px glyph with `--space-4` padding and a 1 px border on each side
 * (24), and the handle's own 1 px seam (25). The rendered case for ADR-0146 asserts that both handles measure this, so a
 * restyled handle fails there rather than moving the point where a panel gives way.
 */
export const EDGE_HANDLE_WIDTH = 25;

/**
 * The floor a window on a display with this work area may be resized to: {@link MINIMUM_WINDOW}, and never more than
 * the work area itself.
 *
 * ## Why the work area wins
 *
 * A 1080p screen at 200% scaling has a work area of about 960 × 516 CSS pixels, so a 1024 × 720 floor there is a
 * window that cannot be made to fit the screen — WCAG 1.4.4's failure, and a refusal the person has no way round. The
 * owner decided it (list of 28 September, item 3): the floor gives way to the screen, and below 1024 the ribbon folds
 * whole groups into its *More* (`foldRow`) rather than scroll. What the floor protected is then protected by folding.
 */
export function minimumWindowFor(workArea: { readonly width: number; readonly height: number }): {
  readonly width: number;
  readonly height: number;
} {
  return {
    width: Math.max(1, Math.min(MINIMUM_WINDOW.width, Math.floor(workArea.width))),
    height: Math.max(1, Math.min(MINIMUM_WINDOW.height, Math.floor(workArea.height))),
  };
}
