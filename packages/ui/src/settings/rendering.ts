import { z } from 'zod';

import {
  PRINT_DPI,
  PRINT_DPI_150,
  PRINT_DPI_300,
  PRINT_DPI_600,
  PRINT_QUALITY_DESCRIPTION,
  RENDER_QUALITY_DESCRIPTION,
  RENDER_QUALITY_DOUBLE,
  RENDER_QUALITY_EXACT,
  RENDER_QUALITY_ONE_AND_A_HALF,
  RENDER_QUALITY_TITLE,
  STARTING_ZOOM_150,
  STARTING_ZOOM_200,
  STARTING_ZOOM_300,
  TILE_THRESHOLD_DESCRIPTION,
  TILE_THRESHOLD_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The print quality the Print dialog starts on — Part F's *"print default DPI"* (`BUILD-PROMPT.md`:613).
 *
 * **Standard by default, which is what the dialog chose before this setting existed**, and the person can still pick
 * another each time they print. The members are the dialog's own three, named by the words the dialog shows — the same
 * message keys, so a label cannot drift between the two places.
 */
export const PRINT_QUALITY_SETTING: SettingDefinition<z.ZodEnum<{ draft: 'draft'; standard: 'standard'; high: 'high' }>> =
  {
    id: 'rendering.print-quality',
    title: PRINT_DPI,
    description: PRINT_QUALITY_DESCRIPTION,
    schema: z.enum(['draft', 'standard', 'high']),
    fallback: 'standard',
    category: 'rendering',
    optionTitles: { draft: PRINT_DPI_150, standard: PRINT_DPI_300, high: PRINT_DPI_600 },
  };

export type PrintQuality = z.infer<(typeof PRINT_QUALITY_SETTING)['schema']>;

/**
 * The zoom above which a page is drawn in TILES — Part F's *"tile threshold"* (`BUILD-PROMPT.md`:613), E1's *"above a
 * zoom threshold, render tiles, not whole pages, to keep memory bounded at 400%+"* (:533).
 *
 * **Every member tiles at 400%**, the ladder's top, so no choice here can put back the whole-page canvas the rule
 * exists to bound. **200% by default**: below it a whole page is at most about 32 MB on a display at 2×, and it is drawn
 * once, where tiles are drawn as a person scrolls. Members are words, not numbers — the registry refuses a member that
 * reads as an array index.
 */
export const TILE_THRESHOLD_SETTING: SettingDefinition<
  z.ZodEnum<{ 'above-150': 'above-150'; 'above-200': 'above-200'; 'above-300': 'above-300' }>
> = {
  id: 'rendering.tile-threshold',
  title: TILE_THRESHOLD_TITLE,
  description: TILE_THRESHOLD_DESCRIPTION,
  schema: z.enum(['above-150', 'above-200', 'above-300']),
  fallback: 'above-200',
  category: 'rendering',
  // THE STARTING ZOOM'S OWN WORDS for the same three percentages, so one figure is never spelt twice.
  optionTitles: { 'above-150': STARTING_ZOOM_150, 'above-200': STARTING_ZOOM_200, 'above-300': STARTING_ZOOM_300 },
};

/**
 * How many pixels a page is drawn with per pixel of the screen — Part F's *"render quality multiplier"*
 * (`BUILD-PROMPT.md`:612), which E1 keeps *"an explicit user setting only"* (:529).
 *
 * **Exact by default, and exact is not the low setting.** E1's first rule is one bitmap pixel per device pixel,
 * because drawing more and letting CSS shrink it is a low-pass filter: text comes out SOFTER, not sharper. The higher
 * members exist for what that trades well — fine line art and hatching, which the resample smooths — and they cost
 * the square of the factor in memory, which is why the factor counts toward the tile threshold.
 */
export const RENDER_QUALITY_SETTING: SettingDefinition<z.ZodEnum<{ exact: 'exact'; 'one-and-a-half': 'one-and-a-half'; double: 'double' }>> = {
  id: 'rendering.quality',
  title: RENDER_QUALITY_TITLE,
  description: RENDER_QUALITY_DESCRIPTION,
  schema: z.enum(['exact', 'one-and-a-half', 'double']),
  fallback: 'exact',
  category: 'rendering',
  optionTitles: { exact: RENDER_QUALITY_EXACT, 'one-and-a-half': RENDER_QUALITY_ONE_AND_A_HALF, double: RENDER_QUALITY_DOUBLE },
};

/** Each member's factor on the device scale. */
export const RENDER_QUALITY_FACTOR: Readonly<Record<z.infer<(typeof RENDER_QUALITY_SETTING)['schema']>, number>> = {
  exact: 1,
  'one-and-a-half': 1.5,
  double: 2,
};

/** Each member's zoom, as the scale the page list compares `renderZoom` against. */
export const TILE_THRESHOLD_ZOOM: Readonly<Record<z.infer<(typeof TILE_THRESHOLD_SETTING)['schema']>, number>> = {
  'above-150': 1.5,
  'above-200': 2,
  'above-300': 3,
};

/** Each quality's resolution — `document.print`'s three values, which the dialog's answer also carries. */
export const PRINT_QUALITY_DPI: Readonly<Record<PrintQuality, 150 | 300 | 600>> = {
  draft: 150,
  standard: 300,
  high: 600,
};
