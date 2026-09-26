import { describe, expect, it } from 'vitest';

import { type ChatMessage, dataEvents, deltaOf, prepareChat, streamChat } from './aiChat.js';

/**
 * The chat adapters, driven by streams of each case's own making (ADR-0081).
 *
 * The event shapes are the providers' documented streaming forms, and the endpoints were
 * probed on 2026-09-17 — every case here asserts what is SENT as well as what is read,
 * because a request that reaches the wrong URL with the right body reads the same from
 * inside a fake as one that does not.
 */

const ASK: readonly ChatMessage[] = [{ role: 'user', text: 'What is on page 2?' }];

/** A fetch answering one server-sent-event stream, in chunks the case chooses. */
function streaming(chunks: readonly string[], status = 200): {
  readonly fetchImpl: typeof fetch;
  readonly sent: { url: string; headers: Record<string, string>; body: unknown }[];
} {
  const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = ((url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    sent.push({ url, headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    return Promise.resolve(new Response(status === 200 ? stream : 'no', { status }));
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

describe('streamChat', () => {
  it('asks an OpenAI-format provider and joins its deltas, in order', async () => {
    const { fetchImpl, sent } = streaming([
      'data: {"choices":[{"delta":{"content":"Page "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"two."}}]}\n\ndata: [DONE]\n\n',
    ]);
    const seen: string[] = [];

    const answer = await streamChat({
      provider: 'groq',
      model: 'm',
      key: 'k',
      messages: ASK,
      web: false,
      onDelta: (delta) => seen.push(delta),
      fetchImpl,
    });

    expect(sent[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(sent[0]?.headers['authorization']).toBe('Bearer k');
    expect(sent[0]?.body).toMatchObject({ model: 'm', stream: true, messages: [{ role: 'user', content: 'What is on page 2?' }] });
    expect(answer).toStrictEqual({ text: 'Page two.', stopped: false, searched: false, sources: [] });
    // THE PIECES REACHED THE CALLER AS THEY ARRIVED, which is what makes the panel stream
    // rather than appear at the end.
    expect(seen).toStrictEqual(['Page ', 'two.']);
  });

  it('asks Anthropic in its own shape and reads content_block_delta', async () => {
    const { fetchImpl, sent } = streaming([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Yes"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);

    const answer = await streamChat({ provider: 'anthropic', model: 'claude-x', key: 'k', messages: ASK, web: false, fetchImpl });

    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.headers['x-api-key']).toBe('k');
    expect(sent[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(answer.text).toBe('Yes');
  });

  it('asks Gemini with the key in the query, `model` as the role, and reads its parts', async () => {
    const { fetchImpl, sent } = streaming([
      'data: {"candidates":[{"content":{"parts":[{"text":"A"},{"text":"B"}]}}]}\n\n',
    ]);

    const answer = await streamChat({
      provider: 'gemini',
      model: 'models/gemini-x',
      key: 'k',
      messages: [...ASK, { role: 'assistant', text: 'earlier' }],
      web: false,
      fetchImpl,
    });

    expect(sent[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse&key=k');
    expect(sent[0]?.body).toMatchObject({ contents: [{ role: 'user' }, { role: 'model' }] });
    expect(answer.text).toBe('AB');
  });

  it('asks Azure OpenAI at the person’s deployment', async () => {
    const { fetchImpl, sent } = streaming(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n']);

    await streamChat({
      provider: 'azure-openai',
      model: 'my-deployment',
      key: 'k',
      endpoint: 'https://mine.openai.azure.com/',
      messages: ASK,
      web: false,
      fetchImpl,
    });

    expect(sent[0]?.url).toBe(
      'https://mine.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21',
    );
    expect(sent[0]?.headers['api-key']).toBe('k');
  });

  it('sends nothing without a key, a model, a message, or an Azure resource', async () => {
    for (const request of [
      { provider: 'openai' as const, model: 'm', key: '', messages: ASK },
      { provider: 'openai' as const, model: '', key: 'k', messages: ASK },
      { provider: 'openai' as const, model: 'm', key: 'k', messages: [] },
      { provider: 'azure-openai' as const, model: 'm', key: 'k', messages: ASK, endpoint: '' },
    ]) {
      const { fetchImpl, sent } = streaming([]);
      const answer = await streamChat({ ...request, web: false, fetchImpl });
      expect(sent).toStrictEqual([]);
      expect(answer.refusal).toBe('no-key');
    }
  });

  for (const [status, refusal] of [
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [500, 'rejected'],
  ] as const) {
    it(`names HTTP ${String(status)} as ${refusal}, with no text`, async () => {
      const { fetchImpl } = streaming([], status);
      const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, web: false, fetchImpl });
      expect(answer).toStrictEqual({ text: '', stopped: false, refusal, searched: false, sources: [] });
    });
  }

  it('names an Anthropic account out of credit, and only that', async () => {
    const credit = 'Your credit balance is too low to access the Anthropic API.';
    const answerTo = async (provider: 'anthropic' | 'openai', status: number, message: string) => {
      const fetchImpl = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status }),
        )) as unknown as typeof fetch;
      return (await streamChat({ provider, model: 'm', key: 'k', messages: ASK, web: false, fetchImpl })).refusal;
    };

    expect(await answerTo('anthropic', 400, credit)).toBe('out-of-credit');
    // CONTROLS, each the input the absent reading would also have to get right: Anthropic's
    // other 400, the same words behind a bad key, and the same words from another provider.
    expect(await answerTo('anthropic', 400, 'messages.0.content: Field required')).toBe('rejected');
    expect(await answerTo('anthropic', 401, credit)).toBe('unauthorised');
    expect(await answerTo('openai', 400, credit)).toBe('rejected');
  });

  it('KEEPS what streamed when the stream ends badly', async () => {
    const broken = ((url: string) => {
      void url;
      // THE CHUNK IS DELIVERED BEFORE THE FAILURE, which needs two pulls: `error()` called
      // in `start` discards what was queued, and the case would then prove nothing about
      // text that had already reached the caller.
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"half"}}]}\n\n'));
            return;
          }
          controller.error(new Error('the connection dropped'));
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }) as unknown as typeof fetch;

    const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, web: false, fetchImpl: broken });

    // THE WORDS A PERSON ALREADY READ ARE NOT TAKEN BACK.
    expect(answer).toStrictEqual({ text: 'half', stopped: false, refusal: 'unreadable', searched: false, sources: [] });
  });

  it('answers STOPPED, not failed, when the caller aborts before the first byte', async () => {
    const controller = new AbortController();
    const aborting = (() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }) as unknown as typeof fetch;

    const answer = await streamChat({
      provider: 'openai',
      model: 'm',
      key: 'k',
      messages: ASK,
      web: false,
      signal: controller.signal,
      fetchImpl: aborting,
    });

    expect(answer).toStrictEqual({ text: '', stopped: true, searched: false, sources: [] });
  });

  it('CONTROL: the same failure without an abort is unreachable, not stopped', async () => {
    const failing = (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch;

    const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, web: false, fetchImpl: failing });

    expect(answer).toStrictEqual({ text: '', stopped: false, refusal: 'unreachable', searched: false, sources: [] });
  });
});

describe('dataEvents', () => {
  it('joins a payload split across chunk boundaries', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choi'));
        controller.enqueue(new TextEncoder().encode('ces":[{"delta":{"content":"x"}}]}\n\n'));
        controller.close();
      },
    });

    const events: string[] = [];
    for await (const data of dataEvents(stream)) events.push(data);

    expect(events).toStrictEqual(['{"choices":[{"delta":{"content":"x"}}]}']);
  });

  it('yields a last payload with no trailing newline', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}'));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const data of dataEvents(stream)) events.push(data);
    expect(events).toStrictEqual(['{"a":1}']);
  });
});

describe('deltaOf', () => {
  it('skips what is not JSON and what is not this shape, rather than throwing', () => {
    expect(deltaOf('openai-format', 'not json')).toBe('');
    expect(deltaOf('openai-format', '[DONE]')).toBe('');
    expect(deltaOf('openai-format', '{"candidates":[]}')).toBe('');
    expect(deltaOf('anthropic', '{"type":"message_start"}')).toBe('');
  });
});

describe('prepareChat', () => {
  it('CONTROL: each shape produces a DIFFERENT url, so a provider cannot be asked at another’s', () => {
    const urls = (['openai', 'anthropic', 'gemini', 'deepseek'] as const).map(
      (provider) => prepareChat({ provider, model: 'm', key: 'k', messages: ASK, web: false })?.url,
    );
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('carries a document instruction in each shape’s own place (ADR-0088)', () => {
    const system = '[Page 1]\nthe window';
    const body = (provider: 'anthropic' | 'gemini' | 'openai') =>
      JSON.parse(prepareChat({ provider, model: 'm', key: 'k', messages: ASK, system, web: false })?.body ?? '{}') as Record<
        string,
        unknown
      >;

    expect(body('anthropic')['system']).toBe(system);
    expect(body('gemini')['systemInstruction']).toStrictEqual({ parts: [{ text: system }] });
    const openAi = body('openai')['messages'] as { role: string; content: string }[];
    expect(openAi[0]).toStrictEqual({ role: 'system', content: system });
    // THE CONVERSATION FOLLOWS IT, unmoved: an instruction that replaced the first turn
    // would pass every assertion above.
    expect(openAi[1]).toStrictEqual({ role: 'user', content: 'What is on page 2?' });
  });

  it('CONTROL: with no instruction, or an empty one, no shape carries the field', () => {
    for (const system of [undefined, ''] as const) {
      for (const provider of ['anthropic', 'gemini', 'openai'] as const) {
        const request = prepareChat({
          provider,
          model: 'm',
          key: 'k',
          messages: ASK,
          web: false,
          ...(system === undefined ? {} : { system }),
        });
        const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>;
        expect(body['system'], provider).toBeUndefined();
        expect(body['systemInstruction'], provider).toBeUndefined();
        if (provider === 'openai') expect((body['messages'] as unknown[]).length).toBe(1);
      }
    }
  });

  describe('a picture of a page (ADR-0090)', () => {
    /** Two turns before the one asking, so "the last user turn" is not also the first. */
    const TALK = [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi' },
      { role: 'user', text: 'Read the table' },
    ] as const;
    const image = { mediaType: 'image/png', base64: 'iVBORw0KGgo=' } as const;
    const body = (provider: 'anthropic' | 'gemini' | 'openai', withImage: boolean) =>
      JSON.parse(
        prepareChat({ provider, model: 'm', key: 'k', messages: TALK, web: false, ...(withImage ? { image } : {}) })?.body ??
          '{}',
      ) as Record<string, unknown>;

    it('rides on the LAST user turn in each shape’s own form, and earlier turns stay text', () => {
      const anthropic = body('anthropic', true)['messages'] as { content: unknown }[];
      expect(anthropic[0]?.content).toBe('Hello');
      expect(anthropic[2]?.content).toStrictEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        { type: 'text', text: 'Read the table' },
      ]);

      const gemini = body('gemini', true)['contents'] as { parts: unknown }[];
      expect(gemini[0]?.parts).toStrictEqual([{ text: 'Hello' }]);
      expect(gemini[2]?.parts).toStrictEqual([
        { inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' } },
        { text: 'Read the table' },
      ]);

      const openAi = body('openai', true)['messages'] as { content: unknown }[];
      expect(openAi[0]?.content).toBe('Hello');
      expect(openAi[2]?.content).toStrictEqual([
        { type: 'text', text: 'Read the table' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ]);
    });

    it('CONTROL: with no picture every turn is plain text in every shape', () => {
      expect((body('anthropic', false)['messages'] as { content: unknown }[])[2]?.content).toBe('Read the table');
      expect((body('gemini', false)['contents'] as { parts: unknown }[])[2]?.parts).toStrictEqual([{ text: 'Read the table' }]);
      expect((body('openai', false)['messages'] as { content: unknown }[])[2]?.content).toBe('Read the table');
    });
  });
});

describe('the web, each provider’s own search (ADR-0108)', () => {
  /** A server-sent event line for one JSON payload. */
  const event = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

  it('ANTHROPIC: sends its search tool only with the web on, and reads the search, the text and the citation', async () => {
    const { fetchImpl, sent } = streaming([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' } }),
      event({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            { type: 'web_search_result', url: 'https://example.org/a', title: 'Found A' },
            // HTTP IS DROPPED: the one route that opens a source refuses anything but HTTPS.
            { type: 'web_search_result', url: 'http://example.org/b', title: 'Found B' },
          ],
        },
      }),
      event({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'It was 1912.' } }),
      event({
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'citations_delta',
          citation: { type: 'web_search_result_location', url: 'https://example.org/cited', title: 'Cited page', cited_text: '1912' },
        },
      }),
      event({ type: 'message_delta', usage: { server_tool_use: { web_search_requests: 1 } } }),
    ]);

    const answer = await streamChat({ provider: 'anthropic', model: 'claude-haiku-4-5', key: 'k', messages: ASK, web: true, fetchImpl });

    expect((sent[0]?.body as { tools?: unknown }).tools).toStrictEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
    // THE CITED PAGE, not the two found: an answer that cited something shows what it cited.
    expect(answer).toStrictEqual({
      text: 'It was 1912.',
      stopped: false,
      searched: true,
      sources: [{ url: 'https://example.org/cited', title: 'Cited page' }],
    });
  });

  it('ANTHROPIC: a search that cited nothing still shows what it found, and HTTPS only', async () => {
    const { fetchImpl } = streaming([
      event({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'web_search_tool_result',
          content: [
            { type: 'web_search_result', url: 'https://example.org/a', title: 'Found A' },
            { type: 'web_search_result', url: 'http://example.org/b', title: 'Found B' },
          ],
        },
      }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Not in the document.' } }),
    ]);
    const answer = await streamChat({ provider: 'anthropic', model: 'm', key: 'k', messages: ASK, web: true, fetchImpl });
    expect(answer.sources).toStrictEqual([{ url: 'https://example.org/a', title: 'Found A' }]);
    expect(answer.searched).toBe(true);
  });

  it('ANTHROPIC: text after a SEARCH starts a new paragraph, and CONTROL: text split at a citation joins as it came', async () => {
    // THE LIVE RUN'S ORDER (2026-09-26): a text block, the search, then text blocks split at a citation boundary.
    const { fetchImpl } = streaming([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will search.' } }),
      event({ type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search' } }),
      event({ type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', content: [] } }),
      event({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }),
      event({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Joseph Strauss' } }),
      event({ type: 'content_block_start', index: 4, content_block: { type: 'text', text: '' } }),
      event({ type: 'content_block_delta', index: 4, delta: { type: 'text_delta', text: ' was the engineer.' } }),
    ]);
    const answer = await streamChat({ provider: 'anthropic', model: 'm', key: 'k', messages: ASK, web: true, fetchImpl });
    expect(answer.text).toBe('I will search.\n\nJoseph Strauss was the engineer.');
  });

  it('CONTROL: with the web off Anthropic is sent no tool, and an ordinary answer reports nothing searched', async () => {
    const { fetchImpl, sent } = streaming([event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Yes' } })]);
    const answer = await streamChat({ provider: 'anthropic', model: 'm', key: 'k', messages: ASK, web: false, fetchImpl });
    expect((sent[0]?.body as { tools?: unknown }).tools).toBeUndefined();
    expect(answer).toStrictEqual({ text: 'Yes', stopped: false, searched: false, sources: [] });
  });

  it('OPENAI and xAI search through the RESPONSES API, and xAI’s numbered title becomes the host', async () => {
    const stream = [
      event({ type: 'response.output_item.added', item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' } }),
      event({ type: 'response.output_text.delta', delta: 'Paris' }),
      event({
        type: 'response.output_text.annotation.added',
        annotation: { type: 'url_citation', url: 'https://example.org/paris', title: '1', start_index: 0, end_index: 5 },
      }),
    ];
    for (const [provider, url, title] of [
      ['openai', 'https://api.openai.com/v1/responses', 'example.org'],
      ['xai', 'https://api.x.ai/v1/responses', 'example.org'],
    ] as const) {
      const { fetchImpl, sent } = streaming(stream);
      const answer = await streamChat({ provider, model: 'm', key: 'k', messages: ASK, system: 'the window', web: true, fetchImpl });
      expect(sent[0]?.url, provider).toBe(url);
      expect(sent[0]?.body, provider).toMatchObject({
        model: 'm',
        stream: true,
        instructions: 'the window',
        input: [{ role: 'user', content: 'What is on page 2?' }],
        tools: [{ type: 'web_search' }],
      });
      expect(answer, provider).toStrictEqual({
        text: 'Paris',
        stopped: false,
        searched: true,
        sources: [{ url: 'https://example.org/paris', title }],
      });
    }
  });

  it('AZURE OPENAI searches at the person’s resource’s Responses address, with its own key header', async () => {
    const { fetchImpl, sent } = streaming([event({ type: 'response.output_text.delta', delta: 'x' })]);
    await streamChat({
      provider: 'azure-openai',
      model: 'my-deployment',
      key: 'k',
      endpoint: 'https://mine.openai.azure.com/',
      messages: ASK,
      web: true,
      fetchImpl,
    });
    expect(sent[0]?.url).toBe('https://mine.openai.azure.com/openai/v1/responses');
    expect(sent[0]?.headers['api-key']).toBe('k');
    expect(sent[0]?.body).toMatchObject({ model: 'my-deployment', tools: [{ type: 'web_search' }] });
  });

  it('MISTRAL searches through CONVERSATIONS, stores nothing there, and reads a tool reference as a citation', async () => {
    const { fetchImpl, sent } = streaming([
      event({ type: 'tool.execution.started', id: 't1', name: 'web_search', arguments: '{}' }),
      event({
        type: 'message.output.delta',
        content: [
          { type: 'text', text: 'Rome' },
          { type: 'tool_reference', tool: 'web_search', title: 'Rome page', url: 'https://example.org/rome' },
        ],
      }),
    ]);
    const answer = await streamChat({ provider: 'mistral', model: 'mistral-medium-latest', key: 'k', messages: ASK, web: true, fetchImpl });
    expect(sent[0]?.url).toBe('https://api.mistral.ai/v1/conversations');
    expect(sent[0]?.body).toMatchObject({ store: false, tools: [{ type: 'web_search' }], inputs: [{ role: 'user' }] });
    expect(answer).toStrictEqual({
      text: 'Rome',
      stopped: false,
      searched: true,
      sources: [{ url: 'https://example.org/rome', title: 'Rome page' }],
    });
  });

  it('CONTROL: with the web off, OpenAI, xAI and Mistral are asked at their ordinary chat address', () => {
    for (const provider of ['openai', 'xai', 'mistral'] as const) {
      const request = prepareChat({ provider, model: 'm', key: 'k', messages: ASK, web: false });
      expect(request?.url, provider).toMatch(/\/chat\/completions$/u);
      expect((JSON.parse(request?.body ?? '{}') as { tools?: unknown }).tools, provider).toBeUndefined();
    }
  });

  it('OPENROUTER adds its server tool and reads the NESTED url_citation', async () => {
    const { fetchImpl, sent } = streaming([
      event({ choices: [{ delta: { content: 'Oslo' } }] }),
      event({
        choices: [
          {
            delta: {
              annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org/oslo', title: 'Oslo page' } }],
            },
          },
        ],
      }),
    ]);
    const answer = await streamChat({ provider: 'openrouter', model: 'm', key: 'k', messages: ASK, web: true, fetchImpl });
    expect((sent[0]?.body as { tools?: unknown }).tools).toStrictEqual([
      { type: 'openrouter:web_search', parameters: { max_results: 5 } },
    ]);
    expect(answer.sources).toStrictEqual([{ url: 'https://example.org/oslo', title: 'Oslo page' }]);
    expect(answer.searched).toBe(true);
  });

  it('PERPLEXITY searches by default, so DOCUMENT ONLY is the request that must turn it off', () => {
    const bodyWith = (web: boolean): Record<string, unknown> =>
      JSON.parse(prepareChat({ provider: 'perplexity', model: 'sonar', key: 'k', messages: ASK, web })?.body ?? '{}') as Record<
        string,
        unknown
      >;
    const off = bodyWith(false);
    const on = bodyWith(true);
    expect(off).toMatchObject({ disable_search: true });
    expect(on['disable_search']).toBeUndefined();
  });

  it('PERPLEXITY’s search results are the sources', async () => {
    const { fetchImpl } = streaming([
      event({ choices: [{ delta: { content: 'x' } }], search_results: [{ title: 'Result', url: 'https://example.org/r' }] }),
    ]);
    const answer = await streamChat({ provider: 'perplexity', model: 'sonar', key: 'k', messages: ASK, web: true, fetchImpl });
    expect(answer.sources).toStrictEqual([{ url: 'https://example.org/r', title: 'Result' }]);
    expect(answer.searched).toBe(true);
  });

  it('GROQ sends its browser search only to a model that takes it', () => {
    const tools = (model: string) =>
      (JSON.parse(prepareChat({ provider: 'groq', model, key: 'k', messages: ASK, web: true })?.body ?? '{}') as { tools?: unknown })
        .tools;
    expect(tools('openai/gpt-oss-120b')).toStrictEqual([{ type: 'browser_search' }]);
    // CONTROL: another Groq model is asked without it, and its answer will say nothing was searched.
    expect(tools('llama-3.3-70b-versatile')).toBeUndefined();
  });

  it('GEMINI and DEEPSEEK are asked the ordinary way even with the web on — neither can search here', () => {
    for (const provider of ['gemini', 'deepseek'] as const) {
      const body = JSON.parse(prepareChat({ provider, model: 'm', key: 'k', messages: ASK, web: true })?.body ?? '{}') as Record<
        string,
        unknown
      >;
      expect(body['tools'], provider).toBeUndefined();
    }
  });

  it('DOCUMENT ONLY never reaches a model that always searches — refused before anything is sent', async () => {
    const { fetchImpl, sent } = streaming([event({ choices: [{ delta: { content: 'x' } }] })]);
    const refused = await streamChat({ provider: 'openai', model: 'gpt-5-search-api', key: 'k', messages: ASK, web: false, fetchImpl });
    expect(sent).toStrictEqual([]);
    expect(refused).toStrictEqual({ text: '', stopped: false, refusal: 'searches-the-web', searched: false, sources: [] });

    // CONTROL: the same model with the web on is asked — the refusal is the switch's, not the model's.
    const asked = await streamChat({ provider: 'openai', model: 'gpt-5-search-api', key: 'k', messages: ASK, web: true, fetchImpl });
    expect(sent).toHaveLength(1);
    expect(asked.refusal).toBeUndefined();
  });
});
