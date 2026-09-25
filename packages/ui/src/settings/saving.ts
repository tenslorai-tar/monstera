import { z } from 'zod';

import { AUTOSAVE_DESCRIPTION, AUTOSAVE_OPTION_TITLES, AUTOSAVE_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * Autosave's interval — the founding record's *"Autosave (interval setting; off by default)"*.
 *
 * **Off by default, and the reason is that a save replaces the file.** Monstera writes a document back to the
 * file it was opened from; saving on a timer would put a half-finished edit over the original without the
 * person asking. So it is a choice somebody makes, on the Saving page.
 *
 * Whole minutes, as the names a person reads; `autosave.ts` turns one into milliseconds.
 */
export const AUTOSAVE_SETTING: SettingDefinition<z.ZodEnum<{ off: 'off'; '1': '1'; '5': '5'; '10': '10' }>> = {
  id: 'saving.autosave',
  title: AUTOSAVE_TITLE,
  description: AUTOSAVE_DESCRIPTION,
  schema: z.enum(['off', '1', '5', '10']),
  fallback: 'off',
  category: 'saving',
  optionTitles: AUTOSAVE_OPTION_TITLES,
};

export type AutosaveInterval = z.infer<(typeof AUTOSAVE_SETTING)['schema']>;
