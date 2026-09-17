import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProviderId,
  ANTHROPIC_KEY_SETTING_ID,
  AZURE_OPENAI_ENDPOINT_SETTING_ID,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { z } from 'zod';

import {
  AI_ANTHROPIC_KEY_TITLE,
  AI_AZURE_OPENAI_ENDPOINT_TITLE,
  AI_AZURE_OPENAI_KEY_TITLE,
  AI_DEEPSEEK_KEY_TITLE,
  AI_GEMINI_KEY_TITLE,
  AI_GROQ_KEY_TITLE,
  AI_MISTRAL_KEY_TITLE,
  AI_OPENAI_KEY_TITLE,
  AI_OPENROUTER_KEY_TITLE,
  AI_PERPLEXITY_KEY_TITLE,
  AI_XAI_KEY_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * A key field per AI provider — the owner's ten
 * ([ADR-0081](../../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)).
 *
 * ## Derived from the registry, not typed out again
 *
 * The fields are built by walking `AI_PROVIDER_IDS`, so a provider cannot arrive with no
 * way to store its key. What is NOT derived is each field's words: a title is a message
 * key, and a missing one is a compile error here rather than a provider labelled by its
 * id in front of a person.
 *
 * ## Secret, so write-only
 *
 * Every key never travels on `settings.save` and the renderer never reads one back
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
 * An empty string is the absent state, and a provider with no key is offered as *no key*
 * rather than hidden — §10.5's no-key state.
 *
 * **Anthropic keeps the entry D6's Claude recogniser placed**, `ai.anthropic-key`
 * (ADR-0057 Decision 5): two entries would be two stored copies of one credential.
 */

/** Each provider's words. Exhaustive over the registry, so a new provider needs its title. */
const PROVIDER_KEY_TITLES: Readonly<Record<AiProviderId, MessageKey>> = {
  anthropic: AI_ANTHROPIC_KEY_TITLE,
  openai: AI_OPENAI_KEY_TITLE,
  gemini: AI_GEMINI_KEY_TITLE,
  mistral: AI_MISTRAL_KEY_TITLE,
  xai: AI_XAI_KEY_TITLE,
  'azure-openai': AI_AZURE_OPENAI_KEY_TITLE,
  openrouter: AI_OPENROUTER_KEY_TITLE,
  groq: AI_GROQ_KEY_TITLE,
  perplexity: AI_PERPLEXITY_KEY_TITLE,
  deepseek: AI_DEEPSEEK_KEY_TITLE,
};

/** One provider's key field. */
function keySetting(provider: AiProviderId): SettingDefinition<z.ZodString> {
  return {
    id: AI_PROVIDERS[provider].keySetting,
    title: PROVIDER_KEY_TITLES[provider],
    schema: z.string(),
    fallback: '',
    category: 'ai',
    secret: true,
  };
}

/** Every provider's key field, in the registry's order. */
export const AI_PROVIDER_KEY_SETTINGS: readonly SettingDefinition<z.ZodString>[] =
  AI_PROVIDER_IDS.map(keySetting);

/**
 * Azure OpenAI's resource address. **Not secret** — it is where the request goes, not
 * what authorises it, and the Settings dialog shows it back.
 *
 * `z.string()` rather than a URL schema, for `AZURE_DI_ENDPOINT_SETTING`'s measured
 * reason: a field that refuses what somebody is in the middle of typing is a field that
 * cannot be typed into, and the scheme check belongs where the request is made.
 */
export const AZURE_OPENAI_ENDPOINT_SETTING: SettingDefinition<z.ZodString> = {
  id: AZURE_OPENAI_ENDPOINT_SETTING_ID,
  title: AI_AZURE_OPENAI_ENDPOINT_TITLE,
  schema: z.string(),
  fallback: '',
  category: 'ai',
};

/**
 * Anthropic's field, by name.
 *
 * Kept as its own export because `all.ts` named it before the other nine existed and
 * `ANTHROPIC_KEY_SETTING_ID` is the one id another feature already reads.
 */
export const ANTHROPIC_KEY_SETTING: SettingDefinition<z.ZodString> = keySetting('anthropic');

/** Which id that field carries, asserted where it is declared rather than assumed. */
export const ANTHROPIC_KEY_SETTING_FIELD_ID = ANTHROPIC_KEY_SETTING_ID;
