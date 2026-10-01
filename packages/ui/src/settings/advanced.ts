import { LOG_DETAIL_STORED, type LOG_DETAILS } from '@monstera/contract';
import type { z } from 'zod';

import { LOG_DETAIL_DESCRIPTION, LOG_DETAIL_OPTION_TITLES, LOG_DETAIL_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * How much the diagnostics log records — Part F's *log verbosity*
 * ([ADR-0119](../../../../docs/DECISIONS/0119-a-detailed-log-records-each-request-by-name-outcome-and-time.md)).
 *
 * *Problems* is the log as it always was, and the default. *Detailed* adds a line per request — its name, its outcome
 * and how long it took, never what was in it. `main` reads the stored value and takes a change at the save that made
 * it, so the choice holds from the next thing a person does.
 */
export const LOG_DETAIL_SETTING: SettingDefinition<z.ZodEnum<{ [K in (typeof LOG_DETAILS)[number]]: K }>> = {
  // THE ID, SCHEMA AND DEFAULT ARE THE CONTRACT'S, which `main` reads through too (`storedSettings.ts`).
  ...LOG_DETAIL_STORED,
  title: LOG_DETAIL_TITLE,
  description: LOG_DETAIL_DESCRIPTION,
  category: 'advanced',
  optionTitles: LOG_DETAIL_OPTION_TITLES,
};
