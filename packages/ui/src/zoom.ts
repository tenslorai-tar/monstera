/**
 * What a zoom IS, in one module: the ladder, the two fits, and the arithmetic
 * that turns a fit into a scale.
 *
 * ## Why a MODE and not a number
 *
 * `± ` and the preset ladder are functions of the current zoom, so a number is
 * the whole state. **Fit-width and fit-page are not**: they are a relationship
 * between the scroller's box and the page's, and the answer changes when the
 * window is resized or a differently-sized page is reached — with the reader
 * having asked for nothing. A viewer that resolved a fit to a number at the
 * moment the command ran would show *fit width* once and then drift out of it,
 * silently, on the next resize.
 *
 * So the state a reader holds is a **mode**, and the scale is derived from it
 * wherever the measurement lives. That also decides where the derivation
 * happens: `App` cannot compute a fit, because `App` does not know the
 * scroller's width and should not learn it — measuring layout is the scroller's
 * business (B5 over a prop drilled downward).
 *
 * ## And that is why this is a module rather than three fields
 *
 * The ladder was in `commands/documentCommands.ts`, which is where the commands
 * live rather than where the concept does. A fit resolved in the component and
 * a ladder stepped in the command module would be two places deciding what a
 * zoom is, and the first disagreement between them is a fit that steps to a
 * ladder value nobody asked for.
 */

/**
 * The preset ladder.
 *
 * MULTIPLICATIVE STEPPING WAS REJECTED: repeated multiplication lands on
 * 1.0000000000000002 and a control that reads *100%* would then be a rounding
 * artefact away from *fit*. A list has exact members, and a reader stepping out
 * and back arrives at the value they left.
 *
 * The steps are the ones every viewer this one replaces offers, and they are
 * closer together near 100% because that is where a reader adjusts.
 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/**
 * What the reader asked for.
 *
 * `scale` carries a number because that is what the ladder produces; the two
 * fits carry nothing, because their number does not exist until something has
 * measured a box. **A `ZoomMode` cannot express a stale fit** — there is no
 * field to put one in — which is the property a `{ mode, value }` pair would
 * lose the moment a resize left the value behind (B5).
 */
export type ZoomMode =
  | { readonly kind: 'scale'; readonly scale: number }
  | { readonly kind: 'fit-width' }
  | { readonly kind: 'fit-page' };

/** A box, in CSS pixels. */
export interface Box {
  readonly width: number;
  readonly height: number;
}

/** The mode a document opens at. */
export const DEFAULT_ZOOM: ZoomMode = { kind: 'scale', scale: 1 };

/**
 * The scale a fit cannot go below or above.
 *
 * A fit is arithmetic on two measurements, and either can be degenerate — a
 * scroller laid out at zero width during a mount, a page whose box has not
 * arrived. Clamping to the ladder's own ends means a fit can never produce a
 * scale the ± controls could not also reach, so there is no state the reader
 * can be in that they cannot step out of.
 */
const MIN_SCALE = ZOOM_STEPS[0];
const MAX_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 4;

/**
 * How much of the scroller's box a page may not use.
 *
 * The slot carries margin either side, and a fit computed against the raw
 * width lands a page whose edges sit exactly on the scrollbar — which then
 * appears, which narrows the box, which is a layout loop rather than a fit.
 * Reserving the gutter up front makes the answer stable in one pass.
 */
const GUTTER_PX = 32;

/**
 * The scale for `mode`, given what has been measured.
 *
 * @param mode what the reader asked for
 * @param viewport the scroller's own box, or `undefined` before it is measured
 * @param page the page's box AT SCALE 1, in CSS pixels, or `undefined` before
 *   any page has been drawn
 * @returns the scale to rasterise at, or `undefined` when a fit cannot yet be
 *   answered — which is *not* the same as 1, and callers must not substitute
 *   it. Drawing a fit at 1 shows the reader a zoom they did not ask for and
 *   then corrects it a frame later, which is the wrong-geometry flash RRRRR-2
 *   is about.
 */
export function resolveZoom(mode: ZoomMode, viewport?: Box, page?: Box): number | undefined {
  if (mode.kind === 'scale') return mode.scale;
  if (viewport === undefined || page === undefined) return undefined;
  // A ZERO ANYWHERE IS NOT A FIT. Dividing by it yields Infinity, which clamps
  // to the maximum and shows a page 400% wide for a box that has not been laid
  // out yet — a plausible-looking answer produced by an absent measurement,
  // which is worse than no answer.
  if (page.width <= 0 || page.height <= 0) return undefined;
  const usableWidth = viewport.width - GUTTER_PX;
  const usableHeight = viewport.height - GUTTER_PX;
  if (usableWidth <= 0 || usableHeight <= 0) return undefined;

  const byWidth = usableWidth / page.width;
  const scale = mode.kind === 'fit-width' ? byWidth : Math.min(byWidth, usableHeight / page.height);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The mode one step in from `mode`, given the scale currently shown.
 *
 * **Stepping out of a fit lands on the ladder, not on the fit's own number.** A
 * reader at *fit width* who presses `+` wants a preset, and a ladder that
 * started from 1.37 would offer 1.5 — correct — while one that kept the fit
 * would leave them in a mode that jumps on the next resize. `shown` is what
 * makes the step relative to what is on screen rather than to what was last
 * asked for.
 *
 * **It takes the shown scale and NOT the mode**, which is the whole point: the
 * mode a reader is stepping out of tells you nothing about where the ladder
 * should start, and a signature that accepted it would invite a caller to pass
 * the mode's own scale for a fit — where there is none.
 *
 * @param shown the scale actually being displayed, which for a fit is the
 *   resolved number and not the mode
 */
export function zoomInFrom(shown: number): ZoomMode {
  return { kind: 'scale', scale: ZOOM_STEPS.find((step) => step > shown) ?? shown };
}

/** The step below what is shown. See {@link zoomInFrom}. */
export function zoomOutFrom(shown: number): ZoomMode {
  return { kind: 'scale', scale: [...ZOOM_STEPS].reverse().find((step) => step < shown) ?? shown };
}
