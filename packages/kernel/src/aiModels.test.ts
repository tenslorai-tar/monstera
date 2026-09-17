import type { AiProviderId } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { PROVIDERS_WITHOUT_A_LIST, listModels, readModels } from './aiModels.js';

/**
 * The model catalogue, driven by a fetch of each case's own choosing (ADR-0081).
 *
 * The shapes below are the ones the providers answered when their endpoints were probed on
 * 2026-09-17; the failures are the ones they answer without a key.
 */

/** A fetch that records what it was asked and answers what the case says. */
function fetching(answer: { status: number; body?: unknown; throws?: boolean }): {
  readonly fetchImpl: typeof fetch;
  readonly asked: { url: string; headers: Record<string, string> }[];
} {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = ((url: string, init?: { headers?: Record<string, string> }) => {
    asked.push({ url, headers: init?.headers ?? {} });
    if (answer.throws === true) return Promise.reject(new Error('no network'));
    return Promise.resolve(
      new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe('listModels', () => {
  it('asks OpenAI-format providers with a bearer key and reads the ids out', async () => {
    const { fetchImpl, asked } = fetching({ status: 200, body: { data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] } });

    const list = await listModels({ provider: 'openai', key: 'sk-test', fetchImpl });

    expect(asked).toStrictEqual([
      { url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer sk-test' } },
    ]);
    expect(list.source).toBe('fetched');
    expect(list.models.map((entry) => entry.id)).toStrictEqual(['gpt-x', 'gpt-y']);
    // NOT A GUESS: a list endpoint says nothing about what a model can do.
    expect(list.models[0]?.capabilities).toStrictEqual({ vision: null, streaming: null });
  });

  it('asks Anthropic with its own header and takes the display name as the label', async () => {
    const { fetchImpl, asked } = fetching({
      status: 200,
      body: { data: [{ id: 'claude-x', display_name: 'Claude X' }] },
    });

    const list = await listModels({ provider: 'anthropic', key: 'k', fetchImpl });

    expect(asked[0]?.headers).toStrictEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(list.models).toStrictEqual([
      { id: 'claude-x', label: 'Claude X', capabilities: { vision: null, streaming: null } },
    ]);
  });

  it('asks Gemini with the key in the query and keeps the full name as the id', async () => {
    const { fetchImpl, asked } = fetching({ status: 200, body: { models: [{ name: 'models/gemini-x' }] } });

    const list = await listModels({ provider: 'gemini', key: 'a b', fetchImpl });

    expect(asked[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=a%20b');
    expect(list.models).toStrictEqual([
      { id: 'models/gemini-x', label: 'gemini-x', capabilities: { vision: null, streaming: null } },
    ]);
  });

  it('asks Azure OpenAI at the person’s own resource, with the api-key header', async () => {
    const { fetchImpl, asked } = fetching({ status: 200, body: { data: [{ id: 'my-deployment' }] } });

    const list = await listModels({
      provider: 'azure-openai',
      key: 'k',
      endpoint: 'https://mine.openai.azure.com/',
      fetchImpl,
    });

    expect(asked[0]?.url).toBe('https://mine.openai.azure.com/openai/models?api-version=2024-10-21');
    expect(asked[0]?.headers).toStrictEqual({ 'api-key': 'k' });
    expect(list.source).toBe('fetched');
  });

  it('CONTROL: Azure OpenAI with no resource address asks nothing', async () => {
    const { fetchImpl, asked } = fetching({ status: 200, body: { data: [{ id: 'x' }] } });

    const list = await listModels({ provider: 'azure-openai', key: 'k', endpoint: '', fetchImpl });

    expect(asked).toStrictEqual([]);
    expect(list.source).toBe('fallback');
  });

  it('asks nothing without a key, for any provider', async () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const { fetchImpl, asked } = fetching({ status: 200, body: { data: [{ id: 'x' }] } });
      const list = await listModels({ provider, key: '', fetchImpl });
      expect(asked).toStrictEqual([]);
      expect(list.source).not.toBe('fetched');
    }
  });

  it('names Perplexity as having no list, rather than asking a URL that 404s', async () => {
    const { fetchImpl, asked } = fetching({ status: 404 });

    const list = await listModels({ provider: 'perplexity', key: 'k', fetchImpl });

    expect(asked).toStrictEqual([]);
    expect(list.source).toBe('no-list');
    expect(PROVIDERS_WITHOUT_A_LIST).toStrictEqual(['perplexity']);
  });

  for (const [status, problem] of [
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [500, 'rejected'],
  ] as const) {
    it(`answers the fallback and names the problem for HTTP ${String(status)}`, async () => {
      const { fetchImpl } = fetching({ status, body: { error: 'no' } });

      const list = await listModels({ provider: 'anthropic', key: 'k', fetchImpl });

      expect(list.source).toBe('fallback');
      expect(list.problem).toBe(problem);
      // ANTHROPIC'S FALLBACK IS THE ONE MODEL THIS REPOSITORY HAS READ A SPECIFICATION FOR.
      expect(list.models.map((entry) => entry.id)).toStrictEqual(['claude-opus-5']);
    });
  }

  it('answers the fallback when the provider cannot be reached at all', async () => {
    const { fetchImpl } = fetching({ status: 200, throws: true });

    const list = await listModels({ provider: 'openai', key: 'k', fetchImpl });

    expect(list).toStrictEqual({ provider: 'openai', models: [], source: 'fallback', problem: 'unreachable' });
  });

  it('CONTROL: an EMPTY list is not a list, and is answered as a problem', async () => {
    // A picker with nothing in it reads as the feature being broken; the provider told us
    // nothing a person can choose.
    const { fetchImpl } = fetching({ status: 200, body: { data: [] } });

    const list = await listModels({ provider: 'openai', key: 'k', fetchImpl });

    expect(list.source).toBe('fallback');
    expect(list.problem).toBe('unreadable');
  });

  it('CONTROL: a 200 that is not the expected shape is unreadable, not an empty catalogue', async () => {
    const { fetchImpl } = fetching({ status: 200, body: { models: [{ name: 'models/x' }] } });

    const list = await listModels({ provider: 'openai', key: 'k', fetchImpl });

    expect(list.problem).toBe('unreadable');
  });
});

describe('readModels', () => {
  it('refuses a body that is not the shape, rather than answering nothing', () => {
    expect(readModels('openai-format', { models: [] })).toBeNull();
    expect(readModels('gemini', { data: [] })).toBeNull();
    expect(readModels('anthropic', 'a string')).toBeNull();
  });

  it('drops an entry with no id rather than inventing one', () => {
    expect(readModels('openai-format', { data: [{ id: 'a' }, { object: 'model' }] })?.map((m) => m.id)).toStrictEqual(['a']);
  });
});

describe('the provider set', () => {
  it('has a list endpoint for every provider but Perplexity and Azure’s person-supplied one', async () => {
    // A JOIN FROM THE OTHER SIDE: every provider is asked, so a provider added without an
    // endpoint shows up here rather than only where somebody happens to look.
    const providers: AiProviderId[] = [
      'anthropic', 'openai', 'gemini', 'mistral', 'xai', 'azure-openai', 'openrouter', 'groq', 'perplexity', 'deepseek',
    ];
    for (const provider of providers) {
      const { fetchImpl, asked } = fetching({ status: 200, body: { data: [{ id: 'x' }], models: [{ name: 'models/x' }] } });
      await listModels({ provider, key: 'k', endpoint: 'https://mine.openai.azure.com', fetchImpl });
      expect(asked.length === 1).toBe(provider !== 'perplexity');
    }
  });
});
