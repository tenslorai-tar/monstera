// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, cleanup, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { DocumentView } from './documentView.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';

/**
 * Who closes a document view when the effect that opened it is already gone.
 *
 * ## Why this file exists separately
 *
 * It replaces `documentView.js` for the whole module graph, which every other
 * case in `App.test.tsx` would have to opt out of. `vi.mock` is hoisted above
 * the imports, so the choice is per file rather than per case.
 *
 * ## Why the real module cannot answer this
 *
 * `openDocumentView` is correct: it closes itself on a version bump and on a
 * failed open. The hazard is one layer up, in the effect that awaits it — a
 * cleanup that ran while the open was in flight read `view` while it was still
 * `undefined` and closed nothing, and the original code then returned without
 * closing the view that had just arrived. A parser, a worker and a transport
 * per occurrence, invisible until the machine is out of them.
 *
 * Nothing observable through the contract client separates that from a healthy
 * unmount: the transport is never driven under happy-dom, because PDF.js starts
 * no worker here. So the seam is stubbed and the question asked directly.
 */
activateCatalogue('en', EN);

const DOC = asDocId('doc-lifetime');

/** Resolvers for the pending `openDocumentView` calls, in order. */
const pending: ((view: DocumentView) => void)[] = [];
/** How many times a view handed out here has been closed. */
const closes: string[] = [];

vi.mock('./documentView.js', () => ({
  openDocumentView: () => new Promise((resolve) => pending.push(resolve)),
}));

/** Every rotation `renderPage` was handed, in order. `undefined` is a value here. */
const drawn: (number | undefined)[] = [];

// MOCKED FOR THE SAME REASON THE VIEW IS: what a renderer HANDS the rasteriser
// is a decision, and the state it produces is unobservable here — happy-dom
// implements no canvas, so the real `renderPage` refuses before it draws and
// every rotation produces the same nothing.
//
// FILTERED TO THE SPINE, as of 2026-09-02, and the filter is not cosmetic. The
// thumbnail sidebar is a second caller of the same rasteriser, so an unfiltered
// recorder answers "what did this application draw" when every assertion here
// asks "what did the PAGE draw" — and it started reporting two extra entries the
// moment the sidebar landed. The canvas's own class is the discriminator,
// because it is the surface rather than a number that could coincide.
vi.mock('./renderPage.js', () => ({
  renderPage: (
    _document: unknown,
    _page: number,
    canvas: unknown,
    _scale: number,
    rotation?: number,
  ) => {
    const spine =
      canvas instanceof HTMLElement && canvas.classList.contains('m-page');
    if (spine) drawn.push(rotation);
    return Promise.resolve({ width: 1, height: 1 });
  },
}));

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

function freshSettings(): SettingsStore {
  // The shipped list; see `App.test.tsx` for why a subset is not equivalent.
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

function answeringClient(model?: Readonly<Record<string, unknown>>): ContractClient {
  const answers: Readonly<Record<string, unknown>> = {
    'document.open': {
      kind: 'opened' as const,
      docId: DOC,
      version: asDocVersion(1),
      byteLength: 1024,
      name: 'annual.pdf',
    },
    'document.viewModel': model ?? {
      version: asDocVersion(1),
      pageCount: 1,
      rotations: [90],
    },
    'document.readRange': { kind: 'bytes' as const, bytes: new Uint8Array(8) },
  };
  return createClient(channels, (id) => {
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
    return Promise.resolve(ok(answer));
  });
}

/** A view that records its own closing, so a leak is a count rather than a hunch. */
function viewNamed(name: string): DocumentView {
  return {
    // ONE PAGE, because the scroller lays out `numPages` slots and an empty
    // document object gives it `undefined` — which renders no slots, draws
    // nothing, and would make every rotation case here pass for a renderer that
    // had stopped drawing entirely.
    document: { numPages: 1 } as DocumentView['document'],
    version: asDocVersion(1),
    close: () => {
      closes.push(name);
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  pending.length = 0;
  closes.length = 0;
  drawn.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('a document view that arrives after its effect was cleaned up', () => {
  it('is CLOSED, rather than left running with nothing holding it', async () => {
    const { unmount } = render(<App client={answeringClient()} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });
    // Settles the view-model read, which is the first suspension point. The open
    // is the second, and it is deliberately left pending.
    await act(async () => {
      await Promise.resolve();
    });
    expect(pending).toHaveLength(1);

    // The cleanup runs here, with `view` still undefined — so the cleanup's own
    // `view?.close()` closes nothing, and whatever arrives next has no owner.
    unmount();

    await act(async () => {
      pending[0]?.(viewNamed('late'));
      await Promise.resolve();
    });

    expect(closes).toStrictEqual(['late']);
  });

  it('CONTROL: a view that arrives while the effect is LIVE is not closed', async () => {
    // Without this, the case above passes for an effect that closes every view
    // it opens — which renders nothing at all, and would leave the canvas blank
    // for every document while looking like careful resource handling.
    render(<App client={answeringClient()} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pending[0]?.(viewNamed('live'));
      await Promise.resolve();
    });

    expect(closes).toStrictEqual([]);
  });
});

describe('a view model that describes a different version than the view is opened at', () => {
  /** Opens a document, settles the model read, and delivers the view. */
  async function drawWith(model?: Readonly<Record<string, unknown>>): Promise<void> {
    render(<App client={answeringClient(model)} settings={freshSettings()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      pending[0]?.(viewNamed('view'));
      await Promise.resolve();
    });
  }

  it('is not drawn, because the bytes underneath it belong to the other one', async () => {
    // RRRRR-2. The model is read, then the transport is opened; a command
    // landing between those two awaits leaves a rotation describing version 9
    // about to be painted over bytes bound to version 1. ADR-0031 refuses a
    // RANGE for the wrong version for the same reason — a document assembled
    // from two of them — and this is the same hazard arriving through geometry,
    // where nothing throws because nothing was comparing anything.
    //
    // `undefined` and not `0`: PDF.js then falls back to the page's own
    // `/Rotate`, which is what this renderer actually knows.
    await drawWith({ version: asDocVersion(9), pageCount: 1, rotations: [90] });

    expect(drawn).toStrictEqual([undefined]);
  });

  it('CONTROL: the SAME version is drawn, so this is a comparison and not a refusal', async () => {
    // Without this, the case above passes for a renderer that never applies a
    // rotation at all — which is the state the whole view model exists to leave,
    // and which no other case in this file would notice.
    await drawWith();

    expect(drawn).toStrictEqual([90]);
  });
});
