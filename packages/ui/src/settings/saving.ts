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
 * Whole minutes, as the names a person reads; `autosave.ts` turns one into milliseconds. THE FOUNDING RECORD'S SIX
 * (`BUILD-PROMPT.md`:617, *"off/1/2/5/10/30 min"*): this shipped with four and no recorded reason for the other two,
 * found by the stage audit of 1e1bfad..e24eca0e.
 */
export const AUTOSAVE_SETTING: SettingDefinition<
  z.ZodEnum<{ off: 'off'; '1min': '1min'; '2min': '2min'; '5min': '5min'; '10min': '10min'; '30min': '30min' }>
> = {
  id: 'saving.autosave',
  title: AUTOSAVE_TITLE,
  description: AUTOSAVE_DESCRIPTION,
  // WORDS, NOT BARE NUMBERS: the registry refuses an index-like member, which zod would move ahead of *Off*.
  schema: z.enum(['off', '1min', '2min', '5min', '10min', '30min']),
  // A VALUE STORED BEFORE THE RENAME — '1', '5' or '10' — is the same choice, so it is read as that choice rather
  // than falling back to off.
  migrate: (stored) => (stored === '1' || stored === '5' || stored === '10' ? `${stored}min` : stored),
  fallback: 'off',
  category: 'saving',
  optionTitles: AUTOSAVE_OPTION_TITLES,
};

export type AutosaveInterval = z.infer<(typeof AUTOSAVE_SETTING)['schema']>;
