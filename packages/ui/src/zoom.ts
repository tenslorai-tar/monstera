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

/** The mode a document opens at when nothing has chosen one — the *Starting zoom* setting's default, 100%. */
export const DEFAULT_ZOOM: ZoomMode = { kind: 'scale', scale: 1 };

/**
 * The *Starting zoom* setting's members (Part F's *"default zoom mode & level"*): the two fits and each step of the
 * ladder, as WORDS — the settings registry refuses an index-like member, which zod would move ahead of the fits.
 */
export const STARTING_ZOOMS = [
  'fit-width',
  'fit-page',
  '50pct',
  '75pct',
  '100pct',
  '125pct',
  '150pct',
  '200pct',
  '300pct',
  '400pct',
] as const;

export type StartingZoom = (typeof STARTING_ZOOMS)[number];

/**
 * The mode a starting zoom names. A step is read back off its own name and must be a ladder value — the case in
 * `zoom.test.ts` holds the members and `ZOOM_STEPS` equal in both directions, so a step added to one and not the other
 * is red rather than a setting that opens at a scale the ± controls cannot reach.
 */
export function startingZoomMode(choice: StartingZoom): ZoomMode {
  if (choice === 'fit-width' || choice === 'fit-page') return { kind: choice };
  return { kind: 'scale', scale: Number(choice.slice(0, -'pct'.length)) / 100 };
}

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
 * The *Zoom step* setting's members (Part F's *"zoom step"*, the owner's 2026-09-27 answer: the ladder as default).
 * The ladder is {@link ZOOM_STEPS}; the others step by a fixed number of percentage points.
 */
export const ZOOM_STEP_CHOICES = ['ladder', '10pct', '25pct'] as const;

export type ZoomStep = (typeof ZOOM_STEP_CHOICES)[number];

/** Which way `+`, `−` and Ctrl+wheel ask to go; the shell turns it into a mode by the reader's step. */
export type ZoomDirection = 'in' | 'out';

/** A fixed step's size in whole percentage points — whole, so stepping out and back lands where it started. */
const FIXED_STEP_POINTS: Readonly<Record<Exclude<ZoomStep, 'ladder'>, number>> = { '10pct': 10, '25pct': 25 };

/**
 * The mode one step in or out from the scale currently shown, by the reader's chosen step.
 *
 * **Stepping out of a fit lands on a step, not on the fit's own number.** A reader at *fit width* who presses `+`
 * wants a preset, and a ladder that started from 1.37 would offer 1.5 — correct — while one that kept the fit would
 * leave them in a mode that jumps on the next resize. A fixed step does the same: from 137% by tens, `+` is 140%.
 *
 * **It takes the shown scale and NOT the mode**, which is the whole point: the mode a reader is stepping out of tells
 * you nothing about where the step should start, and a signature that accepted it would invite a caller to pass the
 * mode's own scale for a fit — where there is none.
 *
 * **The step is an argument, never a default**: there is no function that steps by the ladder without being asked
 * to, so a caller cannot forget the reader's choice (B5). Both kinds stay within the ladder's ends, which is where a
 * fit is clamped too, so there is no scale one control reaches and another cannot step out of.
 *
 * @returns a function of the shown scale, which is what `onZoom` takes
 */
export function stepZoom(direction: ZoomDirection, step: ZoomStep): (shown: number) => ZoomMode {
  return (shown) => {
    if (step === 'ladder') {
      const found = direction === 'in' ? ZOOM_STEPS.find((each) => each > shown) : [...ZOOM_STEPS].reverse().find((each) => each < shown);
      return { kind: 'scale', scale: found ?? shown };
    }
    const points = FIXED_STEP_POINTS[step];
    // IN WHOLE PERCENTAGE POINTS, so 1.1 is reached as 110 / 100 and not as 1 + 0.1: repeated float addition drifts
    // off a value a reader can read, which is the ladder's own reason for being a list. The epsilon lets a shown
    // 1.1 that arrived as 1.1000000000000001 count as ON the step rather than just past it.
    const shownPoints = shown * 100;
    const target =
      direction === 'in'
        ? (Math.floor(shownPoints / points + 1e-9) + 1) * points
        : (Math.ceil(shownPoints / points - 1e-9) - 1) * points;
    const bounded = Math.min(MAX_SCALE * 100, Math.max(MIN_SCALE * 100, target));
    // AT AN END, the reader stays where they are — the ladder's own behaviour at 50% and 400%.
    if (direction === 'in' ? bounded <= shownPoints : bounded >= shownPoints) return { kind: 'scale', scale: shown };
    return { kind: 'scale', scale: bounded / 100 };
  };
}
