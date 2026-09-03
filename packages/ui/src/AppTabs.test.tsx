// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { App } from './App.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';

/**
 * Multi-document tabs, driven through `App`.
 *
 * ## What this file exists to separate, and it is not "two tabs appear"
 *
 * §6's per-document store is the claim: one store per `DocId`, dropped on
 * close, which makes *an async result landing in the wrong document's state* a
 * shape nobody can express rather than a race somebody guards. A strip that
 * renders two tabs and shares one set of view state passes every rendering
 * assertion and fails the only one that matters — so the load-bearing case
 * here is that a document REMEMBERS ITS OWN PAGE across a switch, and its
 * control is that the two documents disagree.
 *
 * The fixture gives the two documents DIFFERENT PAGE COUNTS for that reason: a
 * shared count reads correctly for both while being one document's answer, and
 * two-of-two against ten-of-ten is what tells them apart.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000f1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000f2');

/** How many pages each fixture document has, as its parser reports them. */
const PAGES: Readonly<Record<string, number>> = { [FIRST]: 2, [SECOND]: 4 };

// The scroller's parse, per document. `openDocumentView` is called with the
// document, so the stub answers the count that document has — without which
// both tabs would report the same shape and the case below could not tell a
// per-document count from a shared one.
vi.mock('./documentView.js', () => ({
  openDocumentView: ({ docId }: { docId: DocId }) =>
    Promise.resolve({
      document: { numPages: PAGES[docId] ?? 1 },
      close: () => Promise.resolve(),
    }),
}));

vi.mock('./renderPage.js', () => ({
  renderPage: () => Promise.resolve({ width: 595, height: 842 }),
}));

/** One recorded call, with what the renderer sent. */
interface Sent {
  readonly id: string;
  readonly params: unknown;
}

/**
 * A client that opens FIRST, then SECOND, then answers `already-open` for
 * FIRST — which is what main does when a reader picks a file it already holds.
 */
function client(): { readonly client: ContractClient; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const opens = [
    { kind: 'opened' as const, docId: FIRST, version: asDocVersion(1), byteLength: 1024, name: 'annual.pdf' },
    { kind: 'opened' as const, docId: SECOND, version: asDocVersion(1), byteLength: 2048, name: 'notes.pdf' },
    { kind: 'already-open' as const, docId: FIRST },
  ];

  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'document.open') {
      return Promise.resolve(ok(opens.shift() ?? { kind: 'cancelled' as const }));
    }
    if (id === 'document.close') return Promise.resolve(ok({ closed: true }));
    if (id === 'document.recent') {
      return Promise.resolve(ok({ entries: [], lastExitClean: true }));
    }
    if (id === 'document.readRange') {
      return Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(8) }));
    }
    if (id === 'document.viewModel') {
      const docId = (params as { docId: DocId }).docId;
      return Promise.resolve(
        ok({
          version: asDocVersion(1),
          pageCount: PAGES[docId] ?? 1,
          rotations: [],
        }),
      );
    }
    if (id === 'log.reveal') return Promise.resolve(ok({ revealed: false }));
    throw new Error(`this fixture has no answer for ${id}`);
  });
  return { client: built, sent };
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

/** Every observer built during a case, with the callback it was given. */
let observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = [];

beforeEach(() => {
  activateCatalogue('en', EN);
  observers = [];

  const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
  resize.ResizeObserver = class {
    observe(): void {
      // Nothing here measures a viewport.
    }
    unobserve(): void {
      // Not called by these components.
    }
    disconnect(): void {
      // Recorded by absence.
    }
  };

  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, observed: [] });
    }
    observe(element: Element): void {
      observers[observers.length - 1]?.observed.push(element);
    }
    unobserve(): void {
      // Nothing here reads the unobserved set.
    }
    disconnect(): void {
      // Recorded by absence.
    }
  } as unknown as typeof IntersectionObserver;

  // `scrollIntoView` is not implemented by happy-dom and the scroller calls it
  // on every restored page. A no-op is enough: what the cases below read is the
  // page the STORE holds, and the scroll is what a real observer would answer.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: (): void => undefined,
  });
});

/** Tells the scroller that this page, and only this page, is on screen. */
function scrolledTo(page: number): void {
  for (const observer of observers) {
    const slots = observer.observed.filter(
      (element) => element instanceof HTMLElement && element.classList.contains('m-page-slot'),
    );
    if (slots.length === 0) continue;
    observer.callback(
      slots.map(
        (slot) =>
          ({
            target: slot,
            isIntersecting: (slot as HTMLElement).dataset['page'] === String(page),
          }) as unknown as IntersectionObserverEntry,
      ),
      {} as unknown as IntersectionObserver,
    );
    return;
  }
  throw new Error('no scroller slots are observed');
}

/** Dispatches the open command and settles it. */
async function openOne(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Open a document' }).click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Clicks one control found by an attribute selector. */
async function press(container: HTMLElement, selector: string): Promise<void> {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLButtonElement)) throw new Error(`no control for ${selector}`);
  await act(async () => {
    control.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('multi-document tabs', () => {
  it('opens a SECOND document beside the first and brings it forward', async () => {
    const { client: built } = client();
    const { container } = render(<App client={built} settings={freshSettings()} />);

    await openOne();
    expect(container.querySelectorAll('.m-tab')).toHaveLength(1);

    // THROUGH THE STRIP'S OWN CONTROL, which is the only visible route to a
    // second document: the start screen is gone once one is open, and a chord
    // or the palette is a route for people who already know it is there.
    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const tabs = container.querySelectorAll('.m-tab');
    expect(tabs).toHaveLength(2);
    // THE NEW ONE IS ACTIVE. A strip that appended without activating leaves
    // the reader looking at the document they had, having just asked for
    // another — and renders exactly the same two tabs.
    expect(container.querySelector('[aria-current="true"]')?.getAttribute('data-tab-select')).toBe(
      SECOND,
    );
    expect(container.querySelector('.m-status-name')?.textContent).toBe('notes.pdf');
  });

  it('REMEMBERS EACH DOCUMENT’S OWN PAGE across a switch', async () => {
    // THE LOAD-BEARING CASE, and §6 is the claim it tests. The reader moves in
    // the first document, opens a second, and comes back; a build with one
    // shared page — which is what `App` held before tabs — lands on whatever
    // the second document was showing.
    const { client: built } = client();
    const { container } = render(<App client={built} settings={freshSettings()} />);

    await openOne();
    await act(async () => {
      scrolledTo(1);
      await Promise.resolve();
    });
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');

    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // THE SECOND DOCUMENT IS ON ITS OWN FIRST PAGE, and its count is its own.
    // Without the differing counts this assertion could not tell a
    // per-document page count from the first document's.
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 1 of 4');

    await press(container, `[data-tab-select="${FIRST}"]`);

    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');
  });

  it('CLOSES the document at main, not only the tab', async () => {
    // A tab strip that dropped its own state and left main holding the bytes
    // would look identical from here and spend the capacity ceiling on
    // documents nothing can reach. So the assertion is the CALL.
    const { client: built, sent } = client();
    const { container } = render(<App client={built} settings={freshSettings()} />);

    await openOne();
    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await press(container, `[data-tab-close="${SECOND}"]`);

    const closes = sent.filter((call) => call.id === 'document.close');
    expect(closes).toHaveLength(1);
    expect(closes[0]?.params).toStrictEqual({ docId: SECOND });
    // AND THE NEIGHBOUR TO THE LEFT IS ACTIVE. Closing the focused tab has to
    // leave the reader somewhere, and "somewhere" is a decision: a build that
    // left `activeId` naming a closed document shows the start screen with a
    // tab still in the strip.
    expect(container.querySelectorAll('.m-tab')).toHaveLength(1);
    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
  });

  it('ACTIVATES the existing tab when the picked file is already open', async () => {
    // `already-open` carried no state and had nowhere to go while one document
    // was on screen. It has somewhere now, and the wrong answer is a SECOND
    // tab for one document — which is what appending on every open produces
    // and what nothing in the outcome itself prevents.
    const { client: built } = client();
    const { container } = render(<App client={built} settings={freshSettings()} />);

    await openOne();
    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.m-status-name')?.textContent).toBe('notes.pdf');

    // The third open answers `already-open` for the FIRST document.
    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('.m-tab')).toHaveLength(2);
    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
  });
});
