import {
  AI_PROVIDERS,
  AI_MODELS_STORED,
  AI_PROVIDER_IDS,
  AI_PROVIDER_SETTING_ID,
  AI_SETUP_AT_START_SETTING_ID,
  type AiProviderId,
  ANTHROPIC_KEY_SETTING_ID,
  AZURE_OPENAI_ENDPOINT_STORED,
  CHAT_HISTORY_STORED,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { z } from 'zod';

import {
  AI_MODELS_DESCRIPTION,
  AI_MODELS_TITLE,
  AI_PROVIDER_DESCRIPTION,
  AI_PROVIDER_NAMES,
  AI_PROVIDER_TITLE,
  AI_ANTHROPIC_KEY_TITLE,
  AI_AZURE_OPENAI_ENDPOINT_DESCRIPTION,
  AI_AZURE_OPENAI_ENDPOINT_TITLE,
  AI_AZURE_OPENAI_KEY_TITLE,
  AI_DEEPSEEK_KEY_TITLE,
  AI_GEMINI_KEY_TITLE,
  AI_GROQ_KEY_TITLE,
  AI_MISTRAL_KEY_TITLE,
  AI_OPENAI_KEY_TITLE,
  AI_OPENROUTER_KEY_TITLE,
  AI_PERPLEXITY_KEY_TITLE,
  AI_SAVE_HISTORY_DESCRIPTION,
  AI_SAVE_HISTORY_TITLE,
  AI_SETUP_AT_START_DESCRIPTION,
  AI_SETUP_AT_START_TITLE,
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
 * cannot be typed into, and the address check belongs where the request is made: `serviceOrigin`, in `main`,
 * before the key is sent.
 */
export const AZURE_OPENAI_ENDPOINT_SETTING: SettingDefinition<z.ZodString> = {
  // THE ID, SCHEMA AND DEFAULT ARE THE CONTRACT'S, which `main` reads through too (`storedSettings.ts`).
  ...AZURE_OPENAI_ENDPOINT_STORED,
  title: AI_AZURE_OPENAI_ENDPOINT_TITLE,
  description: AI_AZURE_OPENAI_ENDPOINT_DESCRIPTION,
  category: 'ai',
  // AN ADDRESS, read whole (ADR-0157).
  runsLong: true,
};

/**
 * Whether the first-run AI setup is offered when the application starts (BUILD-PROMPT E5's
 * onboarding step).
 *
 * **A person's setting rather than a hidden flag**: *Skip* and a key that checks out both turn it
 * off, and a person who skipped can turn it back on here, or run *Set up AI…* at any time. The
 * setup is offered only while no provider's key is stored, so a person who added one in Settings
 * is not asked again.
 */
/**
 * The provider the Assistant asks — Part F's *"AI: provider"* ([ADR-0117](../../../../docs/DECISIONS/0117-an-ai-model-is-chosen-per-provider-from-the-fetched-list.md)
 * Decision 1). Anthropic by default, as the Assistant has opened on since ADR-0081. Its picker and this row write the
 * same value, so a choice made in either is the other's.
 */
export const AI_PROVIDER_SETTING: SettingDefinition<z.ZodEnum<{ [K in AiProviderId]: K }>> = {
  id: AI_PROVIDER_SETTING_ID,
  title: AI_PROVIDER_TITLE,
  description: AI_PROVIDER_DESCRIPTION,
  schema: z.enum(AI_PROVIDER_IDS),
  fallback: 'anthropic',
  category: 'ai',
  optionTitles: AI_PROVIDER_NAMES,
};

/**
 * One chosen model id per provider (ADR-0117 Decision 2), written by the Assistant's model picker and by the Settings
 * row — only when a person chooses, so an updated list moves the default (`defaultModel`) with it. `main` reads
 * Anthropic's entry for the Claude recogniser whatever the Assistant is on. Bounded by the contract's `MAX_MODEL_ID`,
 * the bound every list that offers an id is held to.
 *
 * **Its control is DECLARED** (`ai-models`, Decision 3): no schema shape says *a model per provider, chosen from a
 * list*, and the row lists what `main` already holds rather than anything fetched on open (the correction of
 * 2026-09-28), because the dialog is props-only (ADR-0038).
 */
export const AI_MODELS_SETTING: SettingDefinition<(typeof AI_MODELS_STORED)['schema']> = {
  // THE ID, SCHEMA AND DEFAULT ARE THE CONTRACT'S, which `main` reads through too (`storedSettings.ts`).
  ...AI_MODELS_STORED,
  title: AI_MODELS_TITLE,
  description: AI_MODELS_DESCRIPTION,
  category: 'ai',
  control: 'ai-models',
};

export const AI_SETUP_AT_START_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: AI_SETUP_AT_START_SETTING_ID,
  title: AI_SETUP_AT_START_TITLE,
  description: AI_SETUP_AT_START_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'ai',
};

/**
 * Whether assistant conversations are saved between sessions
 * ([ADR-0093](../../../../docs/DECISIONS/0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md)).
 * **Off by default**, the owner's specification; `main` reads the same id on every save and refuses
 * while it is off, so this control is the choice and not the enforcement.
 */
export const CHAT_HISTORY_SETTING: SettingDefinition<z.ZodBoolean> = {
  // THE ID, SCHEMA AND DEFAULT ARE THE CONTRACT'S, which `main` reads through too (`storedSettings.ts`).
  ...CHAT_HISTORY_STORED,
  title: AI_SAVE_HISTORY_TITLE,
  description: AI_SAVE_HISTORY_DESCRIPTION,
  // THE CONVERSATIONS ARE ENCRYPTED with the keys' cipher (ADR-0093), so a machine that cannot keep
  // a key cannot keep a conversation either, and the switch says so rather than reading ON.
  needsSecureStorage: true,
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
