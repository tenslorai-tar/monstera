import { z } from 'zod';

import { THEME_TITLE } from '../messages/en.js';
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
  schema: z.enum(['system', 'light', 'dark']),
  fallback: 'system',
  category: 'appearance',
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
