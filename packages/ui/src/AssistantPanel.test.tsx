// @vitest-environment happy-dom
import { type AskSent, type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { type AssistantDocument, AssistantPanel, type AssistantPanelProps } from './AssistantPanel.js';
import type { AssistantRequest } from './assistantRequest.js';
import { createDocumentStore } from './documentStores.js';
import { ASSISTANT_PROMPT_DRAFT_REPLY, ASSISTANT_PROMPT_EXPLAIN } from './messages/en.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The assistant tab: the UI half of the wired pair (ADR-0081, ADR-0083).
 *
 * The kernel half proves the request reaches the provider and the answer streams back; these
 * cases prove the panel dispatches exactly that, shows what arrives, and says the honest
 * thing when there is no key.
 */

beforeAll(() => {
  activateCatalogue('en', EN);
});

function Wrapped({ children }: { readonly children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** A client that records what it was asked and answers what the case says. */
function recording(
  models: readonly { id: string; label: string }[],
  started = true,
  window: AskSent | null = null,
): {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
} {
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'ai.models') {
      return Promise.resolve({
        ok: true,
        value: {
          source: 'fetched',
          models: models.map((model) => ({
            ...model,
            capabilities: { vision: null, streaming: null },
          })),
        },
      });
    }
    if (id === 'ai.ask') return Promise.resolve({ ok: true, value: { started, sent: window } });
    if (id === 'ai.stop') return Promise.resolve({ ok: true, value: { stopped: true } });
    throw new Error(`this case does not answer ${id}`);
  });
  return { client, sent };
}

/** A subscriber the case pushes events through, as `main` would. */
function events(): {
  readonly subscribe: Parameters<typeof AssistantPanel>[0]['subscribe'];
  push: (id: 'ai.delta' | 'ai.done', payload: unknown) => void;
} {
  const handlers = new Map<string, ((payload: never) => void)[]>();
  return {
    subscribe: (id, handler) => {
      handlers.set(id, [...(handlers.get(id) ?? []), handler]);
      return () => {
        handlers.set(id, (handlers.get(id) ?? []).filter((entry) => entry !== handler));
      };
    },
    push: (id, payload) => {
      act(() => {
        for (const handler of handlers.get(id) ?? []) handler(payload as never);
      });
    },
  };
}

const ANTHROPIC_KEY = 'ai.anthropic-key';

/**
 * The panel under a host that holds the handled serial, as `App` does — so a remount (`mount`)
 * keeps it, which is the property the replay case asserts.
 */
function Host({
  mount,
  ...props
}: Omit<AssistantPanelProps, 'handled' | 'onHandled'> & { readonly mount?: number }): ReactElement {
  const [handled, setHandled] = useState<number | undefined>(undefined);
  return <AssistantPanel key={mount ?? 0} {...props} handled={handled} onHandled={setHandled} />;
}

async function drawn(options: {
  readonly models?: readonly { id: string; label: string }[];
  readonly stored?: readonly string[];
  readonly started?: boolean;
  readonly window?: AskSent | null;
  readonly focused?: AssistantDocument;
  readonly request?: AssistantRequest;
  readonly onGoTo?: (page: number) => void;
  readonly onReply?: AssistantPanelProps['onReply'];
} = {}) {
  const wire = events();
  const { client, sent } = recording(
    options.models ?? [{ id: 'm-1', label: 'Model one' }],
    options.started ?? true,
    options.window ?? null,
  );
  const panel = (props: Partial<AssistantPanelProps> & { readonly mount?: number }): ReactElement => (
    <Wrapped>
      <Host
        client={client}
        focused={options.focused}
        onGoTo={options.onGoTo}
        onReply={options.onReply}
        request={options.request}
        storedSecrets={options.stored ?? [ANTHROPIC_KEY]}
        subscribe={wire.subscribe}
        {...props}
      />
    </Wrapped>
  );
  const { rerender } = render(panel({}));
  // THE MODEL LIST IS FETCHED ON MOUNT; every case below needs it settled first.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    sent,
    push: wire.push,
    /** Redraws the panel with some props changed, as `App` would on a tab switch; a new `mount`
     * remounts the panel under a host that keeps the handled serial, as `App` does. */
    redraw: async (props: Partial<AssistantPanelProps> & { readonly mount?: number }) => {
      rerender(panel(props));
      await act(async () => {
        await Promise.resolve();
      });
    },
  };
}

function type(text: string): void {
  fireEvent.change(screen.getByLabelText('Ask about this document'), { target: { value: text } });
}

describe('the assistant tab', () => {
  it('asks the provider for its models when it opens', async () => {
    const { sent } = await drawn();
    expect(sent[0]).toStrictEqual({ id: 'ai.models', params: { provider: 'anthropic' } });
    expect(screen.getByRole('option', { name: 'Model one' })).toBeTruthy();
  });

  it('dispatches ai.ask with the turn typed and the chosen model, and shows the turn', async () => {
    const { sent } = await drawn();

    type('What is on page 2?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });

    const ask = sent.find((entry) => entry.id === 'ai.ask');
    expect(ask?.params).toMatchObject({
      provider: 'anthropic',
      model: 'm-1',
      messages: [{ role: 'user', text: 'What is on page 2?' }],
    });
    expect(screen.getByText('What is on page 2?')).toBeTruthy();
  });

  it('SHOWS the answer as it streams, one growing turn rather than one per delta', async () => {
    const { sent, push } = await drawn();
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    push('ai.delta', { subscription, text: 'Page ' });
    push('ai.delta', { subscription, text: 'two.' });

    expect(screen.getByText('Page two.')).toBeTruthy();
    expect(screen.queryAllByText(/^Page $/u)).toHaveLength(0);
  });

  it('CONTROL: a delta for ANOTHER subscription changes nothing', async () => {
    const { push } = await drawn();
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });

    push('ai.delta', { subscription: 'someone-else', text: 'not mine' });

    expect(screen.queryByText('not mine')).toBeNull();
  });

  it('turns Send into STOP while streaming, and stopping dispatches ai.stop for that subscription', async () => {
    const { sent, push } = await drawn();
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent.at(-1)).toStrictEqual({ id: 'ai.stop', params: { subscription } });

    push('ai.done', { subscription, stopped: true });
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('says what went wrong in plain words, and keeps what streamed', async () => {
    const { sent, push } = await drawn();
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    push('ai.delta', { subscription, text: 'half an answer' });
    push('ai.done', { subscription, stopped: false, refusal: 'unauthorised' });

    expect(screen.getByText(/did not accept the key/u)).toBeTruthy();
    // THE WORDS A PERSON READ ARE STILL THERE.
    expect(screen.getByText('half an answer')).toBeTruthy();
  });

  it('says an Anthropic account is out of credit in the owner’s words, and where to add it', async () => {
    const { sent, push } = await drawn();
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    push('ai.done', { subscription, stopped: false, refusal: 'out-of-credit' });

    expect(
      screen.getByText('Your Anthropic account is out of credit — add credit at console.anthropic.com'),
    ).toBeTruthy();
    // CONTROL: not the sentence for a refused request, which would send nobody to pay.
    expect(screen.queryByText(/refused the request/u)).toBeNull();
  });

  it('says so when the chosen provider has no stored key', async () => {
    await drawn({ stored: [] });
    expect(screen.getByText(/no key stored/u)).toBeTruthy();
  });

  it('says so when a provider lists no models, rather than showing an empty picker', async () => {
    await drawn({ models: [] });
    expect(screen.getByText(/No models are listed/u)).toBeTruthy();
  });

  it('CONTROL: an ask that never started leaves the typed text where it was', async () => {
    await drawn({ started: false });
    type('keep me');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText<HTMLTextAreaElement>('Ask about this document').value).toBe('keep me');
    expect(screen.getByText(/refused the request/u)).toBeTruthy();
  });

  it('sends on Enter and starts a line on Shift+Enter', async () => {
    const { sent } = await drawn();
    const composer = screen.getByLabelText('Ask about this document');

    type('first');
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);

    fireEvent.keyDown(composer, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(true);
  });
});

describe('the assistant about a document (ADR-0088)', () => {
  const DOC_A = asDocId('00000000-0000-4000-8000-00000000000a');
  const DOC_B = asDocId('00000000-0000-4000-8000-00000000000b');

  /** A focused document on kernel page 6 — off the first page, so a frame slip shows. */
  function focusedOn(docId = DOC_A, page = 6): AssistantDocument {
    return { docId, store: createDocumentStore(docId, asDocVersion(1)), page };
  }

  /** The `about` the last ask carried, or `undefined` for an ask about nothing. */
  function lastAbout(sent: readonly { id: string; params: unknown }[]): unknown {
    const asks = sent.filter((entry) => entry.id === 'ai.ask');
    return (asks.at(-1)?.params as { about?: unknown } | undefined)?.about;
  }

  async function send(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('names the page as a person reads it and the provider by name, and asks about THAT page', async () => {
    const { sent } = await drawn({ focused: focusedOn() });

    expect(screen.getByRole('option', { name: 'This page (7)' })).toBeTruthy();
    expect(screen.getByText('Sent to Anthropic only when you press Send.')).toBeTruthy();
    // THE PROVIDER LIST SAYS NAMES, never the registry's ids.
    expect(screen.getByRole('option', { name: 'Google Gemini' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'anthropic' })).toBeNull();

    type('What does this page say?');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'page', docId: DOC_A, page: 6 });
  });

  it('asks about the whole document when chosen, and CONTROL: about nothing sends no scope and no consent line', async () => {
    const { sent } = await drawn({ focused: focusedOn() });
    const line = screen.getByLabelText('Asking about');

    fireEvent.change(line, { target: { value: 'document' } });
    type('Summarise it');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'document', docId: DOC_A });

    fireEvent.change(line, { target: { value: 'nothing' } });
    expect(screen.queryByText(/only when you press Send/u)).toBeNull();
  });

  it('CONTROL: an ask about nothing carries no scope at all', async () => {
    const { sent, push } = await drawn({ focused: focusedOn() });
    fireEvent.change(screen.getByLabelText('Asking about'), { target: { value: 'nothing' } });
    type('Just a question');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.done', { subscription, stopped: false });
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(true);
    expect(lastAbout(sent)).toBeUndefined();
  });

  it('says under the question which pages went, from main’s answer rather than the scope it meant', async () => {
    await drawn({
      focused: focusedOn(),
      window: { firstPage: 0, lastPage: 11, pageCount: 40, characters: 99_870, truncated: true },
    });
    fireEvent.change(screen.getByLabelText('Asking about'), { target: { value: 'document' } });
    type('Summarise it');
    await send();

    expect(screen.getByText('Sent pages 1 to 12 of 40 — cut short at 99,870 characters')).toBeTruthy();
  });

  it('turns a [p. N] citation into a link to that page, and CONTROL: the words around it stay text', async () => {
    const went: number[] = [];
    const { sent, push } = await drawn({ focused: focusedOn(), onGoTo: (page) => went.push(page) });
    type('Where is the deadline?');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    push('ai.delta', { subscription, text: 'It is set out on [p. 5], in the second clause.' });
    push('ai.done', { subscription, stopped: false });

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 5' }));
    // KERNEL PAGE 4 for the page a person calls 5 — the one frame, crossed once.
    expect(went).toStrictEqual([4]);
    expect(screen.getByText(/It is set out on/u).tagName).toBe('SPAN');
  });

  it('keeps ONE CONVERSATION PER DOCUMENT: switching tabs shows the other document’s, and switching back restores it', async () => {
    const a = focusedOn(DOC_A);
    const b = focusedOn(DOC_B);
    const { sent, push, redraw } = await drawn({ focused: a });
    type('About A');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.delta', { subscription, text: 'answer for A' });
    push('ai.done', { subscription, stopped: false });

    await redraw({ focused: b });
    expect(screen.queryByText('answer for A')).toBeNull();

    await redraw({ focused: a });
    expect(screen.getByText('answer for A')).toBeTruthy();
  });

  it('an answer still streaming when the reader switches tabs goes to the document that ASKED', async () => {
    const a = focusedOn(DOC_A);
    const b = focusedOn(DOC_B);
    const { sent, push, redraw } = await drawn({ focused: a });
    type('About A');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    await redraw({ focused: b });
    push('ai.delta', { subscription, text: 'late words' });
    push('ai.done', { subscription, stopped: false });

    expect(b.store.getState().conversation).toStrictEqual([]);
    expect(a.store.getState().conversation.at(-1)).toStrictEqual({ role: 'assistant', text: 'late words' });
  });

  it('a command’s request asks at once about the words it names, and the line offers that selection', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_A, page: 2, text: 'the indemnity clause' },
      prompt: ASSISTANT_PROMPT_EXPLAIN,
    };
    const { sent } = await drawn({ focused: focusedOn(), request });
    await act(async () => {
      await Promise.resolve();
    });

    expect(lastAbout(sent)).toStrictEqual(request.about);
    expect(screen.getByText('Explain the selected text in plain language.')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'The text you selected on page 3' })).toBeTruthy();
  });

  it('CONTROL: a selection from ANOTHER document is not offered, so the line never names words not on show', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_B, page: 2, text: 'words from B' },
    };
    await drawn({ focused: focusedOn(DOC_A), request });
    expect(screen.queryByRole('option', { name: /you selected/u })).toBeNull();
  });

  it('a drafted reply is POSTED only by a press, as replyToAnnotation on the note it answers', async () => {
    const posted: unknown[] = [];
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_A, page: 3, text: 'Can we move the date?' },
      prompt: ASSISTANT_PROMPT_DRAFT_REPLY,
      replyTo: { page: 3, index: 2, version: asDocVersion(9) },
    };
    const { sent, push } = await drawn({ focused: focusedOn(), request, onReply: (command) => posted.push(command) });
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    push('ai.delta', { subscription, text: '  Yes — Friday works. ' });
    // STILL STREAMING: a half-written draft is not offered.
    expect(screen.queryByRole('button', { name: 'Post as a reply' })).toBeNull();
    push('ai.done', { subscription, stopped: false });
    expect(posted).toStrictEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Post as a reply' }));
    expect(posted).toStrictEqual([
      { kind: 'replyToAnnotation', page: 3, index: 2, text: 'Yes — Friday works.', version: asDocVersion(9) },
    ]);
  });

  it('a REMOUNT does not replay the last request — the live run’s re-sent draft', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_A, page: 3, text: 'Can we move the date?' },
      prompt: ASSISTANT_PROMPT_DRAFT_REPLY,
    };
    const focused = focusedOn();
    const { sent, push, redraw } = await drawn({ focused, request });
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.done', { subscription, stopped: false });

    // THE PANEL UNMOUNTS AND MOUNTS AGAIN, as it does when the last tab closes and a document
    // opens: the request is still `App`'s, and only `App`'s memory of handling it holds.
    await redraw({ mount: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent.filter((entry) => entry.id === 'ai.ask')).toHaveLength(1);
  });

  it('CONTROL: a request naming ANOTHER document is never asked in this one', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'page', docId: DOC_B, page: 0 },
      prompt: ASSISTANT_PROMPT_EXPLAIN,
    };
    const { sent } = await drawn({ focused: focusedOn(DOC_A), request });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);
  });

  it('a drafted reply is posted ONCE: the button leaves after it is pressed', async () => {
    const posted: unknown[] = [];
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_A, page: 3, text: 'Can we move the date?' },
      prompt: ASSISTANT_PROMPT_DRAFT_REPLY,
      replyTo: { page: 3, index: 2, version: asDocVersion(9) },
    };
    const { sent, push } = await drawn({ focused: focusedOn(), request, onReply: (command) => posted.push(command) });
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.delta', { subscription, text: 'Friday works.' });
    push('ai.done', { subscription, stopped: false });

    fireEvent.click(screen.getByRole('button', { name: 'Post as a reply' }));
    expect(screen.queryByRole('button', { name: 'Post as a reply' })).toBeNull();
    expect(posted).toHaveLength(1);
  });

  it('CONTROL: an ordinary answer offers no reply button', async () => {
    const { sent, push } = await drawn({ focused: focusedOn(), onReply: () => undefined });
    type('hello');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.delta', { subscription, text: 'hi' });
    push('ai.done', { subscription, stopped: false });
    expect(screen.queryByRole('button', { name: 'Post as a reply' })).toBeNull();
  });

  it('offers quick starts on an empty conversation, and one asks about the whole document', async () => {
    const { sent } = await drawn({ focused: focusedOn() });
    fireEvent.click(screen.getByRole('button', { name: 'Summarise this document' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(lastAbout(sent)).toStrictEqual({ scope: 'document', docId: DOC_A });
    expect(screen.queryByRole('button', { name: 'Summarise this document' })).toBeNull();
  });
});
