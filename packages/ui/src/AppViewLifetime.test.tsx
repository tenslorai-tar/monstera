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
import { THEME_SETTING } from './settings/appearance.js';
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

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

function freshSettings(): SettingsStore {
  return new SettingsStore(new SettingsRegistry([THEME_SETTING]));
}

function answeringClient(): ContractClient {
  const answers: Readonly<Record<string, unknown>> = {
    'document.open': {
      kind: 'opened' as const,
      docId: DOC,
      version: asDocVersion(1),
      byteLength: 1024,
    },
    'document.viewModel': { version: asDocVersion(1), pageCount: 1, rotations: [0] },
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
    document: {} as DocumentView['document'],
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
