// @vitest-environment happy-dom
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { AssistantPanel } from './AssistantPanel.js';
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
function recording(models: readonly { id: string; label: string }[], started = true): {
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
    if (id === 'ai.ask') return Promise.resolve({ ok: true, value: { started } });
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

async function drawn(options: {
  readonly models?: readonly { id: string; label: string }[];
  readonly stored?: readonly string[];
  readonly started?: boolean;
} = {}) {
  const wire = events();
  const { client, sent } = recording(options.models ?? [{ id: 'm-1', label: 'Model one' }], options.started ?? true);
  render(
    <Wrapped>
      <AssistantPanel client={client} storedSecrets={options.stored ?? [ANTHROPIC_KEY]} subscribe={wire.subscribe} />
    </Wrapped>,
  );
  // THE MODEL LIST IS FETCHED ON MOUNT; every case below needs it settled first.
  await act(async () => {
    await Promise.resolve();
  });
  return { sent, push: wire.push };
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
