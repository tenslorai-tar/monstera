/**
 * The AI providers this build talks to, and the key each one's credential is stored
 * under — **the owner's design, 2026-09-15**.
 *
 * ## Ten, and no eleventh a person can type in
 *
 * No local models and no custom endpoint: a provider is one of these ten or it is not
 * reachable. What that gives up is stated rather than discovered — somebody running a
 * model on their own machine, or a gateway of their own, cannot use the assistant — and
 * what it buys is that every request in this application goes to a service this build
 * names, whose address is not a string a document or a setting can move.
 *
 * ## Three adapters, not ten
 *
 * Eight of the ten speak the OpenAI chat-completions shape, so one adapter serves them
 * and differs only in where it points and which key it sends. Anthropic and Gemini have
 * their own request shapes and their own adapters. **Azure OpenAI is OpenAI-format and
 * still not OpenAI**: its address is the person's own resource, so it carries an endpoint
 * setting beside its key, exactly as Azure Document Intelligence does (D6).
 *
 * ## One key per provider, under this id
 *
 * Every id here is a secret setting, write-only in the Settings dialog (ADR-0056), and
 * `SECRET_SETTING_IDS` is derived from this table rather than restated: a provider added
 * without a stored key would otherwise be a provider whose key nothing can save.
 * **Anthropic keeps `ai.anthropic-key`**, the id D6's Claude recogniser already placed
 * (ADR-0057 Decision 5), because two ids would be two copies of one credential and
 * rotating one would leave the other working on the old one.
 */

/** One provider's declaration. `endpointSetting` is present only where the address is the person's. */
export interface AiProvider {
  readonly id: AiProviderId;
  /** The secret setting the key is stored under. */
  readonly keySetting: `ai.${string}-key`;
  /** Which request shape it speaks. */
  readonly adapter: 'openai-format' | 'anthropic' | 'gemini';
  /** A non-secret setting holding the person's own resource address, where there is one. */
  readonly endpointSetting?: 'ai.azure-openai-endpoint';
}

export const AI_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'mistral',
  'xai',
  'azure-openai',
  'openrouter',
  'groq',
  'perplexity',
  'deepseek',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Azure OpenAI's resource address — the person's own, like Azure Document Intelligence's. */
export const AZURE_OPENAI_ENDPOINT_SETTING_ID = 'ai.azure-openai-endpoint';

/**
 * Whether assistant conversations are saved (ADR-0093) — off unless a person turns it on. Named here
 * because `main` reads it on every save and the renderer declares its control: one id, two readers.
 */
export const CHAT_HISTORY_SETTING_ID = 'ai.save-history';

/**
 * The Anthropic API key — the PROVIDER's key, not a recogniser's
 * ([ADR-0057](../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)
 * Decision 5). D6's Claude recogniser placed it on 2026-09-13 and reads it by name;
 * this table takes that id rather than minting a second one, and `schemas.ts` re-exports
 * it so every existing reader is unmoved.
 *
 * **It lives here, with the table, since 2026-09-17**: the other nine ids are declared
 * below, and a tenth spelt in another module is the second opinion B3a is about.
 */
export const ANTHROPIC_KEY_SETTING_ID = 'ai.anthropic-key';

/**
 * Every provider's key setting, in the table's order, as literals.
 *
 * **Written out rather than mapped from {@link AI_PROVIDERS}.** The failure this list
 * guards against makes it SMALLER — a provider whose key nothing stores — and a list
 * computed from the table would agree with any omission. `aiProviders.test.ts` holds the
 * two equal as sets, so the pair catches both directions.
 */
export const AI_PROVIDER_KEY_SETTING_IDS = [
  ANTHROPIC_KEY_SETTING_ID,
  'ai.openai-key',
  'ai.gemini-key',
  'ai.mistral-key',
  'ai.xai-key',
  'ai.azure-openai-key',
  'ai.openrouter-key',
  'ai.groq-key',
  'ai.perplexity-key',
  'ai.deepseek-key',
] as const;

export const AI_PROVIDERS: Readonly<Record<AiProviderId, AiProvider>> = {
  anthropic: { id: 'anthropic', keySetting: ANTHROPIC_KEY_SETTING_ID, adapter: 'anthropic' },
  openai: { id: 'openai', keySetting: 'ai.openai-key', adapter: 'openai-format' },
  gemini: { id: 'gemini', keySetting: 'ai.gemini-key', adapter: 'gemini' },
  mistral: { id: 'mistral', keySetting: 'ai.mistral-key', adapter: 'openai-format' },
  xai: { id: 'xai', keySetting: 'ai.xai-key', adapter: 'openai-format' },
  'azure-openai': {
    id: 'azure-openai',
    keySetting: 'ai.azure-openai-key',
    adapter: 'openai-format',
    endpointSetting: AZURE_OPENAI_ENDPOINT_SETTING_ID,
  },
  openrouter: { id: 'openrouter', keySetting: 'ai.openrouter-key', adapter: 'openai-format' },
  groq: { id: 'groq', keySetting: 'ai.groq-key', adapter: 'openai-format' },
  perplexity: { id: 'perplexity', keySetting: 'ai.perplexity-key', adapter: 'openai-format' },
  deepseek: { id: 'deepseek', keySetting: 'ai.deepseek-key', adapter: 'openai-format' },
};

/**
 * What a model can be asked to do.
 *
 * **Flags rather than a tier**, because the answer is per model and not per provider: one
 * provider's list holds models that read images and models that cannot. A surface shows
 * what a model cannot do as **disabled**, never by dropping it from the list — a person
 * who cannot find a model they know exists has no way to tell a filtered list from a
 * broken one.
 */
export interface AiModelCapabilities {
  /**
   * Accepts images in the request — what a page picture needs. **`null` is *the provider
   * did not say*,** which is the usual answer: a model list names ids and rarely says what
   * each can do. A surface offers an unknown as an ordinary choice and marks nothing; it
   * disables only what a provider has actually said it cannot do, because a guess shown as
   * a fact is worse than an unmarked model.
   */
  readonly vision: boolean | null;
  /** Answers as it goes, rather than in one piece. `null` for the reason above. */
  readonly streaming: boolean | null;
}

/** One model, as a surface names it. */
export interface AiModel {
  readonly id: string;
  readonly label: string;
  readonly capabilities: AiModelCapabilities;
}
