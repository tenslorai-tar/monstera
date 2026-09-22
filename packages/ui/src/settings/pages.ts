import type { MessageKey } from '@monstera/shared';

import { SETTINGS_CATEGORY_TITLES } from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';
import type { SettingCategory } from '../registries/settings.js';

/**
 * The Settings dialog's pages, in the owner's order, each with the glyph its list row draws
 * (the design of 2026-09-22: a left list of categories with icons, the selected page on the right).
 *
 * ## One list, and the order is the design's
 *
 * The registry knows which page a setting belongs to and nothing about the order pages are shown
 * in — a `Record`'s key order would be that order by accident, which is how it worked until this
 * file existed. Here it is stated, so moving a page is an edit to a list rather than to a type.
 *
 * ## `general` is not drawn, and that is deliberate
 *
 * It is the category a setting gets when nobody chose one, and the owner's design has no *General*
 * page. Nothing registers into it today; a setting that arrives there is drawn nowhere, which the
 * check below reports rather than hiding — an unreachable setting is the display-only defect from
 * the other side.
 */
export interface SettingsPage {
  readonly id: SettingCategory;
  readonly title: MessageKey;
  readonly icon: IconName;
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: 'appearance', title: SETTINGS_CATEGORY_TITLES.appearance, icon: 'Sparkles' },
  { id: 'viewing', title: SETTINGS_CATEGORY_TITLES.viewing, icon: 'FileSearch' },
  { id: 'rendering', title: SETTINGS_CATEGORY_TITLES.rendering, icon: 'Image' },
  { id: 'editing', title: SETTINGS_CATEGORY_TITLES.editing, icon: 'PenLine' },
  { id: 'saving', title: SETTINGS_CATEGORY_TITLES.saving, icon: 'Save' },
  { id: 'ocr', title: SETTINGS_CATEGORY_TITLES.ocr, icon: 'ScanText' },
  { id: 'ai', title: SETTINGS_CATEGORY_TITLES.ai, icon: 'WandSparkles' },
  { id: 'integrations', title: SETTINGS_CATEGORY_TITLES.integrations, icon: 'Globe' },
  { id: 'keyboard', title: SETTINGS_CATEGORY_TITLES.keyboard, icon: 'Keyboard' },
  { id: 'privacy', title: SETTINGS_CATEGORY_TITLES.privacy, icon: 'Shield' },
  { id: 'updates', title: SETTINGS_CATEGORY_TITLES.updates, icon: 'Download' },
  { id: 'advanced', title: SETTINGS_CATEGORY_TITLES.advanced, icon: 'Wrench' },
];
