/**
 * Colour, as WCAG defines it, in one place (B3a).
 *
 * ## Why this is in `shared` and not beside either caller
 *
 * *What is the contrast ratio between two colours* is a question **WCAG 2.1
 * §1.4.3 already answers**, and this repository has two callers that need it:
 * `scripts/lib/tokenContrast.mjs`, which evaluates the token file's declared
 * pairs, and the UI primitives, which compute a contrast-bearing colour at the
 * point of use (ADR-0003, §10.2). Two implementations of an external
 * authority's formula is the exact shape B3a forbids, and this project has
 * already paid for it three times in one day on other authorities.
 *
 * The check consumed it first and owned it; moving it here makes that check a
 * caller rather than the definition. The cost is real and is stated where it
 * lands: `tokenContrast.mjs` now needs `packages/shared` built, and guards for
 * that rather than reading a stale one.
 *
 * ## Storing a derived colour is a defect, which is why `onColor` is a function
 *
 * ADR-0003: contrast-bearing colours are **computed at the point of use** and
 * never stored. A stored derivation is correct on the day it is written and
 * silently wrong the day its surface changes — the same failure a
 * hand-maintained notice has, one layer down.
 *
 * `--border-control` is the exception that proves the rule rather than a
 * contradiction: it was **solved** with this function at design time and
 * recorded as a token because it sits on a fixed, enumerated set of chrome
 * surfaces. Where the surface is variable, the colour cannot be.
 */

import { type Result, err, ok } from './result.js';

/** Straight sRGB channels, 0–255. Not branded: three numbers with no invariant to protect. */
export type Rgb = readonly [number, number, number];

/**
 * Parses a CSS colour, compositing over `over` when it carries alpha.
 *
 * **Alpha is composited rather than ignored**, because §10.2 evaluates an alpha
 * role POST-COMPOSITE against each surface it sits on — a check against the raw
 * `rgba()` would be measuring a colour nobody sees.
 *
 * @returns the channels, or `null` when the value is not a colour this
 * understands. `null` is *not a colour*, never a black default: a parse failure
 * that returned `[0,0,0]` would report a plausible ratio for a value nobody
 * could read.
 */
export function channels(value: string, over: Rgb | null = null): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim());
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => `${digit}${digit}`)
            .join('')
        : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgba = /^rgba?\(([^)]+)\)$/u.exec(value.trim());
  if (rgba === null) return null;
  const parts = (rgba[1] ?? '').split(',').map((part) => Number(part.trim()));
  const [red, green, blue, alpha = 1] = parts;
  if (![red, green, blue].every((part) => Number.isFinite(part))) return null;
  if (alpha >= 1 || over === null) {
    return [Number(red), Number(green), Number(blue)];
  }
  return [
    Number(red) * alpha + over[0] * (1 - alpha),
    Number(green) * alpha + over[1] * (1 - alpha),
    Number(blue) * alpha + over[2] * (1 - alpha),
  ];
}

/** WCAG relative luminance. */
export function luminance([red, green, blue]: Rgb): number {
  const channel = (raw: number): number => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** WCAG contrast ratio. Symmetric: which argument is the foreground does not change it. */
export function contrast(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** How far each step moves toward black or white. 1/255 — one channel step at full range. */
const STEP = 1 / 255;

/** @param from @param toward @param t 0 keeps `from`, 1 reaches `toward`. */
function blend(from: Rgb, toward: Rgb, t: number): Rgb {
  return [
    from[0] + (toward[0] - from[0]) * t,
    from[1] + (toward[1] - from[1]) * t,
    from[2] + (toward[2] - from[2]) * t,
  ];
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * The nearest colour to `wanted` that clears `minimum` against **every**
 * background it may sit on.
 *
 * ## Every background, not the worst one
 *
 * A control's boundary sits on several chrome surfaces and must be legible on
 * all of them, so the constraint is a conjunction. Solving against the darkest
 * background alone yields a colour that fails on the lightest, and the failure
 * is invisible until somebody switches theme — which is the kind of defect
 * ADR-0003 was written after finding thirteen of.
 *
 * ## Nearest, and what that means here
 *
 * Both directions are walked — toward black and toward white — and the smaller
 * blend fraction wins. That is *nearest along the two axes a legibility fix can
 * take*, not nearest in a perceptual colour space: it preserves hue, which is
 * what a token wants, where a perceptual nearest could return a different hue
 * that happens to be closer.
 *
 * A tie goes to the darker result, deliberately and not by accident of
 * iteration order: chrome here is dark-first, and the darker of two equally
 * near answers is the one that reads as the same colour rather than as a
 * highlight.
 *
 * ## It REFUSES rather than returning the best it managed
 *
 * `minimum` can be unsatisfiable — 21:1 is only reachable between pure black
 * and pure white, so any mid-grey background admits no colour at all. Returning
 * the closest attempt would hand a caller a colour that fails the ratio it
 * asked for, which is the whole defect this function exists to prevent. The
 * failure is a `Result`, so a caller cannot use the answer without deciding
 * what to do about it (B5).
 *
 * @param wanted the colour the design asks for
 * @param backgrounds every surface it may sit on. Empty is a caller defect and refuses.
 * @param minimum the ratio to clear — 4.5 for text, 3.0 for a control boundary
 */
export function onColor(
  wanted: Rgb,
  backgrounds: readonly Rgb[],
  minimum: number,
): Result<Rgb, string> {
  if (backgrounds.length === 0) {
    return err(
      'onColor was given no backgrounds. A colour that clears a ratio against nothing is every ' +
        'colour, so this is a caller that has not said what the surface is rather than a ' +
        'constraint that happens to be empty.',
    );
  }
  if (!Number.isFinite(minimum) || minimum < 1) {
    return err(
      `onColor was asked for a minimum ratio of ${String(minimum)}. WCAG ratios start at 1:1, ` +
        `which every colour clears against itself, so anything below it is a caller error rather ` +
        `than a loose requirement.`,
    );
  }

  const clears = (candidate: Rgb): boolean =>
    backgrounds.every((background) => contrast(candidate, background) >= minimum);

  if (clears(wanted)) return ok(wanted);

  /** The smallest blend fraction toward `toward` that clears, or null if none does. */
  const solve = (toward: Rgb): number | null => {
    for (let t = STEP; t <= 1; t += STEP) {
      if (clears(blend(wanted, toward, t))) return t;
    }
    // t === 1 exactly, which the loop's floating-point accumulation can skip.
    return clears(toward) ? 1 : null;
  };

  const darker = solve(BLACK);
  const lighter = solve(WHITE);

  if (darker === null && lighter === null) {
    return err(
      `no colour on the black–white axis through rgb(${wanted.join(', ')}) clears ${String(minimum)}:1 ` +
        `against all ${String(backgrounds.length)} background(s). The tightest surfaces admit no ` +
        `answer at this ratio, so the design has to change rather than the colour.`,
    );
  }
  if (darker === null) return ok(blend(wanted, WHITE, lighter ?? 1));
  if (lighter === null) return ok(blend(wanted, BLACK, darker));
  // Ties go darker — see the note above.
  return ok(darker <= lighter ? blend(wanted, BLACK, darker) : blend(wanted, WHITE, lighter));
}
