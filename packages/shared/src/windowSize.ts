/**
 * The smallest window this application may be resized to.
 *
 * ## Why there is a floor at all
 *
 * The ribbon folds each group down to one button and a *More*
 * (`surfaces/ribbonFolding.ts`), and that floor is a real one: past it a group would be a caption
 * over an anonymous control. So below some width the chrome stops fitting, and the only two answers
 * are a row that scrolls sideways — which the owner's Stage 10 order forbids in those words — or a
 * window that cannot get there. This is the second.
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
