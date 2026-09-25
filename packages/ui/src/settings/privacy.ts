import { RECENT_PREVIEWS_SETTING_ID } from '@monstera/contract';
import { z } from 'zod';

import { PRIVACY_RECENT_PREVIEWS_DESCRIPTION, PRIVACY_RECENT_PREVIEWS_TITLE } from '../messages/en.js';
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
