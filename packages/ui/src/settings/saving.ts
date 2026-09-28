import { BACKUP_COPIES, BACKUP_COPIES_SETTING_ID, type BackupCopies } from '@monstera/contract';
import { z } from 'zod';

import {
  BACKUP_COPIES_DESCRIPTION,
  BACKUP_COPIES_OPTION_TITLES,
  BACKUP_COPIES_TITLE,
  AUTOSAVE_DESCRIPTION,
  AUTOSAVE_OPTION_TITLES,
  AUTOSAVE_TITLE,
  CONFIRM_REDACTION_DESCRIPTION,
  CONFIRM_REDACTION_TITLE,
} from '../messages/en.js';
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

/**
 * How many earlier versions a save leaves beside the file — Part F's *"backup copies to keep"* (`BUILD-PROMPT.md`:617).
 * `main`'s save reads the same id from the settings document at each save (`backupCopiesIn`), through the contract's
 * one table; one is the default, the one `.bak` every save wrote before this was a choice.
 */
export const BACKUP_COPIES_SETTING: SettingDefinition<z.ZodEnum<{ [K in BackupCopies]: K }>> = {
  id: BACKUP_COPIES_SETTING_ID,
  title: BACKUP_COPIES_TITLE,
  description: BACKUP_COPIES_DESCRIPTION,
  schema: z.enum(Object.keys(BACKUP_COPIES) as [BackupCopies, ...BackupCopies[]]),
  fallback: 'one',
  category: 'saving',
  optionTitles: BACKUP_COPIES_OPTION_TITLES,
};

/**
 * Whether *Apply redactions* asks first — Part F's *"confirm redaction"* (`BUILD-PROMPT.md`:618), ON by default as
 * the owner answered on 2026-09-27. A burn-in removes content and the only way back is undo in this session, so the
 * confirmation is where the person sees the scope and what is removed. Off, the burn-in applies the choices the dialog
 * would have started on (`applyRedactionsDefaults`): this page, a solid cover, the covered pixels removed, the title
 * removed — never a wider scope than the one a person would have been shown.
 */
export const CONFIRM_REDACTION_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'saving.confirm-redaction',
  title: CONFIRM_REDACTION_TITLE,
  description: CONFIRM_REDACTION_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'saving',
};
