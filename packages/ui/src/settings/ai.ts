import { ANTHROPIC_KEY_SETTING_ID } from '@monstera/contract';
import { z } from 'zod';

import { AI_ANTHROPIC_KEY_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The Anthropic API key. **Secret**, so it never travels on `settings.save` and
 * the renderer never reads it back — the Settings dialog's field is write-only
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
 *
 * ## In the AI group, not beside the feature that first needed it
 *
 * D6's Claude recogniser is its first reader, and the key is not the
 * recogniser's: it is the **provider's**, and Stage 9's provider registry takes
 * this same entry for Anthropic rather than declaring a second one
 * ([ADR-0057](../../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)
 * Decision 5). Two entries would be two stored copies of one credential.
 *
 * An empty string is the absent state, and the Claude tool is hidden while it is
 * — the Azure pair's rule and its reason.
 */
export const ANTHROPIC_KEY_SETTING: SettingDefinition<z.ZodString> = {
  id: ANTHROPIC_KEY_SETTING_ID,
  title: AI_ANTHROPIC_KEY_TITLE,
  schema: z.string(),
  fallback: '',
  category: 'ai',
  secret: true,
};
