// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render as renderBare, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { App } from './App.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';
import { CONTEXT_PANEL_OPEN_SETTING, CONTEXT_PANEL_TAB_SETTING, RIBBON_SECTION_SETTING } from './settings/layout.js';
import { SPLIT_VIEW_SETTING } from './settings/viewing.js';
import { applyFullAppLimits } from './fullAppTestLimit.js';

// THIS FILE RENDERS THE WHOLE APP: the case limit and the wait window of `fullAppTestLimit.ts`.
applyFullAppLimits();

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
/** Every view opened, with the version it was bound to and the move callback it was handed, as the transport holds it. */
const viewsOpened = vi.hoisted(
  () =>
    [] as {
      readonly docId: string;
      readonly version: number;
      readonly onVersionMoved: (next: { readonly version: number; readonly byteLength: number }) => void;
    }[],
);

vi.mock('./documentView.js', () => ({
  openDocumentView: (options: {
    docId: DocId;
    version: number;
    onVersionMoved: (next: { readonly version: number; readonly byteLength: number }) => void;
  }) => {
    viewsOpened.push({ docId: options.docId, version: options.version, onVersionMoved: options.onVersionMoved });
    return Promise.resolve({
      document: { numPages: PAGES[options.docId] ?? 1 },
      close: () => Promise.resolve(),
    });
  },
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  // THE REAL MODULE UNDER THE STUB, so `RenderCancelledError` is the class callers test against.
  ...(await importOriginal<typeof import('./renderPage.js')>()),
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
    // THE OPEN COMMAND IS THE SEVERAL-FILES CHANNEL (ADR-0182): one file per ask here, an empty list for a dismissal.
    if (id === 'document.openSeveral') {
      const next = opens.shift();
      return Promise.resolve(
        ok({ opened: next === undefined ? [] : [{ name: next.kind === 'opened' ? next.name : 'annual.pdf', outcome: next }] }),
      );
    }
    if (id === 'document.close') return Promise.resolve(ok({ closed: true }));
    // CLEAN: these cases are about tabs, and closing one here must not stop to ask.
    if (id === 'document.unsaved') return Promise.resolve(ok({ unsaved: false }));
    // NO REDACTION MARKS, so a close does not stop to ask about them either (item N1).
    if (id === 'document.annotations') {
      return Promise.resolve(ok({ version: asDocVersion(1), annotations: [], next: null, truncated: false }));
    }
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
    // The scroller asks every visible page for its selectable text; these cases
    // are about tabs, so the answer is empty rather than seeded.
    if (id === 'document.pageTextLayer') {
      return Promise.resolve(
        ok({ version: asDocVersion(1), lines: [], truncated: false, kind: 'empty' as const }),
      );
    }
    if (id === 'ai.models') {
      return Promise.resolve(
        ok({ source: 'fetched' as const, models: [{ id: 'm-1', label: 'Model one', capabilities: { vision: null, streaming: null } }] }),
      );
    }
    if (id === 'ai.ask') return Promise.resolve(ok({ started: true, sent: null }));
    if (id === 'settings.save') return Promise.resolve(ok({ stored: true as const }));
    // AN ANTHROPIC KEY IS STORED, because Send is disabled without one (the no-key audit) — the
    // assistant's cases here are about what an ask carries, which only a person with a key sends.
    if (id === 'settings.loadSecrets') {
      return Promise.resolve(ok({ stored: ['ai.anthropic-key' as const], available: true }));
    }
    if (id === 'log.reveal') return Promise.resolve(ok({ revealed: false }));
    // The shell announces its close subscription on every mount (`windowClose.ts`).
    if (id === 'window.closeListening') return Promise.resolve(ok({ acknowledged: true }));
    // EVERY OPEN ASKS whether the file can be saved over (cloud-4 7b).
    if (id === 'document.fileAccess') return Promise.resolve(ok({ access: 'writable' as const }));
    // AND NO OLD `.bak` FILES TO MOVE (ADR-0198).
    if (id === 'document.adoptOldBackups') return Promise.resolve(ok({ kind: 'adopted' as const, moved: 0 }));
    // E3's prompt asks once per mount; not due, so no banner sits over the tabs these cases drive.
    if (id === 'app.reviewPrompt') return Promise.resolve(ok({ due: false }));
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

/** The pages a slot was asked to reveal, in order — on the prototype, so a remount cannot lose it. */
let scrolled: number[] = [];

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

  // `scrollIntoView` is not implemented by happy-dom and the scroller calls it on every restored
  // page. RECORDED, not a no-op: the store's page is what the seeded `startAt` produces whether or
  // not the view moved, so the page a slot was ASKED to reveal is the only observable that
  // separates a restored place from a lost one (removing the reveal left every case here green).
  scrolled = [];
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    get(this: unknown): () => void {
      const slot = this instanceof HTMLElement && this.classList.contains('m-page-slot') ? this : null;
      const page = slot === null ? -1 : Number(slot.dataset['page'] ?? -1);
      return (): void => {
        if (slot !== null) scrolled.push(page);
      };
    },
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
    screen.getByRole('button', { name: 'Open PDF…' }).click();
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

describe('the Organize grid, driven through App (ADR-0104)', () => {
  /** This file's parse and answers, plus `document.execute`, recording what each command sent. */
  function organizing(): { readonly client: ContractClient; readonly executed: unknown[] } {
    const executed: unknown[] = [];
    let version = 1;
    const answers = client();
    const built = createClient(channels, (id, params) => {
      if (id === 'document.execute') {
        executed.push((params as { command: unknown }).command);
        version += 1;
        return Promise.resolve(ok({ version: asDocVersion(version), byteLength: 2048, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] }));
      }
      if (id === 'document.viewModel') {
        return Promise.resolve(ok({ version: asDocVersion(version), pageCount: PAGES[FIRST] ?? 1, rotations: [] }));
      }
      return (answers.client as unknown as Record<string, (p: unknown) => Promise<unknown>>)[id]?.(params) ?? Promise.reject(new Error(id));
    });
    return { client: built, executed };
  }

  function organizeSettings(): SettingsStore {
    const settings = freshSettings();
    settings.set(RIBBON_SECTION_SETTING.id, 'organize');
    return settings;
  }

  const card = (container: HTMLElement, page: number): HTMLElement => {
    const found = container.querySelector<HTMLElement>(`.m-page-grid [data-thumb-page="${String(page)}"]`);
    if (found === null) throw new Error(`no grid card for page ${String(page)}`);
    return found;
  };

  it('ORGANIZE shows the pages as a grid in place of the reading view, and Home shows the reading view', async () => {
    const { client: built } = organizing();
    const settings = organizeSettings();
    const { container } = render(<App client={built} settings={settings} />);
    await openOne();

    expect(container.querySelector('.m-page-grid')).not.toBeNull();
    expect(container.querySelector('.m-page-list')).toBeNull();
    // CONTROL: the same document under Home is the reading view — the section is what decides.
    await act(async () => {
      settings.set(RIBBON_SECTION_SETTING.id, 'home');
      await Promise.resolve();
    });
    expect(container.querySelector('.m-page-grid')).toBeNull();
    expect(container.querySelector('.m-page-list')).not.toBeNull();
  });

  it('a TICKED page is what Rotate acts on, and Delete removes it — the ribbon and the key both read the grid', async () => {
    const { client: built, executed } = organizing();
    const { container } = render(<App client={built} settings={organizeSettings()} />);
    await openOne();

    // PAGE 2 TICKED while page 1 is the one on show: a rotate that read `page` would send [0].
    await act(async () => {
      fireEvent.click(card(container, 1));
      await Promise.resolve();
    });
    expect(card(container, 1).getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      const rotate = [...container.querySelectorAll<HTMLButtonElement>('.m-ribbon button')].find(
        (button) => button.textContent === 'Rotate 90°',
      );
      if (rotate === undefined) throw new Error('no Rotate 90° in the Organize ribbon');
      rotate.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(executed.at(-1)).toMatchObject({ kind: 'rotatePages', pages: [1] });

    // THE VERSION MOVED, so the selection went with it; Delete then removes the FOCUSED card's page — card 2, while
    // page 1 is still the one on show, so a Delete that read the current page would send [0]. (The audit of
    // 1e1bfad..e24eca0e: this pressed card 1, which is also the page on show, and could not tell the two apart.)
    await act(async () => {
      fireEvent.keyDown(card(container, 1), { key: 'Delete' });
      await Promise.resolve();
    });
    // IT ASKS FIRST (the owner, 2026-10-05, CR-COR-06): the Delete pages dialog, holding the page the key named, and
    // nothing is sent until the person confirms it.
    const dialog = await screen.findByRole('dialog', { name: 'Delete pages' });
    expect(executed.at(-1)).toMatchObject({ kind: 'rotatePages' });
    expect(within(dialog).getByRole('textbox')).toHaveProperty('value', '2');
    await act(async () => {
      within(dialog).getByRole('button', { name: 'Delete pages' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(executed.at(-1)).toStrictEqual({ kind: 'deletePages', pages: [1] });
  });

  it('CANCEL on the Delete key’s question sends nothing, so every page stays (CR-COR-06)', async () => {
    const { client: built, executed } = organizing();
    const { container } = render(<App client={built} settings={organizeSettings()} />);
    await openOne();
    const before = executed.length;

    await act(async () => {
      fireEvent.keyDown(card(container, 1), { key: 'Delete' });
      await Promise.resolve();
    });
    const dialog = await screen.findByRole('dialog', { name: 'Delete pages' });
    await act(async () => {
      within(dialog).getByRole('button', { name: 'Cancel' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // THE CALL THAT WAS NOT MADE, not the page count, which a stubbed kernel would report unchanged either way.
    expect(executed.slice(before).filter((command) => (command as { readonly kind?: unknown }).kind === 'deletePages')).toStrictEqual(
      [],
    );
    expect(screen.queryByRole('dialog', { name: 'Delete pages' })).toBeNull();
    expect(container.querySelectorAll('.m-page-grid [data-thumb-page]')).toHaveLength(2);
  });

  it('ENTER on a card opens that page in the reading view, which is Home', async () => {
    const { client: built } = organizing();
    const settings = organizeSettings();
    const { container } = render(<App client={built} settings={settings} />);
    await openOne();

    await act(async () => {
      fireEvent.keyDown(card(container, 1), { key: 'Enter' });
      await Promise.resolve();
    });
    expect(settings.get(RIBBON_SECTION_SETTING.id)).toBe('home');
    expect(container.querySelector('.m-page-grid')).toBeNull();
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');
  });
});

describe('multi-document tabs', () => {
  it('the document ON SHOW takes the version its transport reports moved, as one behind does (CR-DOC-03)', async () => {
    const { client: built } = client();
    render(<App client={built} settings={freshSettings()} />);
    await openOne();
    const shown = viewsOpened.filter((view) => view.docId === FIRST);
    const bound = shown.at(-1);
    if (bound === undefined) throw new Error('the document on show opened no view');
    expect(bound.version).toBe(1);

    // WHAT THE TRANSPORT DOES on a range answered stale: tells the layer the version main named.
    await act(async () => {
      bound.onVersionMoved({ version: 7, byteLength: 1024 });
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    });

    // THE VIEW IS OPENED AGAIN AT IT. A layer on show that dropped the move kept its view bound to 1, where main
    // answers every range stale, so the page never drew.
    expect(viewsOpened.filter((view) => view.docId === FIRST).slice(shown.length).map((view) => view.version)).toStrictEqual([7]);
  });

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
    const firstScroller = container.querySelector('[data-document-layer="active"] .m-page-list');
    expect(firstScroller).not.toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // THE SECOND DOCUMENT IS ON ITS OWN FIRST PAGE, and its count is its own.
    // Without the differing counts this assertion could not tell a
    // per-document page count from the first document's.
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 1 of 4');

    scrolled.length = 0;
    await press(container, `[data-tab-select="${FIRST}"]`);

    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');
    // AND THE VIEW WAS KEPT THERE (ADR-0129), which the line above cannot say: the first document's
    // scroller is the same node it was before the switch, so its offset was never lost and there is
    // nothing to reveal. A switch that remounted it would be a new node, revealing page 2 again.
    expect(container.querySelector('[data-document-layer="active"] .m-page-list')).toBe(firstScroller);
    expect(scrolled).toStrictEqual([]);
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

  it('asks main whether the rating prompt is due ONCE per window, across a document opening and closing', async () => {
    // A `due: true` answer is RECORDED by main as a prompt shown (E3), so asking is a write and its count
    // matters. `App.test.tsx` filters the ask out of its dispatch counts; this is where the count is the
    // subject. A prompt mounted inside the start screen's branch would ask again when the last tab closed.
    const { client: built, sent } = client();
    const { container } = render(<App client={built} settings={freshSettings()} />);

    await openOne();
    await press(container, `[data-tab-close="${FIRST}"]`);
    // BACK ON THE START SCREEN, which is the state a misplaced prompt would remount in.
    expect(container.querySelectorAll('.m-tab')).toHaveLength(0);
    await openOne();

    expect(sent.filter((call) => call.id === 'app.reviewPrompt')).toHaveLength(1);
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

describe('Side by Side through App (ADR-0131), and the two-document ask it took the route of (ADR-0089)', () => {
  /** Two documents open, the second in front, and the first tab's menu opened. */
  async function twoOpenWithMenuOnFirst(): Promise<{ readonly container: HTMLElement; readonly settings: ReturnType<typeof freshSettings> }> {
    const { client: built } = client();
    const settings = freshSettings();
    const { container } = render(<App client={built} settings={settings} />);
    await openOne();
    await act(async () => {
      screen.getByRole('button', { name: 'Open another document' }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const otherTab = container.querySelector(`[data-tab-select="${FIRST}"]`);
    if (otherTab === null) throw new Error('no tab for the first document');
    await act(async () => {
      fireEvent.contextMenu(otherTab, { clientX: 10, clientY: 10 });
      await Promise.resolve();
    });
    return { container, settings };
  }

  it('the tab menu opens Side by Side with the document on show on the LEFT and the right-clicked one on the right', async () => {
    const { container, settings } = await twoOpenWithMenuOnFirst();
    await act(async () => {
      (await screen.findByRole('menuitem', { name: 'Open side by side' })).click();
      await Promise.resolve();
    });
    const surface = container.querySelector('section[data-side-by-side]');
    if (!(surface instanceof HTMLElement)) throw new Error('Side by Side did not open');
    // THE TAB MENU'S CONTEXT names the right-clicked tab, so a root that read the side from it would put FIRST on both.
    expect(container.querySelector<HTMLSelectElement>('[data-side-pick="left"]')?.value).toBe(SECOND);
    expect(container.querySelector<HTMLSelectElement>('[data-side-pick="right"]')?.value).toBe(FIRST);
    // WHAT IT COVERS IS HIDDEN, never unmounted: the ribbon is still there for the window to return to.
    expect(container.querySelector('main')?.dataset['coveredBy']).toBe('side-by-side');
    expect(container.querySelector('.m-body-area')).not.toBeNull();
    // AND SPLIT VIEW IS NOT HOW IT OPENS ANY MORE: one document per split since the owner's design.
    expect(settings.get(SPLIT_VIEW_SETTING.id)).toBe(false);

    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(container.querySelector('[data-side-by-side]')).toBeNull();
    expect(container.querySelector('main')?.dataset['coveredBy']).toBeUndefined();
  });

  it('CONTROL: with two documents open, App routes no document beside, so the assistant offers no Left · Right · Both — the ask has no route (ADR-0131)', async () => {
    // TWO DOCUMENTS OPEN is the state in which a routed `beside` offers *Both*: App passing either tab beside the one
    // in front turns this red. Side by Side covers the panel while it is open, so no state of App offers the choice.
    const { container, settings } = await twoOpenWithMenuOnFirst();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(async () => {
      settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
      settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
      await Promise.resolve();
    });
    expect(container.querySelectorAll('.m-tab')).toHaveLength(2);
    expect(container.querySelector('[data-side-by-side]')).toBeNull();
    expect(screen.getByLabelText('Ask about this document')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Both' })).toBeNull();
  });

  it('CONTROL: split view of ONE document offers no choice — the second pane is the same document', async () => {
    const { client: built } = client();
    const settings = freshSettings();
    render(<App client={built} settings={settings} />);
    await openOne();
    await act(async () => {
      settings.set(SPLIT_VIEW_SETTING.id, true);
      settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
      settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Ask about this document')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Both' })).toBeNull();
  });
});
