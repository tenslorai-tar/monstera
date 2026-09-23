import { type MessageKey, type Rgb, channels, contrast } from '@monstera/shared';

import {
  ACCENT_PRESET_BLUE,
  ACCENT_PRESET_GREEN,
  ACCENT_PRESET_ORANGE,
  ACCENT_PRESET_THEME,
  ACCENT_PRESET_VIOLET,
} from '../messages/en.js';

/**
 * The accent colours Settings offers, as the owner's design draws them: a row of swatches, the first
 * being the theme's own.
 *
 * ## Why the values are here rather than in the component
 *
 * §10.2 bans a raw hex in a COMPONENT, and this is not one — it is the data a control offers, the
 * same position `windowPolicy.ts`' window background is in. A component choosing colours inline is
 * what the rule is about; a named list a control renders is the list being reviewed here.
 *
 * ## Offered, and then CHECKED
 *
 * A preset is a wish, not a promise: the dialog solves each one against the surfaces it would sit on
 * and refuses a swatch that cannot be told apart from them. So this list may safely hold a colour
 * some theme cannot take.
 *
 * **The design's note reads *rejected if it can't reach 4.5:1* and this refuses at 3:1 instead**, for
 * the reason {@link accentUsable} states: 4.5:1 is a text ratio, the text on an accent is solved per
 * theme, and no colour fails against both white and black — so the design's rule could never refuse
 * a swatch. The visible sentence in the dialog was corrected with it (2026-09-23): a row that
 * explains the withdrawn rule while the code applies another is the half-true sentence nobody checks.
 */
export interface AccentPreset {
  /** The stored value: `theme` is the theme's own accent, anything else a colour. */
  readonly value: string;
  readonly title: MessageKey;
}

/**
 * Whether an accent may be offered in a theme whose surfaces are `surfaces`.
 *
 * **The question is the accent AS A FILL**, held to WCAG 1.4.11's 3:1 against every surface it sits
 * on — the ratio `tokens.css` already applies to a boundary, and the one an accent can fail. The
 * text ON the accent is not the question: ADR-0003 types the accent a `fill` with no stored
 * companion, and `onColor` solves a readable foreground for any fill — no colour fails against both
 * white and black, so a check about the text could never refuse anything, which is a promise that
 * cannot fire rather than a rule.
 *
 * `theme` is always usable: it is whatever the theme already ships, which `check:tokencontrast`
 * evaluates on every run.
 */
export function accentUsable(value: string, surfaces: readonly Rgb[]): boolean {
  if (value === 'theme') return true;
  const accent = channels(value);
  if (accent === null || surfaces.length === 0) return false;
  return surfaces.every((surface) => contrast(accent, surface) >= ACCENT_MIN_RATIO);
}

/** WCAG 1.4.11's ratio for a non-text control against its surface — what a fill owes. */
export const ACCENT_MIN_RATIO = 3;

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { value: 'theme', title: ACCENT_PRESET_THEME },
  { value: '#16a34a', title: ACCENT_PRESET_GREEN },
  { value: '#2563eb', title: ACCENT_PRESET_BLUE },
  { value: '#7c3aed', title: ACCENT_PRESET_VIOLET },
  { value: '#ea580c', title: ACCENT_PRESET_ORANGE },
];
