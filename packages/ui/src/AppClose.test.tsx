// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, type EventId, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render as renderBare, screen, within } from '@testing-library/react';
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
  /**
   * How many redaction marks nobody has applied each document carries (item N1). An applied burn-in leaves none and
   * leaves the document unsaved, as main's do.
   */
  readonly marked?: Readonly<Partial<Record<DocId, number>>>;
}): { readonly client: ContractClient; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const unsaved = new Set<DocId>(options.unsaved);
  const marked = new Map<DocId, number>(Object.entries(options.marked ?? {}) as [DocId, number][]);
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
        return Promise.resolve(ok({ unsaved: docId !== undefined && unsaved.has(docId) }));
      case 'document.annotations': {
        // THE MARKS AND A SQUARE BESIDE THEM: a count of every annotation would ask about a document whose only
        // annotation is a square, and the controls below would not see it.
        const marks = docId === undefined ? 0 : (marked.get(docId) ?? 0);
        return Promise.resolve(
          ok({
            version: asDocVersion(1),
            annotations: [
              ...Array.from({ length: marks }, (_unused, index) => ({ kind: 'redact' as const, index })),
              { kind: 'square' as const, index: marks },
            ].map(({ kind, index }) => ({
              page: 0,
              index,
              rect: { x0: 10, y0: 10, x1: 50, y1: 30 },
              inReplyTo: null,
              kind,
              style: { colour: [0, 0, 0], opacity: 1, borderWidth: null },
              contents: '',
              authored: true,
              author: '',
              created: null,
              blend: 'normal' as const,
            })),
            next: null,
            truncated: false,
          }),
        );
      }
      case 'document.execute':
        if (docId !== undefined) {
          marked.delete(docId);
          unsaved.add(docId);
        }
        return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 1024, historyDropped: 0, boxed: [], more: 0 }));
      case 'document.save':
        return Promise.resolve(
          ok(
            options.save === 'write-failed'
              ? { kind: 'write-failed' as const, cause: 'unknown' as const }
              : { kind: 'saved' as const, version: asDocVersion(2), cleared: null, held: [] },
          ),
        );
      case 'document.close':
        return Promise.resolve(ok({ closed: true }));
      case 'window.close':
        return Promise.resolve(ok({ closing: true }));
      case 'window.closeListening':
        return Promise.resolve(ok({ acknowledged: true }));
      // EVERY OPEN ASKS whether the file can be saved over (cloud-4 7b).
      case 'document.fileAccess':
        return Promise.resolve(ok({ access: 'writable' as const }));
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

    // FIRST ASKED WITHOUT BREAKING A SIGNATURE: the close's Save is the attended one, so a document it would break
    // is answered `breaks-signatures` and the warning asks — the same save the Save command sends.
    expect(called(sent, 'document.save')).toStrictEqual([{ docId: SECOND, breakSignatures: false }]);
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

    // FIRST ASKED WITHOUT BREAKING A SIGNATURE: the close's Save is the attended one, so a document it would break
    // is answered `breaks-signatures` and the warning asks — the same save the Save command sends.
    expect(called(sent, 'document.save')).toStrictEqual([{ docId: SECOND, breakSignatures: false }]);
    expect(called(sent, 'document.close')).toStrictEqual([]);
  });
});

/**
 * REDACTION MARKS NOBODY APPLIED, at the close (the owner's item N1).
 *
 * The observable is the call, again: whether `document.execute` carried the burn-in, and whether `document.save` and
 * `document.close` were sent, in what order. A close that asked and then did nothing with the answer renders the same
 * dialog as one that works.
 */
describe('a tab’s × on a document carrying marks nobody applied (item N1)', () => {
  const QUESTION = /2 parts of this document are marked for redaction, but they have not been removed yet\./u;
  // ANY COUNT, for the cases that assert the question was NOT asked: a pattern on words the dialog no longer says
  // would pass whatever happened.
  const ASKED = /marked for redaction, but/u;

  it('CONTROL: a saved document whose only annotation is a square closes without a question', async () => {
    // THE SQUARE IS THE POINT: a close that counted every annotation would ask here.
    const { client: built, sent } = client({ unsaved: [], marked: { [SECOND]: 0 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);

    expect(screen.queryByText(ASKED)).toBeNull();
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
  });

  it('asks about a SAVED document’s marks, and Cancel applies nothing and closes nothing', async () => {
    const { client: built, sent } = client({ unsaved: [], marked: { [SECOND]: 2 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    await answer('Cancel');

    expect(called(sent, 'document.execute')).toStrictEqual([]);
    expect(called(sent, 'document.close')).toStrictEqual([]);
    expect(container.querySelector(`[data-tab="${SECOND}"]`)).not.toBeNull();
  });

  it('Close without applying closes it, writing nothing and burning in nothing', async () => {
    const { client: built, sent } = client({ unsaved: [], marked: { [SECOND]: 2 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Close without applying');

    expect(called(sent, 'document.execute')).toStrictEqual([]);
    expect(called(sent, 'document.save')).toStrictEqual([]);
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
  });

  it('Apply burns in every page’s marks, then asks whether to keep that — and Save writes it before the close', async () => {
    const { client: built, sent } = client({ unsaved: [], marked: { [SECOND]: 2 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Apply');
    // THE BURN-IN, with the choices the Apply redactions dialog starts on, over the whole document.
    expect(called(sent, 'document.execute')).toStrictEqual([
      {
        docId: SECOND,
        command: { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels', keepTitle: false },
      },
    ]);
    // AND NOTHING CLOSED YET: the burn-in is an unsaved change, so the close asks about it.
    expect(called(sent, 'document.close')).toStrictEqual([]);
    expect(await screen.findByText(/“notes\.pdf” has changes that are not saved/u)).toBeTruthy();
    await answer('Save');

    // NOT ASKED AGAIN: the save that follows counts no marks. Its question would be the second dialog in a row.
    expect(screen.queryByText(ASKED)).toBeNull();
    const order = sent
      .map((call) => call.id)
      .filter((id) => id === 'document.execute' || id === 'document.save' || id === 'document.close');
    expect(order).toStrictEqual(['document.execute', 'document.save', 'document.close']);
  });

  it('a document with UNSAVED changes is asked on its Save answer — Save without applying writes the marks as marks', async () => {
    const { client: built, sent } = client({ unsaved: [SECOND], marked: { [SECOND]: 2 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    // THE CLOSE'S OWN QUESTION FIRST: the marks question belongs to the write, and Don't save writes nothing.
    await screen.findByText(/“notes\.pdf” has changes that are not saved/u);
    expect(screen.queryByText(ASKED)).toBeNull();
    await answer('Save');
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    await answer('Save without applying');

    expect(called(sent, 'document.execute')).toStrictEqual([]);
    expect(called(sent, 'document.save')).toStrictEqual([{ docId: SECOND, breakSignatures: false }]);
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
  });

  it('CONTROL: Don’t save on a document with unsaved changes closes it with no marks question', async () => {
    // WITHOUT THIS the case above passes for a close that asked about marks before every answer.
    const { client: built, sent } = client({ unsaved: [SECOND], marked: { [SECOND]: 2 } });
    const { container } = render(<App client={built} settings={freshSettings()} />);
    await openBoth();

    await clickTabClose(container, SECOND);
    await answer('Don’t save');

    expect(screen.queryByText(ASKED)).toBeNull();
    expect(called(sent, 'document.execute')).toStrictEqual([]);
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: SECOND }]);
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

/** *File › Exit*, chosen the way a person chooses it: the File menu opened on the menu bar, the item pressed. */
async function exitFromTheMenu(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'File' }));
    await Promise.resolve();
  });
  const exit = await screen.findByRole('menuitem', { name: 'Exit' });
  await act(async () => {
    fireEvent.click(exit);
    await Promise.resolve();
  });
  await settle();
}

describe('File › Exit (ADR-0107)', () => {
  it('asks EXACTLY what the window’s × asks, and a Cancel keeps every document and the window', async () => {
    // THE OWNER'S CONDITION: Exit goes through the same close path — never quits without asking.
    const { client: built, sent } = client({ unsaved: [FIRST, SECOND] });
    render(<App client={built} settings={freshSettings()} subscribe={events().subscribe} />);
    await openBoth();

    await exitFromTheMenu();
    await screen.findByText(/“report\.pdf” has changes/u);
    await answer('Don’t save');
    await screen.findByText(/“notes\.pdf” has changes/u);
    await answer('Cancel');

    expect(called(sent, 'document.close')).toStrictEqual([]);
    expect(called(sent, 'window.close')).toStrictEqual([]);
  });

  it('CONTROL: with nothing unsaved, closes every document and then the window, asking nothing', async () => {
    const { client: built, sent } = client({ unsaved: [] });
    render(<App client={built} settings={freshSettings()} subscribe={events().subscribe} />);
    await openBoth();

    await exitFromTheMenu();

    expect(screen.queryByText(/has changes/u)).toBeNull();
    expect(called(sent, 'document.close')).toStrictEqual([{ docId: FIRST }, { docId: SECOND }]);
    expect(called(sent, 'window.close')).toHaveLength(1);
  });
});
