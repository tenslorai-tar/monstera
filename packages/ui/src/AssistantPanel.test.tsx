// @vitest-environment happy-dom
import { type AskSent, type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { type AssistantDocument, AssistantPanel, type AssistantPanelProps } from './AssistantPanel.js';
import type { AssistantRequest } from './assistantRequest.js';
import { createDocumentStore } from './documentStores.js';
import {
  ASSISTANT_PROMPT_DRAFT_REPLY,
  ASSISTANT_PROMPT_EXPLAIN,
  ASSISTANT_PROMPT_SUMMARISE_COMMENTS,
} from './messages/en.js';
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
  models: readonly { id: string; label: string; vision?: boolean | null }[],
  started = true,
  window: AskSent | null = null,
  alongside?: AskSent,
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
          models: models.map(({ id, label, vision }) => ({
            id,
            label,
            capabilities: { vision: vision ?? null, streaming: null },
          })),
        },
      });
    }
    if (id === 'ai.ask') {
      // THE SECOND WINDOW ONLY WHEN THE ASK HAD A SECOND DOCUMENT, as `main` answers it.
      const paired = (params as { alongside?: unknown }).alongside !== undefined;
      return Promise.resolve({
        ok: true,
        value: { started, sent: window, ...(paired && alongside !== undefined ? { alongside } : {}) },
      });
    }
    if (id === 'ai.stop') return Promise.resolve({ ok: true, value: { stopped: true } });
    if (id === 'window.copyText') return Promise.resolve({ ok: true, value: { copied: true } });
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
  readonly models?: readonly { id: string; label: string; vision?: boolean | null }[];
  readonly stored?: readonly string[];
  readonly started?: boolean;
  readonly window?: AskSent | null;
  readonly alongside?: AskSent;
  readonly focused?: AssistantDocument;
  readonly request?: AssistantRequest;
  readonly onGoTo?: (page: number) => void;
  readonly onReply?: AssistantPanelProps['onReply'];
  readonly beside?: AssistantPanelProps['beside'];
  readonly onNote?: AssistantPanelProps['onNote'];
  readonly onGoToBeside?: (page: number) => void;
} = {}) {
  const wire = events();
  const { client, sent } = recording(
    options.models ?? [{ id: 'm-1', label: 'Model one' }],
    options.started ?? true,
    options.window ?? null,
    options.alongside,
  );
  const panel = (props: Partial<AssistantPanelProps> & { readonly mount?: number }): ReactElement => (
    <Wrapped>
      <Host
        client={client}
        focused={options.focused}
        beside={options.beside}
        onGoToBeside={options.onGoToBeside}
        onGoTo={options.onGoTo}
        onReply={options.onReply}
        onNote={options.onNote}
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

  it('says so when the chosen provider has no stored key, and another provider has one', async () => {
    await drawn({ stored: ['ai.openai-key'] });
    expect(screen.getByText(/no key stored/u)).toBeTruthy();
  });

  it('COUNTS comments under the question rather than naming their pages', async () => {
    const window = { firstPage: 0, lastPage: 0, pageCount: 3, characters: 40, truncated: false, comments: 2 };
    const docId = asDocId('00000000-0000-4000-8000-000000000001');
    await drawn({ window, focused: { docId, store: createDocumentStore(docId, asDocVersion(1)), page: 0 } });
    type('Summarise');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Sent all 2 comments in this document')).toBeTruthy();
    // CONTROL: the page line that read as *two pages left out* is not drawn.
    expect(screen.queryByText('Sent page 1 of 3')).toBeNull();
  });

  it('says ONE sentence when no key is stored at all, not the chosen provider’s as well', async () => {
    // Both *this provider has no key* and *no provider has a key* are true here, and the panel said
    // both. The count is the assertion: a panel showing only the second would pass a text query too.
    await drawn({ stored: [] });
    const lines = [...document.querySelectorAll('.m-assistant__state')].map((line) => line.textContent);
    expect(lines).toStrictEqual([
      'No provider key is stored yet. Add one in Settings › AI and the assistant can start answering.',
    ]);
  });

  it('NO DEAD SEND (§10.5): with no key, or no model to ask, Send is disabled beside the line saying why', async () => {
    await drawn({ stored: [] });
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    await drawn({ models: [] });
    expect(screen.getByText(/No models are listed/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    // CONTROL: a key and a model — Send works.
    await drawn();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false);
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

  /** Presses one of the "Asking about" buttons (v5-03), by the label it shows. */
  function about(label: 'Selection' | 'Comment' | 'Document' | 'Comments' | 'Picture' | 'None' | RegExp): void {
    const group = screen.getByRole('group', { name: 'Asking about' });
    fireEvent.click(within(group).getByRole('button', { name: label }));
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

    const group = screen.getByRole('group', { name: 'Asking about' });
    expect(within(group).getByRole('button', { name: 'Page 7' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/This page \(7\)/u)).toBeTruthy();
    expect(screen.getByText(/Sent to Anthropic only when you press Send\./u)).toBeTruthy();
    // THE PROVIDER LIST SAYS NAMES, never the registry's ids.
    expect(screen.getByRole('option', { name: 'Google Gemini' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'anthropic' })).toBeNull();

    type('What does this page say?');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'page', docId: DOC_A, page: 6 });
  });

  it('asks about the whole document when chosen, and CONTROL: about nothing sends no scope and no consent line', async () => {
    const { sent } = await drawn({ focused: focusedOn() });

    about('Document');
    type('Summarise it');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'document', docId: DOC_A });

    about('None');
    expect(screen.queryByText(/only when you press Send/u)).toBeNull();
  });

  it('CONTROL: an ask about nothing carries no scope at all', async () => {
    const { sent, push } = await drawn({ focused: focusedOn() });
    about('None');
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
    about('Document');
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

  it('shows an answer as RENDERED MARKDOWN, and a citation inside a list item still goes to its page', async () => {
    const went: number[] = [];
    const { sent, push } = await drawn({ focused: focusedOn(), onGoTo: (page) => went.push(page) });
    type('List the deadlines');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;

    // Streamed in pieces, as a provider sends it: the structure exists only in the whole text.
    push('ai.delta', { subscription, text: '## Deadlines\n\n- Notice by **1 May** [p. 2]\n' });
    push('ai.delta', { subscription, text: '- Payment <script>x</script>\n' });
    push('ai.done', { subscription, stopped: false });

    const answer = document.querySelector('.m-assistant__answer');
    expect(answer?.querySelector('h4')?.textContent).toBe('Deadlines');
    expect(answer?.querySelectorAll('li')).toHaveLength(2);
    expect(answer?.querySelector('strong')?.textContent).toBe('1 May');
    expect(answer?.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(went).toStrictEqual([1]);
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
    const group = screen.getByRole('group', { name: 'Asking about' });
    expect(within(group).getByRole('button', { name: 'Selection' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/The text you selected on page 3/u)).toBeTruthy();
  });

  it('CONTROL: a selection from ANOTHER document is not offered, so the line never names words not on show', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_B, page: 2, text: 'words from B' },
    };
    await drawn({ focused: focusedOn(DOC_A), request });
    // THE CHIP AND THE LINE, the two places the positive case above finds the selection. This queried an `option`
    // until the audit of 1e1bfad..e24eca0e: the choices became buttons in 44250155 and no option exists, so the case
    // passed whatever the panel drew.
    const group = screen.getByRole('group', { name: 'Asking about' });
    expect(within(group).queryByRole('button', { name: 'Selection' })).toBeNull();
    expect(screen.queryByText(/you selected/u)).toBeNull();
  });

  it('names a COMMENT as a comment on the line, and asks with the comment scope', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'comment', docId: DOC_A, page: 3, text: 'Can we move the date?' },
      prompt: ASSISTANT_PROMPT_DRAFT_REPLY,
      replyTo: { page: 3, index: 2, version: asDocVersion(9) },
    };
    const { sent } = await drawn({ focused: focusedOn(), request });
    await act(async () => {
      await Promise.resolve();
    });

    const group = screen.getByRole('group', { name: 'Asking about' });
    expect(within(group).getByRole('button', { name: 'Comment' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/The comment on page 4/u)).toBeTruthy();
    // CONTROL: the selection's wording is not borrowed.
    expect(within(group).queryByRole('button', { name: 'Selection' })).toBeNull();
    expect(screen.queryByText(/you selected/u)).toBeNull();
    const params = sent.find((entry) => entry.id === 'ai.ask')?.params as { about: { scope: string } };
    expect(params.about.scope).toBe('comment');
  });

  it('a drafted reply is POSTED only by a press, as replyToAnnotation on the note it answers', async () => {
    const posted: unknown[] = [];
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'comment', docId: DOC_A, page: 3, text: 'Can we move the date?' },
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
      about: { scope: 'comment', docId: DOC_A, page: 3, text: 'Can we move the date?' },
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
      about: { scope: 'comment', docId: DOC_A, page: 3, text: 'Can we move the date?' },
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

  it('SUMMARISE COMMENTS: the command’s request asks at once about the comments, and the line names them', async () => {
    const { sent } = await drawn({
      focused: focusedOn(),
      request: { serial: 1, about: { scope: 'comments', docId: DOC_A }, prompt: ASSISTANT_PROMPT_SUMMARISE_COMMENTS },
    });
    expect(lastAbout(sent)).toStrictEqual({ scope: 'comments', docId: DOC_A });
    const group = screen.getByRole('group', { name: 'Asking about' });
    expect(within(group).getByRole('button', { name: 'Comments' }).getAttribute('aria-pressed')).toBe('true');
    // THE CHOICE IN FULL, under the buttons.
    expect(screen.getByText(/All the comments in this document/u)).toBeTruthy();
  });

  describe('a picture of the page — vision analysis (ADR-0090)', () => {
    it('the quick start asks about a PICTURE of the page on screen, and the turn says a picture went', async () => {
      const { sent } = await drawn({
        focused: focusedOn(),
        window: { firstPage: 6, lastPage: 6, pageCount: 9, characters: 0, truncated: false, picture: true },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Read the table on this page' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(lastAbout(sent)).toStrictEqual({ scope: 'page-image', docId: DOC_A, page: 6 });
      // NOT "No text was found to send", which is what a picture's zero characters would say.
      expect(screen.getByText('Sent a picture of page 7 of 9')).toBeTruthy();
    });

    it('a model that SAYS it cannot see is not offered the picture, and Send waits with a sentence saying why', async () => {
      const { sent } = await drawn({
        focused: focusedOn(),
        models: [
          { id: 'm-see', label: 'Model that sees', vision: true },
          { id: 'm-blind', label: 'Model one', vision: false },
        ],
      });
      // A STALE CHOICE, made for real: Picture chosen while a model that can see is picked, then the blind one picked.
      about('Picture');
      fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'm-blind' } });
      const group = screen.getByRole('group', { name: 'Asking about' });
      expect(within(group).getByRole('button', { name: 'Picture' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('button', { name: 'Read the table on this page' }).hasAttribute('disabled')).toBe(true);

      // CHOSEN BEFORE — it still sends nothing, and says why.
      expect(screen.getByText(/This model cannot read pictures/u)).toBeTruthy();
      type('Read it');
      fireEvent.keyDown(screen.getByLabelText('Ask about this document'), { key: 'Enter' });
      await act(async () => {
        await Promise.resolve();
      });
      expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);
    });

    it('CONTROL: a model whose provider does not say is offered it — unknown is not "cannot"', async () => {
      await drawn({ focused: focusedOn(), models: [{ id: 'm-1', label: 'Model one', vision: null }] });
      const group = screen.getByRole('group', { name: 'Asking about' });
      expect(within(group).getByRole('button', { name: 'Picture' }).hasAttribute('disabled')).toBe(false);
    });
  });

  describe('two documents side by side: Left · Right · Both (ADR-0089)', () => {
    /** The compared document, on kernel page 2 — a different page from the left's 6. */
    const BESIDE = { docId: DOC_B, page: 2 };

    /** The last ask's params, whole. */
    function lastAsk(sent: readonly { id: string; params: unknown }[]): { about?: unknown; alongside?: unknown } {
      return sent.filter((entry) => entry.id === 'ai.ask').at(-1)?.params ?? {};
    }

    function pick(name: 'Left' | 'Right' | 'Both'): void {
      fireEvent.click(screen.getByRole('radio', { name }));
    }

    it('asks BEFORE sending: nothing chosen, Send and the quick starts wait, and pressing Send sends nothing', async () => {
      const { sent } = await drawn({ focused: focusedOn(), beside: BESIDE });

      const radios = screen.getAllByRole('radio');
      expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toStrictEqual([false, false, false]);
      expect(screen.getByText('Two documents are side by side. Choose Left, Right or Both, then send.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('button', { name: 'Summarise this document' }).hasAttribute('disabled')).toBe(true);

      type('Which is later?');
      fireEvent.keyDown(screen.getByLabelText('Ask about this document'), { key: 'Enter' });
      await act(async () => {
        await Promise.resolve();
      });
      expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);
    });

    it('BOTH sends the left page with the right pane’s page alongside; RIGHT sends the right alone', async () => {
      const { sent } = await drawn({ focused: focusedOn(), beside: BESIDE });

      pick('Both');
      type('Compare the two pages');
      await send();
      expect(lastAsk(sent).about).toStrictEqual({ scope: 'page', docId: DOC_A, page: 6 });
      expect(lastAsk(sent).alongside).toStrictEqual({ scope: 'page', docId: DOC_B, page: 2 });
    });

    it('RIGHT sends the right document alone, and the page line names the right pane’s page', async () => {
      const { sent } = await drawn({ focused: focusedOn(), beside: BESIDE });

      pick('Right');
      expect(within(screen.getByRole('group', { name: 'Asking about' })).getByRole('button', { name: 'Page 3' })).toBeTruthy();
      expect(screen.getByText(/This page \(3\)/u)).toBeTruthy();
      type('What is on the right page?');
      await send();
      expect(lastAsk(sent).about).toStrictEqual({ scope: 'page', docId: DOC_B, page: 2 });
      expect(lastAsk(sent)).not.toHaveProperty('alongside');
    });

    it('REMEMBERS the choice for the conversation: a remount of the panel still holds it', async () => {
      const focused = focusedOn();
      const { redraw } = await drawn({ focused, beside: BESIDE });
      pick('Right');
      await redraw({ mount: 1 });
      const right = screen.getByRole('radio', { name: 'Right' });
      expect(right instanceof HTMLInputElement && right.checked).toBe(true);
      expect(focused.store.getState().sides).toBe('right');
    });

    it('CONTROL: with ONE document shown there is no choice, and an ask carries no second document', async () => {
      const { sent } = await drawn({ focused: focusedOn() });
      expect(screen.queryByRole('radio')).toBeNull();
      type('One document');
      await send();
      expect(lastAsk(sent).about).toStrictEqual({ scope: 'page', docId: DOC_A, page: 6 });
      expect(lastAsk(sent)).not.toHaveProperty('alongside');
    });

    it('CONTROL: a selection belongs to its own document, so no choice is offered for it', async () => {
      await drawn({
        focused: focusedOn(),
        beside: BESIDE,
        request: { serial: 1, about: { scope: 'selection', docId: DOC_A, page: 6, text: 'the clause' } },
      });
      expect(screen.queryByRole('radio')).toBeNull();
    });

    it('says what went from EACH side, and links a side’s citation to that side’s pane', async () => {
      const left: number[] = [];
      const right: number[] = [];
      const { sent, push } = await drawn({
        focused: focusedOn(),
        beside: BESIDE,
        onGoTo: (page) => left.push(page),
        onGoToBeside: (page) => right.push(page),
        window: { firstPage: 6, lastPage: 6, pageCount: 9, characters: 40, truncated: false },
        alongside: { firstPage: 2, lastPage: 2, pageCount: 4, characters: 30, truncated: false },
      });
      pick('Both');
      type('Compare');
      await send();
      expect(screen.getByText('Left: Sent page 7 of 9')).toBeTruthy();
      expect(screen.getByText('Right: Sent page 3 of 4')).toBeTruthy();

      const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
      push('ai.delta', { subscription, text: 'See [Left p. 7] and [Right p. 3]; also [p. 2].' });
      push('ai.done', { subscription, stopped: false });

      fireEvent.click(screen.getByRole('button', { name: 'Go to page 7' }));
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 3 of the document on the right' }));
      expect(left).toStrictEqual([6]);
      expect(right).toStrictEqual([2]);
      // A SIDE-LESS CITATION FROM A PAIRED ANSWER names no document, so it is not a link.
      expect(screen.queryByRole('button', { name: 'Go to page 2' })).toBeNull();
    });

    it('CONTROL: a right-hand citation is text once ANOTHER document is on the right', async () => {
      const { sent, push, redraw } = await drawn({
        focused: focusedOn(),
        beside: BESIDE,
        onGoToBeside: () => undefined,
      });
      pick('Right');
      type('Where?');
      await send();
      const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
      push('ai.delta', { subscription, text: 'On [p. 3].' });
      push('ai.done', { subscription, stopped: false });
      expect(screen.getByRole('button', { name: 'Go to page 3 of the document on the right' })).toBeTruthy();

      await redraw({ beside: { docId: asDocId('00000000-0000-4000-8000-00000000000c'), page: 0 } });
      expect(screen.queryByRole('button', { name: /Go to page 3/u })).toBeNull();
    });
  });
});

describe('the chat extras (the owner’s design, 2026-09-15)', () => {
  const DOC = asDocId('00000000-0000-4000-8000-0000000000e5');

  /** A document conversation with one whole exchange in it, asked about the page. */
  async function answered(extra: Partial<Parameters<typeof drawn>[0]> = {}) {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const harness = await drawn({ focused: { docId: DOC, store, page: 2 }, ...extra });
    type('When is the review?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    const subscription = (harness.sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string })
      .subscription;
    harness.push('ai.delta', { subscription, text: 'On 17 March.' });
    harness.push('ai.done', { subscription, stopped: false });
    return { ...harness, store };
  }

  const asks = (sent: readonly { id: string; params: unknown }[]) =>
    sent.filter((entry) => entry.id === 'ai.ask').map((entry) => entry.params as { messages: { text: string }[]; about?: unknown });

  it('REGENERATE asks the same question about the SAME scope again, and replaces the answer', async () => {
    const { sent, store } = await answered();
    // CONTROL of the premise: move the *Asking about* line away, so re-asking "what the line says
    // now" would send the whole document instead of page 3.
    fireEvent.click(within(screen.getByRole('group', { name: 'Asking about' })).getByRole('button', { name: 'Document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate this answer' }));
    await act(async () => {
      await Promise.resolve();
    });
    const [first, second] = asks(sent);
    expect(second?.messages).toStrictEqual([{ role: 'user', text: 'When is the review?' }]);
    expect(second?.about).toStrictEqual(first?.about);
    expect(store.getState().conversation.map((turn) => turn.role)).toStrictEqual(['user']);
  });

  it('EDIT puts the question back in the composer, and Send replaces it and its answer', async () => {
    const { sent, store } = await answered();
    fireEvent.click(screen.getByRole('button', { name: 'Edit your question and ask again' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Ask about this document').value).toBe('When is the review?');
    type('When is the final report due?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(asks(sent).at(-1)?.messages).toStrictEqual([{ role: 'user', text: 'When is the final report due?' }]);
    expect(store.getState().conversation.map((turn) => turn.text)).toStrictEqual(['When is the final report due?']);
  });

  it('COPY sends the answer to main’s clipboard and says Copied only when main says it went', async () => {
    // Through `window.copyText`, because the renderer holds no clipboard permission (§2): live, the
    // browser's own clipboard write was refused with the window focused.
    const { sent } = await answered();
    fireEvent.click(screen.getByRole('button', { name: 'Copy this answer' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sent.filter((entry) => entry.id === 'window.copyText').map((entry) => entry.params)).toStrictEqual([
      { text: 'On 17 March.' },
    ]);
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('ADD AS NOTE hands the answer to the page, once, and then says it was added', async () => {
    const notes: string[] = [];
    await answered({
      onNote: (text) => {
        notes.push(text);
        return true;
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add this answer to the page as a note' }));
    expect(notes).toStrictEqual(['On 17 March.']);
    const done = screen.getByRole('button', { name: 'Added to the page as a note' });
    expect(done.hasAttribute('disabled')).toBe(true);
  });

  it('CONTROL: a note the page could not take is not marked as added', async () => {
    await answered({ onNote: () => false });
    fireEvent.click(screen.getByRole('button', { name: 'Add this answer to the page as a note' }));
    expect(screen.queryByRole('button', { name: 'Added to the page as a note' })).toBeNull();
  });

  it('the caption names the model and what was asked about, from the question', async () => {
    await answered();
    expect(screen.getByText('Model one · page 3')).toBeTruthy();
  });

  it('NEW CHAT empties this document’s conversation', async () => {
    const { store } = await answered();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(store.getState().conversation).toStrictEqual([]);
  });
});
