import { CRASH_REPORTS_SETTING_ID, RECENT_PREVIEWS_SETTING_ID } from '@monstera/contract';
import { z } from 'zod';

import {
  PRIVACY_CRASH_REPORTS_DESCRIPTION,
  PRIVACY_CRASH_REPORTS_TITLE,
  PRIVACY_RECENT_PREVIEWS_DESCRIPTION,
  PRIVACY_RECENT_PREVIEWS_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * Whether recent files keep a picture of their first page
 * ([ADR-0100](../../../../docs/DECISIONS/0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md)).
 *
 * **On by default**, as the ADR decided: the picture is made from a document the person opened themselves.
 * It is a picture of their document kept on disk, and this switch is where a person looks for that — so
 * turning it off deletes every picture with the same write, in main.
 */
export const RECENT_PREVIEWS_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: RECENT_PREVIEWS_SETTING_ID,
  title: PRIVACY_RECENT_PREVIEWS_TITLE,
  description: PRIVACY_RECENT_PREVIEWS_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'privacy',
};

/**
 * Whether crash reports are kept on this computer
 * ([ADR-0109](../../../../docs/DECISIONS/0109-a-crash-report-is-written-here-and-sent-only-by-the-person.md)).
 *
 * **On by default — the owner's decision of 2026-09-26.** A report never leaves unless the person sends one from the
 * offer at the next start. Main reads it before the first window; turning it off takes effect the next time Monstera
 * starts and deletes the reports already kept, which the description says.
 */
export const CRASH_REPORTS_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: CRASH_REPORTS_SETTING_ID,
  title: PRIVACY_CRASH_REPORTS_TITLE,
  description: PRIVACY_CRASH_REPORTS_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'privacy',
};
