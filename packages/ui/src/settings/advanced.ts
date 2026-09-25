import { REVIEW_PROMPTS_SETTING_ID } from '@monstera/contract';
import { z } from 'zod';

import { REVIEW_PROMPTS_SETTING_DESCRIPTION, REVIEW_PROMPTS_SETTING_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * Whether Monstera may ask for a Store rating — E3's *"a Settings toggle surfaces `optedOut` so the choice is
 * reversible and visible"*.
 *
 * **This value IS the opt-out**: main reads it before every prompt, and the prompt's *Don't ask again* writes
 * it through this same store. So the choice has one home and one writer, and turning it back on here is the
 * whole of reversing it.
 */
export const REVIEW_PROMPTS_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: REVIEW_PROMPTS_SETTING_ID,
  title: REVIEW_PROMPTS_SETTING_TITLE,
  description: REVIEW_PROMPTS_SETTING_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'advanced',
};
