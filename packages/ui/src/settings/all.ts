import type { SettingDefinition } from '../registries/settings.js';
import { ACCENT_SETTING } from './accent.js';
import { THEME_SETTING } from './appearance.js';
import { GRID_SETTING, RULERS_SETTING, RULER_UNIT_SETTING } from './viewing.js';

/**
 * Every setting this application has.
 *
 * ## Why a list and not four imports at each composition point
 *
 * `SettingsStore.get` **throws** for an unregistered id, deliberately — a
 * fallback there would hide a caller and a registry that disagree about what
 * exists. That is the right behaviour and it makes the composition point
 * load-bearing: a setting a component reads and nobody registered is a crash on
 * a fresh install, on the first render.
 *
 * There is more than one composition point — `main.tsx` and every test that
 * builds a store — and until 2026-09-02 each listed the settings by hand. Three
 * settings added in one commit turned thirty tests red, which is the loud
 * version; the quiet one is a test registry that keeps passing while the
 * shipped one is missing an entry, because they are different lists.
 *
 * So the list is the writer of record and the composition points take it (B3).
 * Adding a setting is one edit here.
 *
 * ## This is NOT a registry, and the distinction is ADR-0029's
 *
 * Registries are values composed at a point, never module side effects. This is
 * the *argument* to that composition, which is data — a `SettingsRegistry` built
 * here would be a module-level instance shared between every test, and the
 * whole reason for Decision 1 is that such an instance accumulates state across
 * cases nobody wired together.
 */
export const ALL_SETTINGS: readonly SettingDefinition[] = [
  THEME_SETTING,
  ACCENT_SETTING,
  RULERS_SETTING,
  GRID_SETTING,
  RULER_UNIT_SETTING,
];
