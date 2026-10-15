import { z } from 'zod';

import {
  PAGE_MEMORY_1024,
  PAGE_MEMORY_2048,
  PAGE_MEMORY_4096,
  PAGE_MEMORY_512,
  PAGE_MEMORY_AUTOMATIC,
  PAGE_MEMORY_DESCRIPTION,
  PAGE_MEMORY_TITLE,
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
 * How much memory drawn pages may use (ADR-0247, the owner's 13d): the one limit `pixelLedger.ts` holds every page,
 * tile and thumbnail canvas to. Automatic, the default, is a quarter of the computer's physical memory, the owner's
 * figure. Members are words, as the registry requires.
 */
export const PAGE_MEMORY_SETTING: SettingDefinition<
  z.ZodEnum<{ automatic: 'automatic'; 'mb-512': 'mb-512'; 'gb-1': 'gb-1'; 'gb-2': 'gb-2'; 'gb-4': 'gb-4' }>
> = {
  id: 'rendering.page-memory',
  title: PAGE_MEMORY_TITLE,
  description: PAGE_MEMORY_DESCRIPTION,
  schema: z.enum(['automatic', 'mb-512', 'gb-1', 'gb-2', 'gb-4']),
  fallback: 'automatic',
  category: 'rendering',
  optionTitles: {
    automatic: PAGE_MEMORY_AUTOMATIC,
    'mb-512': PAGE_MEMORY_512,
    'gb-1': PAGE_MEMORY_1024,
    'gb-2': PAGE_MEMORY_2048,
    'gb-4': PAGE_MEMORY_4096,
  },
};

/** Automatic's share of physical memory: a quarter, the owner's figure (addendum 4, item 7). */
export const AUTOMATIC_PAGE_MEMORY_SHARE = 0.25;

/**
 * The limit a choice names, in bytes; Automatic needs the computer's physical memory, which `app.info` carries.
 * `undefined` physical memory (not yet answered) is no limit yet: the pages on screen are drawn whatever the limit, and
 * only the page ahead waits on it.
 */
export function pageMemoryLimit(choice: z.infer<(typeof PAGE_MEMORY_SETTING)['schema']>, physicalMemory: number | undefined): number {
  const MB = 1024 * 1024;
  switch (choice) {
    case 'automatic':
      return physicalMemory === undefined ? Number.POSITIVE_INFINITY : physicalMemory * AUTOMATIC_PAGE_MEMORY_SHARE;
    case 'mb-512':
      return 512 * MB;
    case 'gb-1':
      return 1024 * MB;
    case 'gb-2':
      return 2048 * MB;
    case 'gb-4':
      return 4096 * MB;
  }
}

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
