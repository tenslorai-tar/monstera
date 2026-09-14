/**
 * The one conversion out of the splitter's unit.
 *
 * ## Why this exists
 *
 * A person means a width in pixels: *"the panel is this wide"*, and it should stay that wide
 * when the window changes, so the width setting stores pixels. `@zag-js/splitter` reports a
 * finished resize as percentages of its root (`onResizeEnd`'s `size`). Two units across one
 * boundary is the shape where both halves are right in their own frame and the feature is wrong
 * (CLAUDE.md, the wired pair's blind spot), so the correspondence is stated once, here.
 *
 * ## THE LIBRARY OWNS THE INWARD DIRECTION, and this module must not become a second opinion
 *
 * A width going INTO the splitter is handed over as a `"224px"` string, and the machine resolves
 * it itself (`utils/size.mjs` `parsePanelSize`: `px / rootEl.getBoundingClientRect().width * 100`).
 * There is deliberately no pixels-to-percent function here: one would be a second resolver for a
 * rule the library implements (B3a). The keyboard step is left at the machine's own percentage
 * step for the same reason.
 *
 * What remains is that rule's exact inverse, and it must be given the root measured the way
 * `parsePanelSize` measures it — the root element's `getBoundingClientRect().width` for a
 * horizontal splitter.
 *
 * ## An unmeasured root has no answer
 *
 * A root that has not been laid out measures 0, and `parsePanelSize` returns nothing for it too.
 * This returns `undefined` rather than 0 pixels, which a caller would store as though the person
 * had dragged the panel shut.
 */

/** The pixels `percent` of a root of `rootPixels` occupies, or `undefined` for an unmeasured root. */
export function pixelsOfRoot(percent: number, rootPixels: number): number | undefined {
  if (!(rootPixels > 0) || !Number.isFinite(percent)) return undefined;
  return (percent / 100) * rootPixels;
}
