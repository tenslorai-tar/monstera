// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok, tokensOf } from '@monstera/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createDocumentStore } from './documentStores.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';
import { SpellingPanel } from './SpellingPanel.js';
import type { SpellingDeps } from './spelling/reviewRun.js';

/**
 * The Spelling tab dispatches exactly what `reviewRun.test.ts` proves the review sends, and shows what it holds: the
 * UI half of the wired pair. The document is one page of two lines; its edits are recorded, not applied, so a case
 * about what the panel sends is not also about what a document does with it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000005e2');
const WORDS = '5\nthe\npage\ndocument\ncat\nsee\n';

function Wrapped({ children }: { readonly children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function drawn(lines: readonly string[]): { readonly sent: unknown[]; readonly settings: SettingsStore } {
  const sent: unknown[] = [];
  const box = (line: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 0, y0: line * 20, x1: 500, y1: line * 20 + 12 });
  const client = createClient(channels, (id, raw) => {
    const params = raw as Record<string, unknown>;
    switch (id) {
      case 'spelling.dictionary':
        return Promise.resolve(
          ok({ kind: 'dictionary', language: 'en', affix: new TextEncoder().encode('SET UTF-8\n'), words: new TextEncoder().encode(WORDS) }),
        );
      case 'document.pageTextLayer':
        return Promise.resolve(
          ok({ version: asDocVersion(1), lines: lines.map((text, line) => ({ text, box: box(line) })), truncated: false, kind: 'text' }),
        );
      case 'document.pageWordBoxes':
        return Promise.resolve(
          ok({
            version: asDocVersion(1),
            lines: lines.map((text, line) => ({
              text,
              box: box(line),
              boxes: [...tokensOf(text)].flatMap((token) => [token.index * 5, line * 20, (token.index + token.text.length) * 5, line * 20 + 12]),
            })),
            truncated: false,
          }),
        );
      case 'document.viewModel':
        return Promise.resolve(ok({ version: asDocVersion(1), pageCount: 1, rotations: [0] }));
      case 'document.annotations':
        return Promise.resolve(ok({ version: asDocVersion(1), annotations: [], next: null, truncated: false }));
      case 'document.formFields':
        return Promise.resolve(ok({ version: asDocVersion(1), fields: [], next: null, truncated: false }));
      case 'document.execute':
        sent.push(params['command']);
        return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 1, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] }));
      default:
        throw new Error(`unexpected channel ${id}`);
    }
  });
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const store = createDocumentStore(DOC, asDocVersion(1));
  store.getState().counted(1);
  const deps: SpellingDeps = {
    client,
    settings,
    commands: {
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
      stamp: () => ({ author: 'A. Tester', created: '2026-10-04T12:00:00.000Z' }),
      signatures: { warn: () => true, onOpened: () => undefined },
    },
    cropOf: () => [0, 0, 500, 700],
  };
  render(
    <Wrapped>
      <SpellingPanel deps={deps} store={store} settings={settings} />
    </Wrapped>,
  );
  return { sent, settings };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  });
}

async function press(name: string): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name }).click();
    await Promise.resolve();
  });
  await settle();
}

/**
 * Starts the review and waits for it to have READ — the reading line gone — rather than for a number of turns: the
 * first review of a run imports the checker's library, which resolves after any count of microtasks.
 */
async function check(): Promise<void> {
  await press('Check spelling');
  await waitFor(() => {
    expect(screen.queryByText(/^Checking page/u)).toBeNull();
    expect(document.querySelector('.m-spelling [role="status"], .m-spelling__word')).not.toBeNull();
  });
}

describe('SpellingPanel', () => {
  it('starts on Check spelling, then shows the word, where it is, and the line around it', async () => {
    drawn(['see the documnet here', 'teh cat']);
    expect(screen.getByText(/Goes through the document a word at a time/u)).toBeTruthy();
    await check();
    expect(document.querySelector('.m-spelling__word')?.textContent).toBe('documnet');
    expect(screen.getByText('Page 1')).toBeTruthy();
    // THE WORD MARKED IN ITS LINE, the line's own words either side.
    expect(document.querySelector('.m-spelling__context')?.textContent).toBe('see the documnet here');
    expect(document.querySelector('.m-spelling__context mark')?.textContent).toBe('documnet');
    // THE FIELD STARTS ON THE FIRST SUGGESTION, which is what Replace will write unless a person chooses otherwise.
    expect(screen.getByLabelText('Change to')).toHaveProperty('value', 'document');
  });

  it('REPLACE DISPATCHES replaceTextAt for the word shown, with the word chosen, and moves on', async () => {
    const { sent } = drawn(['the documnet', 'teh cat']);
    await check();
    await press('Replace');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'replaceTextAt', page: 0, find: 'documnet', replace: 'document' });
    expect(document.querySelector('.m-spelling__word')?.textContent).toBe('teh');
  });

  it('a TYPED word is what Replace writes, not the suggestion', async () => {
    const { sent } = drawn(['the documnet']);
    await check();
    fireEvent.change(screen.getByLabelText('Change to'), { target: { value: 'paper' } });
    await press('Replace');
    expect(sent[0]).toMatchObject({ kind: 'replaceTextAt', find: 'documnet', replace: 'paper' });
  });

  it('REPLACE ALL dispatches replaceAllText, exactly as written and whole', async () => {
    const { sent } = drawn(['teh cat', 'teh']);
    await check();
    fireEvent.change(screen.getByLabelText('Change to'), { target: { value: 'the' } });
    await press('Replace all');
    expect(sent[0]).toStrictEqual({ kind: 'replaceAllText', find: 'teh', replace: 'the', caseSensitive: true, wholeWord: true });
  });

  it('Ignore sends nothing and moves on; with nothing left it says the spelling was checked', async () => {
    const { sent } = drawn(['documnet teh']);
    await check();
    await press('Ignore');
    expect(document.querySelector('.m-spelling__word')?.textContent).toBe('teh');
    await press('Ignore all');
    expect(screen.getByText('Spelling checked. No words were changed.')).toBeTruthy();
    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a document with no misspelt word says so, rather than showing an empty review', async () => {
    drawn(['the cat']);
    await check();
    expect(screen.getByText('No misspellings found.')).toBeTruthy();
  });

  it('the head says which word of how many, the page, and the language; the finished state says there are no more (the owner, 2026-10-08)', async () => {
    drawn(['documnet teh']);
    await check();
    expect(document.querySelector('.m-spelling__progress')?.textContent).toBe('Word 1 of 2');
    expect(document.querySelector('.m-spelling__tongue')?.textContent).toBe('English');
    await press('Ignore');
    expect(document.querySelector('.m-spelling__progress')?.textContent).toBe('Word 2 of 2');
    await press('Ignore');
    expect(document.querySelector('.m-spelling__state-title')?.textContent).toBe('No more misspellings');
    // CONTROL: the clean document's title is its own, not the reviewed one's.
  });

  it('CONTROL: a clean document’s title is No misspellings, and the head is not drawn', async () => {
    drawn(['the cat']);
    await check();
    expect(document.querySelector('.m-spelling__state-title')?.textContent).toBe('No misspellings');
    expect(document.querySelector('.m-spelling__head')).toBeNull();
  });

  it('the actions are an even grid and the suggestions a full-width list', async () => {
    drawn(['the documnet']);
    await check();
    const labels = [...document.querySelectorAll('.m-spelling__actions > *')].map((each) => each.textContent);
    expect(labels).toStrictEqual(['Replace', 'Replace all', 'Ignore', 'Ignore all', 'Add to dictionary']);
    expect(document.querySelectorAll('.m-spelling__suggestions button').length).toBeGreaterThan(0);
  });

  it('turns Replace off for a word that would become itself', async () => {
    drawn(['the documnet']);
    await check();
    fireEvent.change(screen.getByLabelText('Change to'), { target: { value: 'documnet' } });
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveProperty('disabled', true);
  });
});
