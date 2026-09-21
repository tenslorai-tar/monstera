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
      onDelta: (delta) => seen.push(delta),
      fetchImpl,
    });

    expect(sent[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(sent[0]?.headers['authorization']).toBe('Bearer k');
    expect(sent[0]?.body).toMatchObject({ model: 'm', stream: true, messages: [{ role: 'user', content: 'What is on page 2?' }] });
    expect(answer).toStrictEqual({ text: 'Page two.', stopped: false });
    // THE PIECES REACHED THE CALLER AS THEY ARRIVED, which is what makes the panel stream
    // rather than appear at the end.
    expect(seen).toStrictEqual(['Page ', 'two.']);
  });

  it('asks Anthropic in its own shape and reads content_block_delta', async () => {
    const { fetchImpl, sent } = streaming([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Yes"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);

    const answer = await streamChat({ provider: 'anthropic', model: 'claude-x', key: 'k', messages: ASK, fetchImpl });

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
      const answer = await streamChat({ ...request, fetchImpl });
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
      const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, fetchImpl });
      expect(answer).toStrictEqual({ text: '', stopped: false, refusal });
    });
  }

  it('names an Anthropic account out of credit, and only that', async () => {
    const credit = 'Your credit balance is too low to access the Anthropic API.';
    const answerTo = async (provider: 'anthropic' | 'openai', status: number, message: string) => {
      const fetchImpl = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status }),
        )) as unknown as typeof fetch;
      return (await streamChat({ provider, model: 'm', key: 'k', messages: ASK, fetchImpl })).refusal;
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

    const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, fetchImpl: broken });

    // THE WORDS A PERSON ALREADY READ ARE NOT TAKEN BACK.
    expect(answer).toStrictEqual({ text: 'half', stopped: false, refusal: 'unreadable' });
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
      signal: controller.signal,
      fetchImpl: aborting,
    });

    expect(answer).toStrictEqual({ text: '', stopped: true });
  });

  it('CONTROL: the same failure without an abort is unreachable, not stopped', async () => {
    const failing = (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch;

    const answer = await streamChat({ provider: 'openai', model: 'm', key: 'k', messages: ASK, fetchImpl: failing });

    expect(answer).toStrictEqual({ text: '', stopped: false, refusal: 'unreachable' });
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
      (provider) => prepareChat({ provider, model: 'm', key: 'k', messages: ASK })?.url,
    );
    expect(new Set(urls).size).toBe(urls.length);
  });
});
