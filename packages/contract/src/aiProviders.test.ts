import { describe, expect, it } from 'vitest';

import {
  AI_KEY_PAGES,
  AI_KEY_PAGE_OF,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_KEY_SETTING_IDS,
  ANTHROPIC_KEY_SETTING_ID,
  AZURE_OPENAI_ENDPOINT_SETTING_ID,
  type AiModel,
  defaultModel,
  servesVision,
  webSearchOf,
} from './aiProviders.js';
import { SECRET_SETTING_IDS } from './schemas.js';

/**
 * The registry against the lists that must agree with it (ADR-0081).
 *
 * The key list is written out and the table is written out, so these cases hold them
 * equal **as sets, from both sides**: iterating one would make it the universe, and a
 * provider missing from either would be invisible from the other.
 */

describe('the AI provider registry', () => {
  it('is the owner’s ten, each declared once', () => {
    expect(AI_PROVIDER_IDS).toHaveLength(10);
    expect(new Set(AI_PROVIDER_IDS).size).toBe(10);
    for (const id of AI_PROVIDER_IDS) expect(AI_PROVIDERS[id].id).toBe(id);
  });

  it('gives each provider its own key setting, and the key list names exactly those', () => {
    const fromTable = AI_PROVIDER_IDS.map((id) => AI_PROVIDERS[id].keySetting);
    expect(new Set(fromTable).size).toBe(fromTable.length);
    // BOTH DIRECTIONS: a key the list holds and the table does not is as much a defect
    // as the other way round.
    expect(new Set(fromTable)).toStrictEqual(new Set(AI_PROVIDER_KEY_SETTING_IDS));
    expect(AI_PROVIDER_KEY_SETTING_IDS).toHaveLength(AI_PROVIDER_IDS.length);
  });

  it('gives each provider its own key page, and the page list names exactly those (ADR-0184)', () => {
    const fromTable = AI_PROVIDER_IDS.map((id) => AI_KEY_PAGE_OF[id]);
    expect(new Set(fromTable).size).toBe(AI_PROVIDER_IDS.length);
    // BOTH DIRECTIONS, for the key list's reason.
    expect(new Set(fromTable)).toStrictEqual(new Set(AI_KEY_PAGES));
    for (const id of AI_PROVIDER_IDS) expect(AI_KEY_PAGE_OF[id]).toBe(`ai-key-${id}`);
  });

  it('keeps Anthropic on the id D6 already placed', () => {
    expect(AI_PROVIDERS.anthropic.keySetting).toBe(ANTHROPIC_KEY_SETTING_ID);
    expect(ANTHROPIC_KEY_SETTING_ID).toBe('ai.anthropic-key');
  });

  it('makes every provider key a secret the Settings dialog can save', () => {
    for (const key of AI_PROVIDER_KEY_SETTING_IDS) {
      expect(SECRET_SETTING_IDS).toContain(key);
    }
  });

  it('CONTROL: the endpoint setting is NOT a secret — it is an address, and it is Azure OpenAI’s alone', () => {
    expect(SECRET_SETTING_IDS).not.toContain(AZURE_OPENAI_ENDPOINT_SETTING_ID);
    const withEndpoint = AI_PROVIDER_IDS.filter((id) => AI_PROVIDERS[id].endpointSetting !== undefined);
    expect(withEndpoint).toStrictEqual(['azure-openai']);
  });

  it('speaks three request shapes, and eight of the ten share one adapter', () => {
    const shapes = AI_PROVIDER_IDS.map((id) => AI_PROVIDERS[id].adapter);
    expect(new Set(shapes)).toStrictEqual(new Set(['openai-format', 'anthropic', 'gemini']));
    expect(shapes.filter((shape) => shape === 'openai-format')).toHaveLength(8);
  });
});

describe('webSearchOf — which provider and model can search the web (ADR-0108)', () => {
  it('reads each provider’s documented search, one row per provider, WRITTEN OUT', () => {
    // A LITERAL, not a loop over the table: the danger is a provider quietly moved from `none` to `optional`, and a
    // derived expectation would agree with the move.
    const answers = Object.fromEntries(AI_PROVIDER_IDS.map((id) => [id, webSearchOf(id, 'some-model').kind]));
    expect(answers).toStrictEqual({
      anthropic: 'optional',
      openai: 'optional',
      gemini: 'none',
      mistral: 'optional',
      xai: 'optional',
      'azure-openai': 'optional',
      openrouter: 'optional',
      groq: 'none',
      perplexity: 'optional',
      deepseek: 'none',
    });
  });

  it('names why a provider cannot, which is the sentence the switch shows', () => {
    expect(webSearchOf('gemini', 'gemini-3-pro')).toStrictEqual({ kind: 'none', reason: 'display-terms' });
    expect(webSearchOf('deepseek', 'deepseek-chat')).toStrictEqual({ kind: 'none', reason: 'no-hosted-search' });
    expect(webSearchOf('groq', 'llama-3.3-70b-versatile')).toStrictEqual({ kind: 'none', reason: 'model-cannot' });
  });

  it('knows the models that ALWAYS search, and CONTROL: their neighbours do not', () => {
    expect(webSearchOf('openai', 'gpt-5-search-api').kind).toBe('always');
    expect(webSearchOf('openai', 'gpt-4o-mini-search-preview').kind).toBe('always');
    expect(webSearchOf('perplexity', 'sonar-deep-research').kind).toBe('always');
    expect(webSearchOf('openai', 'gpt-5.5').kind).toBe('optional');
    expect(webSearchOf('perplexity', 'sonar-pro').kind).toBe('optional');
    expect(webSearchOf('groq', 'openai/gpt-oss-20b').kind).toBe('optional');
  });
});

describe('the default model (ADR-0117 Decision 5)', () => {
  const model = (id: string, vision: boolean | null): AiModel => ({
    id,
    label: id,
    capabilities: { vision, streaming: null },
  });

  it('is the first listed model the use can take — skipping one that SAYS it has no vision, for a use that reads images', () => {
    const list = [model('text-only', false), model('unknown', null), model('sees', true)];
    // THE SEPARATING LIST: its first entry is refused for vision and taken for text, so a rule ignoring the use
    // answers `text-only` both times.
    expect(defaultModel(list, { vision: true })?.id).toBe('unknown');
    expect(defaultModel(list, { vision: false })?.id).toBe('text-only');
  });

  it('offers a model whose capabilities are UNKNOWN, since a list endpoint describes none', () => {
    expect(servesVision(model('fetched', null))).toBe(true);
    expect(servesVision(model('said-no', false))).toBe(false);
  });

  it('answers undefined when nothing listed can serve — never a model the use cannot take', () => {
    expect(defaultModel([model('text-only', false)], { vision: true })).toBeUndefined();
    expect(defaultModel([], { vision: false })).toBeUndefined();
  });
});
