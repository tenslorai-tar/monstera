// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { STATUS_LABEL, THUMBNAILS_LABEL } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';
import { applyFullAppLimits } from './fullAppTestLimit.js';

// THIS FILE RENDERS THE WHOLE APP: the case limit and the wait window of `fullAppTestLimit.ts`.
applyFullAppLimits();

/**
 * §10.5a's guarantee, asserted rather than repeated.
 *
 * ## The row promised "reload is cheap" and that is worth nothing unstated
 *
 * `docs/FEATURES.md:250` says a renderer that throws loses no work. What a
 * reader actually gets back is the claim that matters, and §10.5a names it:
 * **the same document, the same page, the same zoom**. This file drives that
 * through `App` — a throw inside the document view, the fallback, a retry, and
 * the document still open on the page it was on.
 *
 * ## The separating design, and what a wrong one would do
 *
 * The guarantee comes from PLACEMENT: the boundary is mounted inside `App`,
 * below the state naming those three, so a reset re-renders from state the
 * failure never touched. The obvious alternative is a boundary around `<App/>`
 * in `main.tsx`, which passes every component-level case in
 * `ErrorBoundary.test.tsx` and loses the reader's place — a retry there remounts
 * `App`, and the reader lands back on the start screen with nothing open.
 *
 * So the assertion after the retry is *the document is still open, on page 2*,
 * not *something rendered*. The second is what both designs produce.
 *
 * ## The throw is a REAL failure mode, not a test-only escape hatch
 *
 * `i18n.ts` makes a missing catalogue entry throw — deliberately, its header
 * says, because displaying the key is worse. A key resolved inside the view and
 * absent from the catalogue is therefore an ordinary way this application can
 * throw mid-render, and it needs no seam in the product to inject. The key is
 * `THUMBNAILS_LABEL`, used by `Thumbnails.tsx` alone, which `PageCanvas` renders
 * — so the throw happens INSIDE the boundary. A key the shell resolves would
 * escape it and prove the opposite of what this file claims.
 */

/** A locale nobody ships, so loading into it cannot merge with `en`. */
const INCOMPLETE_LOCALE = 'zz';

/** Everything but the one key, so the view throws where the shell does not. */
const WITHOUT_THUMBNAILS: Record<string, string> = Object.fromEntries(
  Object.entries(EN).filter(([key]) => key !== THUMBNAILS_LABEL),
);

vi.mock('./documentView.js', () => ({
  openDocumentView: () =>
    Promise.resolve({ document: { numPages: 2 }, close: () => Promise.resolve() }),
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  // THE REAL MODULE UNDER THE STUB, so `RenderCancelledError` is the class callers test against.
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: () => Promise.resolve({ width: 595, height: 842 }),
}));

const DOC = asDocId('doc-boundary');

const ANSWERS: Readonly<Record<string, unknown>> = {
  'document.open': {
    kind: 'opened' as const,
    docId: DOC,
    version: asDocVersion(1),
    byteLength: 1024,
    name: 'annual.pdf',
  },
  'document.readRange': { kind: 'bytes' as const, bytes: new Uint8Array(8) },
  'document.viewModel': { version: asDocVersion(1), pageCount: 2, rotations: [90] },
  // The scroller asks every visible page for its selectable text; these cases
  // are about the boundary, so the answer is empty rather than seeded.
  'document.pageTextLayer': {
    version: asDocVersion(1),
    lines: [],
    truncated: false,
    kind: 'empty' as const,
  },
  'document.recent': { entries: [], lastExitClean: true },
  'log.reveal': { revealed: false },
  // The shell announces its close subscription at mount (`windowClose.ts`); a fixture with no
  // answer for it makes every case here carry an unhandled rejection.
  'window.closeListening': { acknowledged: true },
  // AN UNDO MOVES THE VERSION, which remounts the scroller exactly as a retry does — and moves no
  // page, so the reader's page is the same number afterwards (a move would remap it, correctly).
  'document.undo': { kind: 'undone' as const, version: asDocVersion(2), byteLength: 2048 },
};

function client(): ContractClient {
  return createClient(channels, (id) => {
    const answer = ANSWERS[id];
    if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
    return Promise.resolve(ok(answer));
  });
}

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

// React writes every caught error to `console.error`; see `ErrorBoundary.test`.
let logged: MockInstance;

/** Every observer built during a case, with the callback it was given. */
let observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = [];

/**
 * The pages something asked to be scrolled to, in order.
 *
 * ON THE PROTOTYPE rather than on the slots `PageList.test.tsx` patches one by
 * one, and the difference is this file's whole subject: a retry REMOUNTS the
 * scroller, so every element patched before the click is gone by the time the
 * request is issued. A per-element recorder would report an empty list and read
 * as *the retry asked for nothing*, which is the finding this case exists for.
 */
let scrolled: number[] = [];

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  observers = [];
  scrolled = [];

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    // A GETTER, so the page is read at the moment the method is looked up and
    // the returned closure holds a number rather than a receiver — no `this`
    // is aliased into a variable, which is the scoping hazard
    // `PageList.test.tsx` records the lint rules refusing.
    get(this: unknown): () => void {
      const slot =
        this instanceof HTMLElement && this.classList.contains('m-page-slot') ? this : null;
      const page = slot === null ? -1 : Number(slot.dataset['page'] ?? -1);
      return (): void => {
        if (slot !== null) scrolled.push(page);
      };
    },
  });

  // TWO BROWSER APIS HAPPY-DOM EXPOSES AND NEVER FIRES, doubled the way
  // `PageList.test.tsx` doubles them. Without the intersection one the current
  // page can never move, and this file's whole subject is whether the page
  // survives a failure — a case that could not move it would assert page 1,
  // which is exactly what a design that lost the reader's place produces.
  const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
  resize.ResizeObserver = class {
    observe(): void {
      // Deliberately silent: nothing here measures a viewport.
    }
    unobserve(): void {
      // Not called by these components, which disconnect instead.
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
});

afterEach(() => {
  logged.mockRestore();
});

/**
 * Tells the SCROLLER's observer that a page came into view.
 *
 * `App` builds two — the thumbnails and the scroller share `useVisiblePages`,
 * and both stamp `data-page` — so this finds the one holding a `.m-page-slot`.
 * Taking the newest observer instead would pick whichever mounted last, and the
 * case would depend on render order rather than on the surface it is about.
 */
function scrolledTo(page: number): void {
  for (const observer of observers) {
    const slots = observer.observed.filter(
      (element) => element instanceof HTMLElement && element.classList.contains('m-page-slot'),
    );
    if (slots.length === 0) continue;
    // EVERY SLOT, not just the one arriving. The hook seeds the first page as
    // visible, and the scroller reports the TOPMOST of the visible set — so
    // announcing page 2's arrival alone leaves page 1 in the set and the
    // current page never moves. The pages left behind have to be reported as
    // gone, which is what a real scroll does.
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

/** Opens the fixture document and settles the effects. */
async function open(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Open PDF…' }).click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the error boundary around the document view, in App', () => {
  it('SHOWS THE PROBLEM and then returns the reader to the same document and page', async () => {
    // THE READER IS MID-DOCUMENT WHEN IT FAILS, which is the situation the
    // guarantee is about. The page is set FIRST, and it is page 2 rather than
    // page 1 because page 1 is where a design that lost the reader's place
    // lands — a case that opened and never moved could not tell the two apart.
    activateCatalogue('en', EN);
    const { container } = render(<App client={client()} settings={freshSettings()} />);
    await open();

    await act(async () => {
      scrolledTo(1);
      await Promise.resolve();
    });
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');

    // NOW the catalogue loses the key. Activating one notifies `I18nProvider`,
    // every consumer re-renders, and `Thumbnails` throws inside the boundary.
    //
    // A SECOND LOCALE, not `en` again: lingui's `load` MERGES into the
    // catalogue it already holds, so re-loading `en` without the key leaves the
    // key exactly where it was and nothing throws. That is why this file names
    // a locale nobody ships — the mistake is invisible, because a case written
    // the other way simply renders the working view and fails on a later line.
    await act(async () => {
      activateCatalogue(INCOMPLETE_LOCALE, WITHOUT_THUMBNAILS);
      await Promise.resolve();
    });

    // The fallback, not a blank surface. `role="alert"` is asserted through the
    // accessible query rather than the class, because what this owes a reader is
    // an announcement and a class satisfies nothing.
    expect(screen.getByRole('alert').textContent).toContain('could not be displayed');
    expect(container.querySelector('.m-thumbnails')).toBeNull();

    // Repair the catalogue, so the retry has something to render. A retry into
    // an unrepaired view re-throws, and *the fallback is still there* is what
    // both a working reset and a dead one produce.
    await act(async () => {
      activateCatalogue('en', EN);
      await Promise.resolve();
    });

    const retry = container.querySelector('[data-view-retry]');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('the fallback offers a retry');

    // FROM HERE, so what is asserted is what the RETRY asked for. Activating a
    // document also issues a scroll — that is how a tab restores a reader's
    // page — and a list carrying both cannot say which one this case is about.
    scrolled.length = 0;
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    // THE SEPARATING ASSERTION. A boundary above `App` would remount it and
    // land here on the start screen with nothing open; this one is below the
    // state, so the document is still open. The thumbnails are the view itself,
    // back.
    expect(container.querySelector('.m-thumbnails')).not.toBeNull();
    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
    // THE START SCREEN ITSELF. The Open control (then labelled `Open a document`) was the proxy for it and
    // stopped being one on 2026-09-08, when the ribbon gained Home › File: the
    // control is correctly present with a document open, so the old assertion
    // would fail for a build that is right.
    expect(container.querySelector('.m-start-screen')).toBeNull();

    // AND THE PAGE, ASSERTED AS THE CALL RATHER THAN AS THE END STATE. The
    // remounted scroller seeds its first page as visible and reports it, so
    // `currentPage` reads 1 here whatever the retry did — the tidy state that
    // both a correct retry and an absent one arrive at. What separates them is
    // whether the reader's page was REQUESTED, which is a `scrollIntoView` on
    // that slot, and a real browser's observer answers it while happy-dom's
    // does not.
    expect(scrolled).toStrictEqual([1]);
  });

  it('a COMMAND that moves the version returns the reader to their page, as a retry does', async () => {
    // THE THIRD REMOUNT. A new version closes the view and opens the new bytes, so the scroller
    // remounts and seeds page 1 — and until 2026-09-18 nothing re-requested the reader's page, so
    // every edit put them back at the top (seen live after ADR-0084 made every edit a version).
    activateCatalogue('en', EN);
    const { container } = render(<App client={client()} settings={freshSettings()} />);
    await open();
    await act(async () => {
      scrolledTo(1);
      await Promise.resolve();
    });
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 2 of 2');

    // FROM HERE, so the list holds what the version move asked for and nothing before it.
    scrolled.length = 0;
    // A REAL COMMAND through its chord. An undo, not a page move: a move remaps the reader's page
    // with the page they were on — correctly — so it cannot separate a kept place from a lost one.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // THE CALL, not the end state: the remounted scroller reports page 1 whatever happened, and
    // what separates a kept place from a lost one is whether page 2 was REQUESTED.
    expect(scrolled).toStrictEqual([1]);
  });

  it('CONTROL: a view that does not throw renders, and no problem is announced', async () => {
    // Without this the case above passes for an application that shows the
    // fallback always — which is a shell with no viewer in it, and every
    // assertion there would still hold except the two after the retry.
    activateCatalogue('en', EN);
    const { container } = render(<App client={client()} settings={freshSettings()} />);
    await open();

    expect(container.querySelector('.m-thumbnails')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[data-view-retry]')).toBeNull();
  });
});

/**
 * THE WINDOW'S BOUNDARY, for a throw OUTSIDE the view.
 *
 * Until 2026-09-21 the view's boundary was the only one, and a throw anywhere else — a dialog's
 * chunk, measured live — reached the root: React unmounted everything and the window went blank.
 * The key here is `STATUS_LABEL`, which `StatusBar` alone resolves, and the status bar sits
 * beside the view rather than in it, so this throw is out of the view boundary's reach by
 * position. Without the window's boundary the render throws and nothing is left to query.
 */
describe('the error boundary around the whole window, in App', () => {
  const WITHOUT_STATUS: Record<string, string> = Object.fromEntries(
    Object.entries(EN).filter(([key]) => key !== STATUS_LABEL),
  );

  it('SHOWS THE PROBLEM for a throw outside the view, and a retry keeps the document open', async () => {
    activateCatalogue('en', EN);
    const { container } = render(<App client={client()} settings={freshSettings()} />);
    await open();
    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');

    // A LOCALE OF ITS OWN: lingui merges into a catalogue it already holds, and the view's case
    // loaded `INCOMPLETE_LOCALE` WITH this key — reusing it throws nothing when the file runs whole.
    await act(async () => {
      activateCatalogue('zy', WITHOUT_STATUS);
      await Promise.resolve();
    });

    // THE WINDOW'S fallback, not the view's: the view did not fail.
    expect(screen.getByRole('alert').textContent).toContain('Part of this window stopped working.');
    expect(container.querySelector('[data-problem-scope="window"]')).not.toBeNull();

    await act(async () => {
      activateCatalogue('en', EN);
      await Promise.resolve();
    });
    const retry = container.querySelector('[data-view-retry]');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('the fallback offers a retry');
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    // THE SEPARATING ASSERTION, for the reason the view's case gives: a boundary above `App`
    // would come back to the start screen with nothing open.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('.m-status-name')?.textContent).toBe('annual.pdf');
    expect(container.querySelector('.m-start-screen')).toBeNull();
  });
});

/** A store per case — `SettingsStore` is not React state and does not reset. */
function freshSettings(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}
