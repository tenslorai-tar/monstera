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
