// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, type EventId, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { EventSubscriber } from './bridge.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';
import { applyFullAppLimits } from './fullAppTestLimit.js';

// THIS FILE RENDERS THE WHOLE APP: the case limit and the wait window of `fullAppTestLimit.ts`.
applyFullAppLimits();

/**
 * Closing a document with unsaved changes, by EVERY route (owner, 2026-09-19).
 *
 * The defect this file exists for: a tab's × and Ctrl+W closed a document holding unsaved
 * changes with no question (the journal's 2026-09-18 entry). The owner's answer is one close
 * path that asks *Save / Don't save / Cancel*, so each route here has a case, and each case
 * that asserts a question has a control proving the same route closes a CLEAN document without
 * one — a path that always asked would satisfy every "it asked" case on its own.
 *
 * The observable is the CALL: whether `document.close`, `document.save` and `window.close` were
 * sent. A dropped tab is also what a close that forgot main would render.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000c1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000c2');

vi.mock('./documentView.js', () => ({
  openDocumentView: () =>
    Promise.resolve({ document: { numPages: 1 }, close: () => Promise.resolve() }),
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: () => Promise.resolve({ width: 595, height: 842 }),
}));

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

/**
 * A client whose documents are unsaved as the case says, and whose save answers as the case
 * says. It opens FIRST, then SECOND.
 */
function client(options: {
  readonly unsaved: readonly DocId[];
  readonly save?: 'saved' | 'write-failed';
}): { readonly client: ContractClient; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const opens = [
    { kind: 'opened' as const, docId: FIRST, version: asDocVersion(1), byteLength: 1024, name: 'report.pdf' },
    { kind: 'opened' as const, docId: SECOND, version: asDocVersion(1), byteLength: 2048, name: 'notes.pdf' },
  ];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const docId = (params as { docId?: DocId }).docId;
    switch (id) {
      case 'document.open':
        return Promise.resolve(ok(opens.shift() ?? { kind: 'cancelled' as const }));
      case 'document.unsaved':
        return Promise.resolve(ok({ unsaved: docId !== undefined && options.unsaved.includes(docId) }));
      case 'document.save':
        return Promise.resolve(
          ok(
            options.save === 'write-failed'
              ? { kind: 'write-failed' as const }
              : { kind: 'saved' as const, version: asDocVersion(2) },
          ),
        );
      case 'document.close':
        return Promise.resolve(ok({ closed: true }));
      case 'window.close':
        return Promise.resolve(ok({ closing: true }));
      case 'window.closeListening':
        return Promise.resolve(ok({ acknowledged: true }));
      case 'document.recent':
        return Promise.resolve(ok({ entries: [], lastExitClean: true }));
      case 'document.readRange':
        return Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(8) }));
      case 'document.viewModel':
        return Promise.resolve(ok({ version: asDocVersion(1), pageCount: 1, rotations: [] }));
      case 'document.pageTextLayer':
        return Promise.resolve(
          ok({ version: asDocVersion(1), lines: [], truncated: false, kind: 'empty' as const }),
        );
      case 'log.reveal':
        return Promise.resolve(ok({ revealed: false }));
      default:
        throw new Error(`this fixture has no answer for ${id}`);
    }
  });
  return { client: built, sent };
}

/** A subscriber the case drives: `push` delivers an event to whatever the app subscribed. */
function events(): { readonly subscribe: EventSubscriber; readonly push: (id: EventId) => void } {
  const handlers = new Map<string, (payload: unknown) => void>();
  const subscribe: EventSubscriber = (id, handler) => {
    handlers.set(id, handler as (payload: unknown) => void);
    return () => {
      handlers.delete(id);
    };
  };
  return {
    subscribe,
    push: (id) => {
      const handler = handlers.get(id);
      if (handler === undefined) throw new Error(`nothing subscribed to ${id}`);
      handler({});
    },
  };
}

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

function freshSettings(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

beforeEach(() => {
  activateCatalogue('en', EN);
  const target: { ResizeObserver: unknown; IntersectionObserver: unknown } = globalThis;
  target.ResizeObserver = class {
    observe(): void {
      // Nothing here measures.
    }
    unobserve(): void {
      // Not called.
    }
    disconnect(): void {
      // Not read.
    }
  };
  target.IntersectionObserver = class {
    observe(): void {
      // Nothing here scrolls.
    }
    unobserve(): void {
      // Not called.
    }
    disconnect(): void {
      // Not read.
    }
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

/** Lets every pending promise chain settle inside `act`. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function openBoth(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Open PDF…' }).click();
    await Promise.resolve();
  });
  await settle();
  await act(async () => {
    screen.getByRole('button', { name: 'Open another document' }).click();
    await Promise.resolve();
  });
  await settle();
}

async function clickTabClose(container: HTMLElement, docId: DocId): Promise<void> {
  const control = container.querySelector(`[data-tab-close="${docId}"]`);
  if (!(control instanceof HTMLButtonElement)) throw new Error(`no close control for ${docId}`);
  await act(async () => {
    control.click();
    await Promise.resolve();
  });
  await settle();
}

async function answer(name: string): Promise<void> {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await settle();
}

function called(sent: readonly Sent[], id: string): readonly unknown[] {
  return sent.filter((call) => call.id === id).map((call) => call.params);
}

describe('a tab’s ×', () => {
  it('CONTROL: closes a document with no unsaved changes without asking', async () => {
    const { client: built, sent } = client({ unsaved: [] });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);

    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
    expect(screen.queryByText(/has changes that are not saved/u)).toBeNull();
  });

  it('asks about unsaved changes, and Cancel closes nothing', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND] });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    expect(await screen.findByText(/“notes\.pdf” has changes that are not saved/u)).toBeTruthy();
    await answer('Cancel');

    expect(called(sent, 'document.close')).toStrictEqual([]);
    expect(called(sent, 'document.save')).toStrictEqual([]);
    expect(container.querySelector(`[data-tab="${SECOND}"]`)).not.toBeNull();
  });

  it('Don’t save closes that document without writing it', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND] });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Don’t save');

    expect(called(sent, 'document.save')).toStrictEqual([]);
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
  });

  it('Save writes the document, then closes it', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND] });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Save');

    expect(called(sent, 'document.save')).toStrictEqual([{ docId: SECOND }]);
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
    // THE ORDER is the property: a close before the save lands would drop the work it saved.
    const order = sent.map((call) => call.id).filter((id) => id === 'document.save' || id === 'document.close');
    expect(order).toStrictEqual(['document.save', 'document.close']);
  });

  it('a Save that does not land closes nothing — invariant 18', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND], save: 'write-failed' });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Save');

    expect(called(sent, 'document.save')).toStrictEqual([{ docId: SECOND }]);
    expect(called(sent, 'document.close')).toStrictEqual([]);
  });
});

describe('Ctrl+W', () => {
  async function pressCtrlW(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true }));
      await Promise.resolve();
    });
    await settle();
  }

  it('CONTROL: closes the focused clean document without asking', async () => {
    const { client: built, sent } = client({ unsaved: [] });
    render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await pressCtrlW();

    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
  });

  it('asks about the focused document’s unsaved changes, through the same path', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND] });
    render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await pressCtrlW();
    await answer('Cancel');

    expect(called(sent, 'document.unsaved')).toStrictEqual([{ docId: SECOND }]);
    expect(called(sent, 'document.close')).toStrictEqual([]);
  });
});

describe('the window’s close, as main pushes it', () => {
  it('TELLS MAIN IT IS LISTENING as it subscribes, so a close cannot be pushed to nobody', async () => {
    // Main holds the window for an answer only once this has arrived (`windowClose.ts`), because a
    // pushed request reaches whoever is subscribed when it is sent. Asserted BEFORE any document is
    // opened: the announcement belongs to the subscription, not to having a document.
    const { client: built, sent } = client({ unsaved: [] });
    const driven = events();
    render(<App client={built} settings={freshSettings()} subscribe={driven.subscribe} />);
    await settle();

    expect(called(sent, 'window.closeListening').length).toBeGreaterThanOrEqual(1);
    // AND THE SUBSCRIPTION IS REALLY THERE: `push` throws where nothing subscribed, so this
    // separates *said it is listening* from *is listening*.
    await act(async () => {
      driven.push('window.close-requested');
      await Promise.resolve();
    });
    await settle();
    expect(called(sent, 'window.close')).toHaveLength(1);
  });

  it('CONTROL: with nothing unsaved, closes every document and then the window', async () => {
    const { client: built, sent } = client({ unsaved: [] });
    const driven = events();
    render(<App client={built} settings={freshSettings()} subscribe={driven.subscribe} />);
    await openBoth();

    await act(async () => {
      driven.push('window.close-requested');
      await Promise.resolve();
    });
    await settle();

    expect(called(sent, 'document.close')).toStrictEqual([{ docId: FIRST }, { docId: SECOND }]);
    expect(called(sent, 'window.close')).toHaveLength(1);
  });

  it('asks about each unsaved document, and a Cancel keeps EVERY document and the window', async () => {
    const { client: built, sent } = client({ unsaved: [FIRST, SECOND] });
    const driven = events();
    render(<App client={built} settings={freshSettings()} subscribe={driven.subscribe} />);
    await openBoth();

    await act(async () => {
      driven.push('window.close-requested');
      await Promise.resolve();
    });
    await settle();
    // THE FIRST IS ANSWERED, the second cancelled: nothing may be released, including the first.
    await screen.findByText(/“report\.pdf” has changes/u);
    await answer('Don’t save');
    await screen.findByText(/“notes\.pdf” has changes/u);
    await answer('Cancel');

    expect(called(sent, 'document.close')).toStrictEqual([]);
    expect(called(sent, 'window.close')).toStrictEqual([]);
  });

  it('closes the window once every question is answered', async () => {
    const { client: built, sent } = client({ unsaved: [FIRST] });
    const driven = events();
    render(<App client={built} settings={freshSettings()} subscribe={driven.subscribe} />);
    await openBoth();

    await act(async () => {
      driven.push('window.close-requested');
      await Promise.resolve();
    });
    await settle();
    await answer('Don’t save');

    expect(called(sent, 'document.close')).toStrictEqual([{ docId: FIRST }, { docId: SECOND }]);
    expect(called(sent, 'window.close')).toHaveLength(1);
  });
});
