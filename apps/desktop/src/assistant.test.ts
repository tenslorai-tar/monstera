import { MAX_EVENT_TEXT } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { KEPT_ANSWERS, createAssistant, splitDelta } from './assistant.js';

/**
 * The assistant in `main`, driven by a provider of each case's own making (ADR-0081,
 * ADR-0082). Every case asserts the EVENTS that reached the renderer, because that is what
 * a person sees; the promise `ask` answers says only that the request started.
 */

/** A fetch that streams the pieces a case gives it, and records what it was sent. */
function provider(pieces: string[], status = 200): {
  readonly fetchImpl: typeof fetch;
  readonly sent: string[];
  readonly aborted: () => boolean;
} {
  const sent: string[] = [];
  let aborted = false;
  const fetchImpl = ((url: string, init?: { body?: string; signal?: AbortSignal }) => {
    sent.push(url);
    init?.signal?.addEventListener('abort', () => {
      aborted = true;
    });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const piece = pieces.shift();
        if (piece === undefined) {
          controller.close();
          return;
        }
        await Promise.resolve();
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`),
        );
      },
    });
    return Promise.resolve(new Response(status === 200 ? stream : 'no', { status }));
  }) as unknown as typeof fetch;
  return { fetchImpl, sent, aborted: () => aborted };
}

/** An assistant whose events are collected, with one stored key. */
function assistantWith(
  fetchImpl: typeof fetch,
  key = 'k',
): {
  readonly assistant: ReturnType<typeof createAssistant>;
  readonly events: { id: string; payload: unknown }[];
  /** Every address the assistant asked the browser to open, in order. */
  readonly opened: string[];
} {
  const events: { id: string; payload: unknown }[] = [];
  const opened: string[] = [];
  let answers = 0;
  const assistant = createAssistant({
    secret: (id) => (id === 'ai.openai-key' || id === 'ai.anthropic-key' ? key : undefined),
    setting: () => undefined,
    send: (id, payload) => events.push({ id, payload }),
    fetchImpl,
    openInBrowser: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    // NAMED IN ORDER, so a case can say which answer it opens a source of.
    answerId: () => {
      answers += 1;
      return `a${String(answers)}`;
    },
  });
  return { assistant, events, opened };
}

/** What an answer's end says when the web took no part — its id is the case's `a1`, `a2`… */
const noWeb = (answer: string): { answer: string; searched: false; sources: [] } => ({ answer, searched: false, sources: [] });

/** Lets the streamed answer finish. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
};

const ASK = {
  subscription: 'sub-1',
  provider: 'openai' as const,
  model: 'gpt-x',
  messages: [{ role: 'user' as const, text: 'hello' }],
  web: false,
};

describe('the assistant', () => {
  it('streams deltas to the subscription, then says it is done', async () => {
    const { fetchImpl } = provider(['Hel', 'lo.']);
    const { assistant, events } = assistantWith(fetchImpl);

    expect(assistant.ask(ASK)).toStrictEqual({ started: true });
    await settle();

    expect(events).toStrictEqual([
      { id: 'ai.delta', payload: { subscription: 'sub-1', text: 'Hel' } },
      { id: 'ai.delta', payload: { subscription: 'sub-1', text: 'lo.' } },
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false, web: noWeb('a1') } },
    ]);
  });

  it('REFUSES a second ask on a live subscription, and the first keeps streaming', async () => {
    const { fetchImpl } = provider(['one']);
    const { assistant, events } = assistantWith(fetchImpl);

    expect(assistant.ask(ASK).started).toBe(true);
    expect(assistant.ask(ASK)).toStrictEqual({ started: false });
    await settle();

    // ONE ANSWER, not two interleaved into one conversation.
    expect(events.filter((event) => event.id === 'ai.done')).toHaveLength(1);
    expect(events.filter((event) => event.id === 'ai.delta')).toHaveLength(1);
  });

  it('stops the provider, not just the listening, and ends with stopped', async () => {
    const stream = provider(['a', 'b', 'c', 'd']);
    const { assistant, events } = assistantWith(stream.fetchImpl);

    assistant.ask(ASK);
    await Promise.resolve();
    expect(assistant.stop('sub-1')).toStrictEqual({ stopped: true });
    await settle();

    // THE REQUEST ITSELF WAS ABORTED. Closing the stream alone would leave main paying for
    // the rest of the answer, which is what Stop exists to prevent.
    expect(stream.aborted()).toBe(true);
    const done = events.filter((event) => event.id === 'ai.done');
    expect(done).toHaveLength(1);
    expect((done[0]?.payload as { stopped: boolean }).stopped).toBe(true);
  });

  it('CONTROL: stopping a subscription that is not streaming is not an error', () => {
    const { assistant, events } = assistantWith(provider([]).fetchImpl);
    expect(assistant.stop('nothing')).toStrictEqual({ stopped: false });
    expect(events).toStrictEqual([]);
  });

  it('says no-key, on the done event, when the provider has no stored key', async () => {
    const { fetchImpl, sent } = provider(['x']);
    const { assistant, events } = assistantWith(fetchImpl, '');

    assistant.ask(ASK);
    await settle();

    expect(sent).toStrictEqual([]);
    expect(events).toStrictEqual([
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false, refusal: 'no-key', web: noWeb('a1') } },
    ]);
  });

  it('names the provider’s refusal on the done event, with no deltas', async () => {
    const { fetchImpl } = provider([], 401);
    const { assistant, events } = assistantWith(fetchImpl);

    assistant.ask(ASK);
    await settle();

    expect(events).toStrictEqual([
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false, refusal: 'unauthorised', web: noWeb('a1') } },
    ]);
  });

  it('SPLITS a delta larger than the event’s bound rather than cutting it', async () => {
    const long = 'x'.repeat(MAX_EVENT_TEXT + 5);
    const { fetchImpl } = provider([long]);
    const { assistant, events } = assistantWith(fetchImpl);

    assistant.ask(ASK);
    await settle();

    const deltas = events.filter((event) => event.id === 'ai.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas.map((event) => (event.payload as { text: string }).text).join('')).toBe(long);
  });

  it('answers the model list for the provider whose key is stored', async () => {
    const { fetchImpl } = provider([]);
    const listing = ((url: string) => {
      void url;
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { status: 200 }));
    }) as unknown as typeof fetch;
    void fetchImpl;
    const { assistant } = assistantWith(listing);

    const list = await assistant.models('openai');

    expect(list.source).toBe('fetched');
    expect(list.models.map((model) => model.id)).toStrictEqual(['gpt-x']);
  });
});

describe('an answer’s web sources (ADR-0108)', () => {
  /** A fetch answering one Anthropic stream that searched and cited two pages, one of them twice. */
  const searching = ((url: string) => {
    void url;
    const lines = [
      { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'web_search' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer.' } },
      ...['https://example.org/one', 'https://example.net/two', 'https://example.org/one'].map((cited, at) => ({
        type: 'content_block_delta',
        delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: cited, title: `Page ${String(at)}` } },
      })),
    ];
    const body = lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('');
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;

  it('sends a TITLE AND A HOST to the renderer, never the address, and opens one BY ITS PLACE', async () => {
    const { assistant, events, opened } = assistantWith(searching);
    assistant.ask({ ...ASK, provider: 'anthropic', model: 'claude-haiku-4-5', web: true });
    await settle();

    const done = events.find((event) => event.id === 'ai.done')?.payload;
    expect(done).toStrictEqual({
      subscription: 'sub-1',
      stopped: false,
      web: {
        answer: 'a1',
        searched: true,
        sources: [
          { title: 'Page 0', host: 'example.org' },
          { title: 'Page 1', host: 'example.net' },
        ],
      },
    });
    // NO ADDRESS ANYWHERE IN WHAT CROSSED: the paths `/one` and `/two` exist only in `main`.
    expect(JSON.stringify(events)).not.toContain('/one');

    expect(await assistant.openSource('a1', 1)).toStrictEqual({ opened: true });
    expect(opened).toStrictEqual(['https://example.net/two']);
  });

  it('CONTROL: an answer it does not hold, or a place past the list, opens nothing', async () => {
    const { assistant, opened } = assistantWith(searching);
    assistant.ask({ ...ASK, provider: 'anthropic', model: 'claude-haiku-4-5', web: true });
    await settle();

    expect(await assistant.openSource('a9', 0)).toStrictEqual({ opened: false });
    expect(await assistant.openSource('a1', 2)).toStrictEqual({ opened: false });
    expect(opened).toStrictEqual([]);
  });

  it('keeps the most recent answers only, and the oldest is the one let go', async () => {
    const { assistant } = assistantWith(searching);
    for (let at = 0; at <= KEPT_ANSWERS; at += 1) {
      assistant.ask({ ...ASK, subscription: `sub-${String(at)}`, provider: 'anthropic', model: 'claude-haiku-4-5', web: true });
      await settle();
    }
    // `a1` is one past the bound; `a2` is the oldest still held.
    expect(await assistant.openSource('a1', 0)).toStrictEqual({ opened: false });
    expect(await assistant.openSource('a2', 0)).toStrictEqual({ opened: true });
  });

  it('asks with the switch the person chose: Document only sends the provider no search tool', async () => {
    const bodies: unknown[] = [];
    const recording = ((url: string, init?: { body?: string }) => {
      void url;
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return Promise.resolve(new Response('', { status: 200 }));
    }) as unknown as typeof fetch;
    const { assistant } = assistantWith(recording);
    assistant.ask({ ...ASK, provider: 'anthropic', model: 'claude-haiku-4-5', web: false });
    await settle();
    assistant.ask({ ...ASK, subscription: 'sub-2', provider: 'anthropic', model: 'claude-haiku-4-5', web: true });
    await settle();
    expect(bodies.map((body) => (body as { tools?: unknown }).tools === undefined)).toStrictEqual([true, false]);
  });
});

describe('splitDelta', () => {
  it('keeps a short piece whole and splits a long one in order', () => {
    expect(splitDelta('abc', 4)).toStrictEqual(['abc']);
    expect(splitDelta('abcdefg', 3)).toStrictEqual(['abc', 'def', 'g']);
  });
});
