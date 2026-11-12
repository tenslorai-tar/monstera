// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, clientOver } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, cleanup, fireEvent, render as renderBare, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { applyFullAppLimits } from './fullAppTestLimit.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN, VIEW_LOCKED_TITLE, VIEW_PROBLEM_TITLE } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';

// THIS FILE RENDERS THE WHOLE APP: the case limit and the wait window of `fullAppTestLimit.ts`.
applyFullAppLimits();

/**
 * A protected document whose password prompt was cancelled (the owner's decision, 2026-11-10).
 *
 * Its own file because it replaces `documentView.js` for the module graph, the way `AppViewLifetime.test.tsx` does:
 * the stub parser refuses without a password and opens with one, which is the one question these cases ask.
 *
 * What is asserted is what the person sees and the calls the two buttons make: *Enter password* asks again and the
 * document opens on the answer, and *Close* sends the close. The control is the old sentence, which must not show.
 */
activateCatalogue('en', EN);

const DOC = asDocId('doc-protected');

class StubPasswordError extends Error {
  constructor() {
    super('this stub parser will not proceed without a password');
  }
}

vi.mock('./documentView.js', () => ({
  openDocumentView: (options: { readonly password?: string }) =>
    options.password === undefined
      ? Promise.reject(new StubPasswordError())
      : Promise.resolve({ document: { numPages: 1 }, version: asDocVersion(1), close: () => Promise.resolve() }),
  needsPasswordToParse: (cause: unknown) => cause instanceof StubPasswordError,
  createParserWorker: () => ({ destroy: () => undefined }),
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: () => Promise.resolve({ width: 1, height: 1, crop: [0, 0, 1, 1] as const, rotation: 0 }),
}));

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** Every channel the app called, in order. */
const calls: string[] = [];

function answeringClient(): ContractClient {
  const opened = { kind: 'opened' as const, docId: DOC, version: asDocVersion(1), byteLength: 1024, name: 'secret.pdf' };
  const answers: Readonly<Record<string, unknown>> = {
    'document.open': opened,
    'document.openSeveral': { opened: [{ name: 'secret.pdf', outcome: opened }] },
    'document.viewModel': { version: asDocVersion(1), pageCount: 1, rotations: [0], direction: 'L2R' },
    'document.readRange': { kind: 'bytes' as const, bytes: new Uint8Array(8) },
    'document.pageTextLayer': { version: asDocVersion(1), lines: [], truncated: false, kind: 'empty' as const },
    'document.unlock': { kind: 'unlocked', access: 2 },
    'document.annotations': { version: asDocVersion(1), annotations: [], next: null, truncated: false },
    'document.close': { closed: true },
    'document.unsaved': { unsaved: false },
    'window.closeListening': { acknowledged: true },
    'app.rendererEnded': { kind: 'none' },
    'document.held': { documents: [] },
    'document.fileAccess': { access: 'writable' },
    'document.certification': { certification: null, signed: false },
    'document.adoptOldBackups': { kind: 'adopted', moved: 0 },
  };
  return clientOver((id) => {
    calls.push(id);
    const answer = answers[id];
    if (answer === undefined) return Promise.reject(new Error(`this fixture has no answer for ${id}`));
    return Promise.resolve(ok(answer));
  });
}

async function openAndCancel(): Promise<void> {
  renderBare(<App client={answeringClient()} settings={new SettingsStore(new SettingsRegistry(ALL_SETTINGS))} />, {
    wrapper: Messages,
  });
  await act(async () => {
    screen.getByRole('button', { name: 'Open PDF…' }).click();
    await Promise.resolve();
  });
  const prompt = await screen.findByRole('dialog', { name: 'This document is protected' });
  await act(async () => {
    fireEvent.click(within(prompt, 'Cancel'));
    await Promise.resolve();
  });
}

/** The button named `name` inside `container`. */
function within(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('button')].find((button) => button.textContent === name);
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  cleanup();
});

describe('a protected document whose password prompt was cancelled', () => {
  it('shows the owner’s sentence with Enter password and Close, and no error', async () => {
    await openAndCancel();
    await waitFor(() => {
      expect(document.querySelector('[data-document-locked]')?.textContent).toContain(EN[VIEW_LOCKED_TITLE]);
    });
    const buttons = [...document.querySelectorAll('[data-document-locked] button')].map((button) => button.textContent);
    expect(buttons).toStrictEqual(['Enter password', 'Close']);
    // CONTROL: the sentence a failed parse shows is not on screen.
    expect(document.body.textContent).not.toContain(EN[VIEW_PROBLEM_TITLE]);
    // NOTHING WAS UNLOCKED, since nothing was typed.
    expect(calls).not.toContain('document.unlock');
  });

  it('Enter password asks again, and the document opens on the password given', async () => {
    await openAndCancel();
    const surface = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-document-locked]');
      if (found === null) throw new Error('not locked yet');
      return found;
    });
    await act(async () => {
      fireEvent.click(within(surface, 'Enter password'));
      await Promise.resolve();
    });
    const prompt = await screen.findByRole('dialog', { name: 'This document is protected' });
    const field = prompt.querySelector<HTMLInputElement>('input[type="password"]');
    if (field === null) throw new Error('no password field');
    await act(async () => {
      fireEvent.change(field, { target: { value: 'reader-secret' } });
      fireEvent.click(within(prompt, 'Open document'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-document-locked]')).toBeNull();
    });
    expect(calls).toContain('document.unlock');
  });

  it('Close closes the tab through the close path', async () => {
    await openAndCancel();
    const surface = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-document-locked]');
      if (found === null) throw new Error('not locked yet');
      return found;
    });
    await act(async () => {
      fireEvent.click(within(surface, 'Close'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls).toContain('document.close');
    });
    await waitFor(() => {
      expect(document.querySelector('[data-document-locked]')).toBeNull();
    });
  });
});
