// @vitest-environment happy-dom
import { type AskSent, type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type AssistantDocument, AssistantPanel, type AssistantPanelProps } from './AssistantPanel.js';
import type { AssistantRequest } from './assistantRequest.js';
import { createDocumentStore } from './documentStores.js';
import {
  ASSISTANT_PROMPT_DRAFT_REPLY,
  ASSISTANT_PROMPT_EXPLAIN,
  ASSISTANT_PROMPT_SUMMARISE_COMMENTS,
} from './messages/en.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN, TOAST_COPIED } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';

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
  /** What main answers a copy: whether the text reached the clipboard. */
  copied = true,
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
    if (id === 'ai.openSource') return Promise.resolve({ ok: true, value: { opened: true } });
    if (id === 'window.copyText') return Promise.resolve({ ok: true, value: { copied } });
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

/** An answer's end when the web took no part — what `main` sends for every *Document only* answer (ADR-0108). */
const NO_WEB = { answer: 'a0', searched: false, sources: [] } as const;

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
  readonly settings?: SettingsStore;
  readonly copied?: boolean;
} = {}) {
  const wire = events();
  const settings = options.settings ?? new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const { client, sent } = recording(
    options.models ?? [{ id: 'm-1', label: 'Model one' }],
    options.started ?? true,
    options.window ?? null,
    options.alongside,
    options.copied ?? true,
  );
  // EVERY TOAST THE PANEL RAISES, in order: a copy's confirmation goes through the window's toast.
  const toasts: unknown[][] = [];
  const panel = (props: Partial<AssistantPanelProps> & { readonly mount?: number }): ReactElement => (
    <Wrapped>
      <Host
        client={client}
        toast={(...raised) => {
          toasts.push(raised);
        }}
        focused={options.focused}
        beside={options.beside}
        onGoToBeside={options.onGoToBeside}
        onGoTo={options.onGoTo}
        onReply={options.onReply}
        onNote={options.onNote}
        request={options.request}
        storedSecrets={options.stored ?? [ANTHROPIC_KEY]}
        settings={settings}
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
    toasts,
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

/** A choice menu — *Context: …* or *Sources: …* — found by its name, which reads what is chosen and the value. */
function choiceButton(menu: 'Context' | 'Sources'): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${menu}: `, 'u') });
}

/** What a choice menu says is chosen: the words on its face, which are the value alone. */
function chosenIn(menu: 'Context' | 'Sources'): string {
  return choiceButton(menu).textContent;
}

/** Opens a choice menu and answers its values as offered, each a radio item. */
async function valuesIn(menu: 'Context' | 'Sources'): Promise<HTMLElement[]> {
  fireEvent.click(choiceButton(menu));
  return screen.findAllByRole('menuitemradio');
}

/** The value labelled `label` in an OPEN choice menu, or `undefined` when it is not offered. */
function valueNamed(values: readonly HTMLElement[], label: string | RegExp): HTMLElement | undefined {
  return values.find((value) => (typeof label === 'string' ? value.textContent === label : label.test(value.textContent)));
}

/** Closes an open choice menu without choosing. */
async function closeChoices(): Promise<void> {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Chooses a value in a choice menu, by the label it shows. */
async function chooseIn(menu: 'Context' | 'Sources', label: string | RegExp): Promise<void> {
  const value = valueNamed(await valuesIn(menu), label);
  if (value === undefined) throw new Error(`${menu} offers no ${String(label)}`);
  fireEvent.click(value);
  await act(async () => {
    await Promise.resolve();
  });
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

    push('ai.done', { subscription, stopped: true, web: NO_WEB });
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
    push('ai.done', { subscription, stopped: false, refusal: 'unauthorised', web: NO_WEB });

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

    push('ai.done', { subscription, stopped: false, refusal: 'out-of-credit', web: NO_WEB });

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
    // AND THE PICKER ITSELF SAYS IT, where it used to draw an empty box with an arrow.
    const picker = document.querySelector<HTMLSelectElement>('[data-assistant-model]');
    expect(picker?.disabled).toBe(true);
    expect(picker?.selectedOptions[0]?.textContent).toBe('No models to choose from');
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

  /** Chooses one of the Context values (until 2026-10-01 the "Asking about" buttons), by the label it shows. */
  async function about(label: 'Selection' | 'Comment' | 'Document' | 'Comments' | 'Picture' | 'None' | RegExp): Promise<void> {
    await chooseIn('Context', label);
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

  it('names the page as a person reads it and the provider by name beside Send, and asks about THAT page', async () => {
    const { sent } = await drawn({ focused: focusedOn() });

    expect(chosenIn('Context')).toBe('Page 7');
    // THE PROVIDER IS NAMED BY THE PICKER BESIDE SEND, and no separate line restates it (ARCHITECTURE §8, the owner's
    // decision of 2026-10-01). The picker's shown value is the positive half, so the absence below is not a blank pane.
    const picker = screen.getByRole('combobox', { name: 'Provider' });
    expect(within(picker).getByRole('option', { name: 'Anthropic', selected: true })).toBeTruthy();
    expect(screen.queryByText(/only when you press Send/u)).toBeNull();
    expect(screen.queryByText(/This page \(7\)/u)).toBeNull();
    // THE PROVIDER LIST SAYS NAMES, never the registry's ids.
    expect(screen.getByRole('option', { name: 'Google Gemini' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'anthropic' })).toBeNull();

    type('What does this page say?');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'page', docId: DOC_A, page: 6 });
  });

  it('asks about the whole document when chosen', async () => {
    const { sent } = await drawn({ focused: focusedOn() });

    await about('Document');
    type('Summarise it');
    await send();
    expect(lastAbout(sent)).toStrictEqual({ scope: 'document', docId: DOC_A });
  });

  describe('Document only / Document + web (ADR-0108)', () => {
    /** Chooses one side of the switch, in the Sources menu (until 2026-10-01 *Answer from*). */
    async function answerFrom(label: 'Document only' | 'Document + web'): Promise<void> {
      await chooseIn('Sources', label);
    }
    /** Whether a Sources value is offered disabled, read with the menu open and closed again after. */
    async function sourceDisabled(label: 'Document only' | 'Document + web'): Promise<boolean> {
      const value = valueNamed(await valuesIn('Sources'), label);
      const disabled = value?.getAttribute('aria-disabled') === 'true';
      await closeChoices();
      return disabled;
    }
    /** The `web` the last ask carried. */
    function lastWeb(sent: readonly { id: string; params: unknown }[]): unknown {
      return (sent.filter((entry) => entry.id === 'ai.ask').at(-1)?.params as { web?: unknown } | undefined)?.web;
    }
    const lastSubscription = (sent: readonly { id: string; params: unknown }[]): string =>
      (sent.filter((entry) => entry.id === 'ai.ask').at(-1)?.params as { subscription: string }).subscription;

    it('starts DOCUMENT ONLY, asks with the web only once chosen, and draws no web note in the pane', async () => {
      const { sent, push } = await drawn({ focused: focusedOn() });
      expect(chosenIn('Sources')).toBe('Document only');

      type('First');
      await send();
      expect(lastWeb(sent)).toBe(false);
      push('ai.done', { subscription: lastSubscription(sent), stopped: false, web: NO_WEB });

      await answerFrom('Document + web');
      // THE NOTE LIVES IN HELP, not in the pane (the owner's decision, ADR-0108's correction of 2026-10-01). Read with
      // the web CHOSEN, which is the only state that ever drew it, so the absence is not the Document-only default's.
      expect(chosenIn('Sources')).toBe('Document + web');
      expect(screen.queryByText(/search engine/u)).toBeNull();
      type('Second');
      await send();
      expect(lastWeb(sent)).toBe(true);
    });

    it('a NEW CHAT starts Document only again, and CONTROL: another document never inherits the choice', async () => {
      const a = focusedOn();
      const { sent, push, redraw } = await drawn({ focused: a });
      await answerFrom('Document + web');
      type('Asked with the web');
      await send();
      push('ai.delta', { subscription: lastSubscription(sent), text: 'An answer.' });
      push('ai.done', { subscription: lastSubscription(sent), stopped: false, web: NO_WEB });

      await redraw({ focused: focusedOn(DOC_B) });
      expect(chosenIn('Sources')).toBe('Document only');

      // BACK ON THE SAME DOCUMENT'S CHAT the choice still stands — it is that conversation's.
      await redraw({ focused: a });
      expect(chosenIn('Sources')).toBe('Document + web');
      fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
      expect(chosenIn('Sources')).toBe('Document only');
    });

    it('DISABLES the web, with the reason, for a provider that cannot search — and CONTROL: Anthropic can', async () => {
      await drawn({ focused: focusedOn(), stored: [ANTHROPIC_KEY, 'ai.gemini-key'] });
      expect(await sourceDisabled('Document + web')).toBe(false);

      fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } });
      await act(async () => {
        await Promise.resolve();
      });
      expect(await sourceDisabled('Document + web')).toBe(true);
      expect(screen.getByText('Web search isn’t available with this provider in Monstera.')).toBeDefined();
    });

    it('shows the web sources under the answer, opens one BY ITS PLACE, and says when no search was used', async () => {
      const { sent, push } = await drawn({ focused: focusedOn() });
      await answerFrom('Document + web');
      type('When was it built?');
      await send();
      const subscription = lastSubscription(sent);
      push('ai.delta', { subscription, text: 'It was built in 1912.' });
      push('ai.done', {
        subscription,
        stopped: false,
        web: {
          answer: 'a7',
          searched: true,
          sources: [
            { title: 'City archive', host: 'example.net' },
            { title: 'City history', host: 'example.org' },
          ],
        },
      });

      // THE SECOND SOURCE, so a panel that always sent index 0 is told apart from one that sends the place pressed.
      const sources = screen.getByRole('group', { name: 'From the web' });
      fireEvent.click(within(sources).getByRole('button', { name: 'City history · example.org' }));
      expect(sent.find((entry) => entry.id === 'ai.openSource')?.params).toStrictEqual({ answer: 'a7', index: 1 });
      expect(screen.queryByText('No web search was used for this answer.')).toBeNull();

      // A SECOND ANSWER THAT DID NOT SEARCH says so, with the web on.
      type('And the architect?');
      await send();
      const second = lastSubscription(sent);
      push('ai.delta', { subscription: second, text: 'Not in the document.' });
      push('ai.done', { subscription: second, stopped: false, web: { answer: 'a8', searched: false, sources: [] } });
      expect(screen.getByText('No web search was used for this answer.')).toBeDefined();
    });

    it('CONTROL: a Document-only answer never says "no web search", and an uncited answer about the document is marked', async () => {
      const { sent, push } = await drawn({ focused: focusedOn() });
      type('What does it say?');
      await send();
      const subscription = lastSubscription(sent);
      push('ai.delta', { subscription, text: 'It is about bridges.' });
      push('ai.done', { subscription, stopped: false, web: NO_WEB });
      expect(screen.queryByText('No web search was used for this answer.')).toBeNull();
      // ITEM 5c: no `[p. N]` anywhere in the answer, and the question was about the document.
      expect(screen.getByText('No page cited — check this against the document.')).toBeDefined();
    });

    it('CONTROL: an answer that cites a page is NOT marked uncited', async () => {
      const { sent, push } = await drawn({ focused: focusedOn() });
      type('What does it say?');
      await send();
      const subscription = lastSubscription(sent);
      push('ai.delta', { subscription, text: 'Bridges, as on [p. 7].' });
      push('ai.done', { subscription, stopped: false, web: NO_WEB });
      expect(screen.queryByText('No page cited — check this against the document.')).toBeNull();
    });
  });

  it('CONTROL: an ask about nothing carries no scope at all', async () => {
    const { sent, push } = await drawn({ focused: focusedOn() });
    await about('None');
    type('Just a question');
    await send();
    const subscription = (sent.find((entry) => entry.id === 'ai.ask')?.params as { subscription: string }).subscription;
    push('ai.done', { subscription, stopped: false, web: NO_WEB });
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(true);
    expect(lastAbout(sent)).toBeUndefined();
  });

  it('says under the question which pages went, from main’s answer rather than the scope it meant', async () => {
    await drawn({
      focused: focusedOn(),
      window: { firstPage: 0, lastPage: 11, pageCount: 40, characters: 99_870, truncated: true },
    });
    await about('Document');
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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

    expect(b.store.getState().conversation).toStrictEqual([]);
    expect(a.store.getState().conversation.at(-1)).toStrictEqual({ role: 'assistant', text: 'late words' });
  });

  it('a command’s request asks at once about the words it names, and the menu offers that selection', async () => {
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
    expect(chosenIn('Context')).toBe('Selection');
  });

  it('CONTROL: a selection from ANOTHER document is not offered, so the menu never offers words not on show', async () => {
    const request: AssistantRequest = {
      serial: 1,
      about: { scope: 'selection', docId: DOC_B, page: 2, text: 'words from B' },
    };
    await drawn({ focused: focusedOn(DOC_A), request });
    // THE MENU, the one place the positive case above finds the selection since the line under it went (ADR-0088's
    // correction of 2026-10-01). This queried an `option` until the audit of 1e1bfad..e24eca0e: the choices became
    // buttons in 44250155 and no option exists, so the case passed whatever the panel drew. Since 2026-10-01 they are
    // the Context menu's values, read with it OPEN — a closed menu holds no value at all, which would pass this the
    // same way.
    const values = await valuesIn('Context');
    expect(valueNamed(values, 'Page 7')).toBeDefined();
    expect(valueNamed(values, 'Selection')).toBeUndefined();
    await closeChoices();
  });

  const box = (): HTMLTextAreaElement => screen.getByLabelText('Ask about this document');
  const QUOTING: AssistantRequest = {
    serial: 1,
    about: { scope: 'selection', docId: DOC_A, page: 2, text: 'the indemnity clause' },
    quote: 'the indemnity clause',
  };

  it('ASK AI quotes the words in the box with a space and the cursor after them, sends nothing, and stays on Selection', async () => {
    const { sent } = await drawn({ focused: focusedOn(), request: QUOTING });
    const field = box();
    expect(field.value).toBe('“the indemnity clause” ');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toStrictEqual([field.value.length, field.value.length]);
    expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);
    expect(chosenIn('Context')).toBe('Selection');
  });

  it('CONTROL: a quote already handled is not written again when the panel remounts', async () => {
    const { redraw } = await drawn({ focused: focusedOn(), request: QUOTING });
    expect(box().value).toBe('“the indemnity clause” ');
    // A REMOUNT under the host that keeps the handled serial, as `App` does when the panel closes and opens: the box
    // starts empty, and a quote written again would put back words the person may have sent or deleted.
    await redraw({ mount: 2 });
    expect(box().value).toBe('');
  });

  it('names a COMMENT as a comment in the menu, and asks with the comment scope', async () => {
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

    expect(chosenIn('Context')).toBe('Comment');
    // CONTROL: the selection's wording is not borrowed.
    const values = await valuesIn('Context');
    expect(valueNamed(values, 'Comment')).toBeDefined();
    expect(valueNamed(values, 'Selection')).toBeUndefined();
    await closeChoices();
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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });
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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
    push('ai.done', { subscription, stopped: false, web: NO_WEB });
    expect(screen.queryByRole('button', { name: 'Post as a reply' })).toBeNull();
  });

  describe('the empty box shows ONE FIXED placeholder (the owner’s decision, 2026-10-01)', () => {
    const box = (): HTMLTextAreaElement => screen.getByLabelText('Ask about this document');

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads “Ask about this page…” and still does while empty, unfocused and time passes, sending nothing', async () => {
      // EMPTY AND UNFOCUSED is the state the rotation moved in until 2026-10-01, and twelve seconds is three of its
      // turns, so a timer brought back fails here rather than reading as the first suggestion.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      const { sent } = await drawn({ focused: focusedOn() });
      expect(box().placeholder).toBe('Ask about this page…');
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(box().placeholder).toBe('Ask about this page…');
      expect(sent.some((entry) => entry.id === 'ai.ask')).toBe(false);
    });
  });

  it('SUMMARISE COMMENTS: the command’s request asks at once about the comments, and the menu names them', async () => {
    const { sent } = await drawn({
      focused: focusedOn(),
      request: { serial: 1, about: { scope: 'comments', docId: DOC_A }, prompt: ASSISTANT_PROMPT_SUMMARISE_COMMENTS },
    });
    expect(lastAbout(sent)).toStrictEqual({ scope: 'comments', docId: DOC_A });
    expect(chosenIn('Context')).toBe('Comments');
  });

  describe('a picture of the page — vision analysis (ADR-0090)', () => {
    it('Context › Picture asks about a PICTURE of the page on screen, and the turn says a picture went', async () => {
      const { sent } = await drawn({
        focused: focusedOn(),
        window: { firstPage: 6, lastPage: 6, pageCount: 9, characters: 0, truncated: false, picture: true },
      });
      await about('Picture');
      type('Read the table on this page');
      await send();
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
      await about('Picture');
      fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'm-blind' } });
      expect(valueNamed(await valuesIn('Context'), 'Picture')?.getAttribute('aria-disabled')).toBe('true');
      await closeChoices();

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
      const picture = valueNamed(await valuesIn('Context'), 'Picture');
      expect(picture).toBeDefined();
      expect(picture?.getAttribute('aria-disabled')).not.toBe('true');
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

    it('asks BEFORE sending: nothing chosen, Send waits, and pressing Send sends nothing', async () => {
      const { sent } = await drawn({ focused: focusedOn(), beside: BESIDE });

      const radios = screen.getAllByRole('radio');
      expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toStrictEqual([false, false, false]);
      expect(screen.getByText('Two documents are side by side. Choose Left, Right or Both, then send.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);

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

    it('RIGHT sends the right document alone, and the Context menu names the right pane’s page', async () => {
      const { sent } = await drawn({ focused: focusedOn(), beside: BESIDE });

      pick('Right');
      expect(chosenIn('Context')).toBe('Page 3');
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
      push('ai.done', { subscription, stopped: false, web: NO_WEB });

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
      push('ai.done', { subscription, stopped: false, web: NO_WEB });
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
    harness.push('ai.done', { subscription, stopped: false, web: NO_WEB });
    return { ...harness, store };
  }

  const asks = (sent: readonly { id: string; params: unknown }[]) =>
    sent.filter((entry) => entry.id === 'ai.ask').map((entry) => entry.params as { messages: { text: string }[]; about?: unknown });

  it('REGENERATE asks the same question about the SAME scope again, and replaces the answer', async () => {
    const { sent, store } = await answered();
    // CONTROL of the premise: move the Context choice away, so re-asking "what the line says
    // now" would send the whole document instead of page 3.
    await chooseIn('Context', 'Document');
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
    const { sent, toasts } = await answered();
    fireEvent.click(screen.getByRole('button', { name: 'Copy this answer' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sent.filter((entry) => entry.id === 'window.copyText').map((entry) => entry.params)).toStrictEqual([
      { text: 'On 17 March.' },
    ]);
    // EVERY COPY'S ONE CONFIRMATION, the window's toast.
    expect(toasts).toStrictEqual([['done', TOAST_COPIED]]);
  });

  it('CONTROL: a copy main says did not reach the clipboard says nothing', async () => {
    const { sent, toasts } = await answered({ copied: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy this answer' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sent.some((entry) => entry.id === 'window.copyText')).toBe(true);
    expect(toasts).toStrictEqual([]);
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

describe('the provider and each provider’s model are SETTINGS (ADR-0117)', () => {
  const modelSelect = (): HTMLSelectElement => {
    const select = document.querySelector('[data-assistant-model]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('the model picker is drawn');
    return select;
  };
  const providerSelect = (): HTMLSelectElement => {
    const select = document.querySelector('[data-assistant-provider]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('the provider picker is drawn');
    return select;
  };

  it('with nothing chosen shows the first model the use can take; one that SAYS it cannot see is listed, disabled', async () => {
    // THE SEPARATING LIST: its first model says it has no vision, so a default ignoring the use selects it — and
    // Anthropic's choice reads images, being the recogniser's too.
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    await drawn({
      settings,
      models: [
        { id: 'blind', label: 'Blind', vision: false },
        { id: 'sees', label: 'Sees', vision: null },
      ],
    });
    expect(modelSelect().value).toBe('sees');
    const blind = screen.getByRole('option', { name: 'Blind (cannot read images)' });
    expect((blind as HTMLOptionElement).disabled).toBe(true);
    // NOTHING WAS STORED: a default is shown, never written, so an updated list moves it.
    expect(settings.get('ai.models')).toStrictEqual({});
  });

  it('a choice is stored PER PROVIDER — another provider’s choice leaves Anthropic’s, the recogniser’s, in place', async () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    await drawn({
      settings,
      models: [
        { id: 'm-1', label: 'Model one' },
        { id: 'm-2', label: 'Model two' },
      ],
    });
    fireEvent.change(modelSelect(), { target: { value: 'm-2' } });
    expect(settings.get('ai.models')).toStrictEqual({ anthropic: 'm-2' });

    await act(async () => {
      fireEvent.change(providerSelect(), { target: { value: 'openai' } });
      await Promise.resolve();
    });
    expect(settings.get('ai.provider')).toBe('openai');
    fireEvent.change(modelSelect(), { target: { value: 'm-1' } });
    // ONE STRING would now read `m-1` for both — and the recogniser would send an OpenAI choice to Anthropic.
    expect(settings.get('ai.models')).toStrictEqual({ anthropic: 'm-2', openai: 'm-1' });
  });

  it('a stored model the list no longer names stays chosen, MARKED, and is what an ask sends — never silently swapped', async () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.set('ai.models', { anthropic: 'retired-model' });
    const { sent } = await drawn({ settings });
    expect(modelSelect().value).toBe('retired-model');
    expect(screen.getByRole('option', { name: 'retired-model (not offered now)' })).toBeTruthy();

    type('Still there?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(sent.find((entry) => entry.id === 'ai.ask')?.params).toMatchObject({ model: 'retired-model' });
  });
});
