import { MAX_EVENT_TEXT } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { createAssistant, splitDelta } from './assistant.js';

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
function assistantWith(fetchImpl: typeof fetch, key = 'k'): {
  readonly assistant: ReturnType<typeof createAssistant>;
  readonly events: { id: string; payload: unknown }[];
} {
  const events: { id: string; payload: unknown }[] = [];
  const assistant = createAssistant({
    secret: (id) => (id === 'ai.openai-key' ? key : undefined),
    setting: () => undefined,
    send: (id, payload) => events.push({ id, payload }),
    fetchImpl,
  });
  return { assistant, events };
}

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
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false } },
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
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false, refusal: 'no-key' } },
    ]);
  });

  it('names the provider’s refusal on the done event, with no deltas', async () => {
    const { fetchImpl } = provider([], 401);
    const { assistant, events } = assistantWith(fetchImpl);

    assistant.ask(ASK);
    await settle();

    expect(events).toStrictEqual([
      { id: 'ai.done', payload: { subscription: 'sub-1', stopped: false, refusal: 'unauthorised' } },
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

describe('splitDelta', () => {
  it('keeps a short piece whole and splits a long one in order', () => {
    expect(splitDelta('abc', 4)).toStrictEqual(['abc']);
    expect(splitDelta('abcdefg', 3)).toStrictEqual(['abc', 'def', 'g']);
  });
});
