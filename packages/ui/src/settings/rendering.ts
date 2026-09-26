import { z } from 'zod';

import { PRINT_DPI, PRINT_DPI_150, PRINT_DPI_300, PRINT_DPI_600, PRINT_QUALITY_DESCRIPTION } from '../messages/en.js';
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

/** Each quality's resolution — `document.print`'s three values, which the dialog's answer also carries. */
export const PRINT_QUALITY_DPI: Readonly<Record<PrintQuality, 150 | 300 | 600>> = {
  draft: 150,
  standard: 300,
  high: 600,
};
