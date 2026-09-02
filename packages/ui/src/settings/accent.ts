import { type Rgb, channels, onColorRounded } from '@monstera/shared';
import { z } from 'zod';

import { ACCENT_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The accent colour, and what makes one usable.
 *
 * ## The setting stores the BRAND colour and nothing derived from it
 *
 * §10.2: contrast-bearing colours are computed at the point of use via
 * `onColor`, and **storing a derived colour is a defect**. So what is stored is
 * the one colour a person chose; the colour that sits *on* it is computed every
 * time the accent is applied, against the surfaces it will actually sit on.
 *
 * A stored on-colour would be correct until the theme changed underneath it —
 * and the theme is exactly the thing that changes underneath an accent.
 */
export const ACCENT_SETTING: SettingDefinition<
  z.ZodUnion<[z.ZodLiteral<'theme'>, z.ZodString]>
> = {
  id: 'appearance.accent',
  title: ACCENT_TITLE,
  // `theme` IS A VALUE, NOT AN ABSENCE, which is `appearance.theme`'s `system`
  // one setting along. A tri-state written as a colour plus an unset case makes
  // "I chose the theme's own accent" and "I never chose" the same stored value,
  // and a theme change would then not move an accent nobody picked.
  //
  // The registry caught the first version of this at construction: an empty
  // string as the fallback is a value the schema refused, which it reports as a
  // defect that appears on a fresh install and on no machine that has run once.
  //
  // SIX DIGITS, not three: `channels` expands `#abc` perfectly well, and there
  // is no reason to offer two spellings of one value in a stored document.
  schema: z.union([z.literal('theme'), z.string().regex(/^#[0-9a-f]{6}$/iu)]),
  fallback: 'theme',
  category: 'appearance',
};

/**
 * The channels back to `#rrggbb`, for writing into a custom property.
 *
 * There is no parser here: `channels` in `@monstera/shared` already turns a CSS
 * colour into the triple `onColor` works in, and it composites alpha over a
 * ground while doing it. A hex parser in this file would have been a second
 * implementation of that — and a worse one, since it would silently disagree on
 * `#abc` and on anything carrying alpha (B3a).
 *
 * **IT DOES NOT ROUND, and that is the point of the type it takes.** It read
 * `Math.round(value)` until 2026-09-03, which made it a second place deciding
 * how a solved colour becomes eight bits — the exact class `onColorRounded`
 * exists to hold. Every caller now hands it an integral triple, so a
 * non-integral one arriving here is a caller that skipped the solver, and
 * `toString(16)` on a fraction produces a hex digit string nobody can read
 * rather than a silently wrong colour. That is the loud failure, and it is
 * better than the quiet correction it replaces.
 */
function toHex([r, g, b]: Rgb): string {
  const pair = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/**
 * The ratio an accent must clear against the surfaces it sits on.
 *
 * **3:1, which is the control-boundary floor rather than the text one.** An
 * accent bounds and fills controls; the colour that goes ON it is what carries
 * text, and that is solved separately below at 4.5.
 */
const ACCENT_FLOOR = 3;

/** The ratio the colour on top of the accent must clear. */
const ON_ACCENT_FLOOR = 4.5;

/**
 * What an accent is applied against.
 *
 * The two surfaces an accent actually appears on in this shell. Read from the
 * live computed style rather than listed here, because they are theme tokens —
 * a list here would be a copy of `tokens.css` that goes stale the first time a
 * theme is adjusted, which is the defect the token file exists to prevent.
 */
function surfaces(root: HTMLElement): Rgb[] {
  const style = getComputedStyle(root);
  return ['--bg', '--surface']
    .map((token) => channels(style.getPropertyValue(token).trim()))
    .filter((colour): colour is Rgb => colour !== null);
}

/**
 * MOVED TO `@monstera/shared` ON 2026-09-03, as `onColorRounded`.
 *
 * It lived here for one day and governed one user-chosen colour, while
 * `useOnColor` — which governs every contrast-bearing colour this application
 * renders — rounded to nearest with no direction and no verification. The same
 * defect at the site `CLAUDE.md` names as the mechanism, which is Rule 0's
 * classic half-fix: one handler closed and its sibling left open, and the
 * sibling was the load-bearing one.
 *
 * *How a solved colour becomes a channel value* is a property of the solver
 * rather than of the accent feature, so it sits beside `onColor`, `luminance`
 * and `contrast` and both callers take it. The reasoning below moved with it.
 *
 * The measurement that produced it, kept here because this is where it was
 * made: solving `#808080` against itself at 4.5:1 answers **23.59** per channel
 * at 4.5137:1, and rounding to **24** lands at 4.4957 — under the floor it was
 * just checked against. `onColorRounded`'s own header carries the mechanism and
 * the two approaches that were tried.
 */

/**
 * Applies a chosen accent, or reports why it cannot be used.
 *
 * ## Rejected rather than approximated, which the founding record asks for
 *
 * `BUILD-PROMPT.md:608` says an accent is *"auto-adjusted or rejected if it
 * cannot reach the M2 contrast floor"*. `onColor` does the adjusting — it
 * blends toward black or white until the ratio clears — and returns a failure
 * when no blend does. Handing back the closest attempt would give a caller a
 * colour that fails the ratio it asked for, which is the whole thing the floor
 * is for.
 *
 * ## `theme` CLEARS the override rather than being a colour
 *
 * It means *the theme's own accent*, so the custom properties are removed and
 * `tokens.css` answers again. Removing rather than writing the theme's value is
 * what keeps a theme change moving an accent the user never picked.
 *
 * @returns `undefined` when applied or cleared, or the reason it was refused
 */
export function applyAccent(root: HTMLElement, accent: string): string | undefined {
  if (accent === 'theme') {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
    return undefined;
  }

  const wanted = channels(accent);
  if (wanted === null) return `"${accent}" is not a colour this build can parse.`;

  const grounds = surfaces(root);
  if (grounds.length === 0) {
    // A REFUSAL, not a silent apply. No surfaces means the token file did not
    // resolve, and applying an unchecked accent then would be exactly the
    // unverified colour this function exists to prevent — the reassuring answer
    // for a broken read.
    return 'The theme surfaces could not be read, so no accent can be checked against them.';
  }

  const written = onColorRounded(wanted, grounds, ACCENT_FLOOR);
  if (!written.ok) {
    return (
      `"${accent}" cannot be used as an accent against this theme's surfaces: ${written.error}`
    );
  }

  // SOLVED AGAINST THE APPLIED ACCENT, which is the surface the label sits on,
  // and against the ROUNDED one for `onColorRounded`'s reason. Against the
  // page's background it would be a colour that reads over the page and not
  // over the button.
  const label = onColorRounded(written.value, [written.value], ON_ACCENT_FLOOR);
  if (!label.ok) {
    return `No label colour works against the adjusted accent: ${label.error}`;
  }

  root.style.setProperty('--accent', toHex(written.value));
  root.style.setProperty('--on-accent', toHex(label.value));
  return undefined;
}
