import { z } from 'zod';

import {
  REDUCE_MOTION_DESCRIPTION,
  REDUCE_MOTION_TITLE,
  THEME_DESCRIPTION,
  THEME_OPTION_TITLES,
  THEME_TITLE,
  THUMBNAIL_SIZE_DESCRIPTION,
  THUMBNAIL_SIZE_OPTION_TITLES,
  THUMBNAIL_SIZE_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The first registered setting that a shipped code path reads.
 *
 * ## Why the theme, and not something easier
 *
 * §10.4's rule for a setting is the wired-tools rule one layer down: *"a
 * registered key nothing reads is the display-only sin"*. So the first one has
 * to change something observable through a path that already exists rather than
 * one built to receive it — and `tokens.css` already remaps every token under
 * `[data-theme='light']`, `[data-theme='dark']` and `[data-theme='hc']`
 * (§10.2). Writing this value onto the root element is therefore read by the
 * cascade, which is shipped code nobody had to modify.
 *
 * ## `system` is a value, not the absence of one
 *
 * The fallback is `system`, and `tokens.css`'s bare `:root` block is what that
 * resolves to — so *follow the operating system* is a state the setting can
 * express and return to, rather than something a user reaches by clearing the
 * setting. A tri-state written as a boolean plus an unset case is how "I chose
 * light" and "I never chose" become the same stored value.
 *
 * ## The high-contrast theme is deliberately not offered here
 *
 * `hc` exists in the token file and is not in this enum. It is an accessibility
 * mode with its own trigger — a media query and a platform setting — and
 * offering it as a third colour scheme in a dropdown would make an assistive
 * setting look like a preference. That is a row of its own, not a value of this
 * one.
 */
export const THEME_SETTING: SettingDefinition<z.ZodEnum<{
  system: 'system';
  light: 'light';
  dark: 'dark';
}>> = {
  id: 'appearance.theme',
  title: THEME_TITLE,
  description: THEME_DESCRIPTION,
  schema: z.enum(['system', 'light', 'dark']),
  fallback: 'system',
  category: 'appearance',
  optionTitles: THEME_OPTION_TITLES,
};

/** What the setting resolves to, for the one writer that applies it. */
export type Theme = z.infer<(typeof THEME_SETTING)['schema']>;

/**
 * Applies the theme to the root element.
 *
 * **`system` removes the attribute rather than writing a value**, because the
 * bare `:root` block is the system default and an attribute spelt `system` would
 * match no selector in `tokens.css` — the tokens would fall through to `:root`
 * by accident rather than by design, and a fourth theme added later would have
 * to remember that.
 *
 * The root element is the one writer of this attribute (B3): §10.2 remaps tokens
 * under it, so two components setting it would be two opinions about which
 * theme is in force, resolved by whichever rendered last.
 */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    return;
  }
  root.dataset['theme'] = theme;
}

/**
 * The media queries that mean *this person needs high contrast*.
 *
 * `forced-colors: active` is Windows High Contrast, which is the one that
 * matters for a Store app; `prefers-contrast: more` is the cross-platform
 * expression of the same request. Either is enough.
 */
/**
 * Turns off movement in the interface (v5-10's Appearance page).
 *
 * Off by default, and ALSO in force whenever Windows asks for reduced motion: {@link applyMotion} answers the
 * two together, so the stylesheet keys on one attribute and holds one list of what moves.
 */
export const REDUCE_MOTION_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'appearance.reduce-motion',
  title: REDUCE_MOTION_TITLE,
  description: REDUCE_MOTION_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'appearance',
};

/** How large the Pages panel draws its page pictures (v5-10's Appearance page). */
export const THUMBNAIL_SIZE_SETTING: SettingDefinition<z.ZodEnum<{ small: 'small'; medium: 'medium'; large: 'large' }>> = {
  id: 'appearance.thumbnail-size',
  title: THUMBNAIL_SIZE_TITLE,
  description: THUMBNAIL_SIZE_DESCRIPTION,
  schema: z.enum(['small', 'medium', 'large']),
  fallback: 'medium',
  category: 'appearance',
  optionTitles: THUMBNAIL_SIZE_OPTION_TITLES,
};

/** One of {@link THUMBNAIL_SIZE_SETTING}'s sizes. */
export type ThumbnailSize = z.infer<(typeof THUMBNAIL_SIZE_SETTING)['schema']>;

/**
 * What each size draws: a picture's width in CSS pixels and how many columns the strip lays them in.
 *
 * **Medium is the strip as v5-02 drew it** — two columns of 96. The other two are chosen to fit the panel's
 * default width, 224 px (`DOCUMENT_PANEL_WIDTH_SETTING`): three columns of 60, and one of 160, which also fits
 * the panel's 192 px minimum. The width and the count change TOGETHER, so a larger picture never pushes the
 * strip wider than its panel.
 */
export const THUMBNAIL_SIZES: Readonly<Record<ThumbnailSize, { readonly width: number; readonly columns: number }>> = {
  small: { width: 60, columns: 3 },
  medium: { width: 96, columns: 2 },
  large: { width: 160, columns: 1 },
};

/** The platform's own request for less movement. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Marks the root `data-motion="reduced"` when the setting or the platform asks, and `full` otherwise.
 *
 * ONE ATTRIBUTE FOR BOTH, rather than a media block beside an attribute block: two selectors over the same list
 * of motions is two lists, and the next motion added would be switched off by one and not the other.
 */
export function applyMotion(root: HTMLElement, settingReduces: boolean): void {
  const platformReduces =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;
  root.dataset['motion'] = settingReduces || platformReduces ? 'reduced' : 'full';
}

export const HIGH_CONTRAST_QUERIES = [
  '(forced-colors: active)',
  '(prefers-contrast: more)',
] as const;

/**
 * Whether the platform is asking for high contrast.
 *
 * **A query and not a setting, which is what the theme setting's own header
 * says.** `hc` exists in `tokens.css` and is deliberately not a value of
 * `appearance.theme`: it is an accessibility mode with its own trigger, and
 * offering it as a third colour scheme in a dropdown would make an assistive
 * setting look like a preference. This is that trigger, and it is what turned
 * a token block nothing could reach into one the platform reaches.
 *
 * Answers `false` where `matchMedia` is absent, which is every non-browser
 * environment — a shell that assumed high contrast because it could not ask
 * would be the reassuring answer pointing the wrong way.
 */
export function highContrastWanted(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return HIGH_CONTRAST_QUERIES.some((query) => window.matchMedia(query).matches);
}

/**
 * Applies the theme, with high contrast overriding whatever was chosen.
 *
 * ## The OVERRIDE direction, and it is the whole decision
 *
 * A reader who has turned high contrast on at the operating system has said
 * something stronger than a colour preference — they have said the other themes
 * are hard to read. So `hc` wins over `light` and `dark` rather than being
 * offered beside them, and a person who wants their theme back turns the
 * platform setting off, where they turned it on.
 *
 * That also means the accent is not applied under it: `tokens.css`' `hc` block
 * picks colours that clear against a black ground on purpose, and a user accent
 * layered over them would be the one colour in the theme nobody checked.
 */
export function applyAppearance(root: HTMLElement, theme: Theme, highContrast: boolean): void {
  if (highContrast) {
    root.dataset['theme'] = 'hc';
    return;
  }
  applyTheme(root, theme);
}
