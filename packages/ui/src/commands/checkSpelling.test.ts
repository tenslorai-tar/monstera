import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SPELL_CHECK_DIALOG_ID } from '../dialogs/spellCheck.js';
import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { PERSONAL_DICTIONARY_SETTING } from '../settings/editing.js';
import { SettingsStore } from '../settingsStore.js';
import { checkSpellingCommand } from './checkSpelling.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000fe');

const AFFIX = 'SET UTF-8\n';
const WORDS = '3\ndocument\npage\nthe\n';

/** A context with a document focused, which is what `when` asks about. */
function contextWith(pageCount: number): CommandContext {
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount,
  } as CommandContext;
}

/** A store built from the shipped registration, not a fixture beside it. */
function store(): SettingsStore {
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

/**
 * A client answering the dictionary once and one page of text per request.
 *
 * The pages are a script rather than one answer, because these cases are about
 * the WALK — that every page is asked and that a version change stops it. A
 * client answering the same page for everything would pass a command that read
 * page 0 and multiplied.
 */
function clientWith(
  pages: readonly (
    | { readonly kind: 'ok'; readonly version: number; readonly lines: readonly string[] }
    | { readonly kind: 'refused' }
  )[],
  dictionary: 'present' | 'absent' = 'present',
): { client: ContractClient; asked: number[] } {
  const asked: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'spelling.dictionary') {
      if (dictionary === 'absent') return Promise.resolve(ok({ kind: 'unknown-dictionary' }));
      return Promise.resolve(
        ok({
          kind: 'dictionary',
          language: 'en',
          affix: new TextEncoder().encode(AFFIX),
          words: new TextEncoder().encode(WORDS),
        }),
      );
    }
    if (id !== 'document.pageTextLayer') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    asked.push(page);
    const step = pages[page];
    if (step === undefined || step.kind === 'refused') {
      return Promise.resolve(err({ code: 'document-busy' }));
    }
    return Promise.resolve(
      ok({
        version: asDocVersion(step.version),
        lines: step.lines.map((text, index) => ({
          text,
          box: { x0: 0, y0: index * 10, x1: 100, y1: index * 10 + 8 },
        })),
        truncated: false,
      }),
    );
  });
  return { client, asked };
}

/** Records what the command opened, and answers the dialog from a script. */
function askAnswering(answer: unknown): {
  ask: (id: string, props: unknown) => Promise<unknown>;
  opened: { id: string; props: unknown }[];
} {
  const opened: { id: string; props: unknown }[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(answer);
    },
    opened,
  };
}

/** The props the dialog was opened with, typed for the assertions below. */
function propsOf(opened: readonly { id: string; props: unknown }[]): {
  available: boolean;
  misspellings: { word: string; occurrences: number; firstPage: number }[];
  pagesChecked: number;
  pageCount: number;
} {
  return opened[0]?.props as never;
}

describe('the spell check command', () => {
  it('asks EVERY page and reports what it found across them', async () => {
    const { client, asked } = clientWith([
      { kind: 'ok', version: 1, lines: ['the documnet'] },
      { kind: 'ok', version: 1, lines: ['the page'] },
      { kind: 'ok', version: 1, lines: ['documnet again'] },
    ]);
    const { ask, opened } = askAnswering(undefined);

    await checkSpellingCommand({ client, settings: store(), ask }).run(contextWith(3));

    expect(asked).toEqual([0, 1, 2]);
    expect(opened[0]?.id).toBe(SPELL_CHECK_DIALOG_ID);
    const props = propsOf(opened);
    expect(props.pagesChecked).toBe(3);
    // ONE ENTRY FOR TWO PAGES, counted across the walk rather than per page.
    expect(props.misspellings.find((entry) => entry.word === 'documnet')?.occurrences).toBe(2);
    expect(props.misspellings.find((entry) => entry.word === 'documnet')?.firstPage).toBe(0);
  });

  it('STOPS when a page answers at a different version', async () => {
    const { client, asked } = clientWith([
      { kind: 'ok', version: 1, lines: ['documnet'] },
      { kind: 'ok', version: 2, lines: ['anothr'] },
      { kind: 'ok', version: 2, lines: ['thrid'] },
    ]);
    const { ask, opened } = askAnswering(undefined);

    await checkSpellingCommand({ client, settings: store(), ask }).run(contextWith(3));

    // ASKED THE SECOND PAGE AND KEPT NOTHING FROM IT. Asserting only
    // `pagesChecked` would pass against a command that stopped one page early
    // for any reason; what separates the version rule is that the word on the
    // page at the new version is absent from the list.
    expect(asked).toEqual([0, 1]);
    const props = propsOf(opened);
    expect(props.pagesChecked).toBe(1);
    expect(props.misspellings.map((entry) => entry.word)).toEqual(['documnet']);
  });

  it('reports the pages it managed, so a short list is visibly short', async () => {
    const { client } = clientWith([
      { kind: 'ok', version: 1, lines: ['documnet'] },
      { kind: 'refused' },
    ]);
    const { ask, opened } = askAnswering(undefined);

    await checkSpellingCommand({ client, settings: store(), ask }).run(contextWith(4));

    const props = propsOf(opened);
    expect(props.pagesChecked).toBe(1);
    expect(props.pageCount).toBe(4);
  });

  it('opens with `available: false` and NEVER reads a page when the dictionary is missing', async () => {
    const { client, asked } = clientWith([{ kind: 'ok', version: 1, lines: ['documnet'] }], 'absent');
    const { ask, opened } = askAnswering(undefined);

    await checkSpellingCommand({ client, settings: store(), ask }).run(contextWith(1));

    // THE STATE, NOT AN EMPTY LIST. A checker that was never built produces
    // zero misspellings, which is byte-for-byte what a correctly spelt document
    // produces — so a case asserting `misspellings: []` would pass either way
    // and prove nothing. `available` is the field only this path sets.
    expect(propsOf(opened).available).toBe(false);
    // AND IT DID NOT WALK. Without this the command could fetch four hundred
    // pages of text to check them against nothing.
    expect(asked).toEqual([]);
  });

  it('writes the words the reader added to the personal dictionary', async () => {
    const { client } = clientWith([{ kind: 'ok', version: 1, lines: ['documnet'] }]);
    const { ask } = askAnswering({ added: ['documnet'] });
    const settings = store();

    await checkSpellingCommand({ client, settings, ask }).run(contextWith(1));

    expect(settings.get(PERSONAL_DICTIONARY_SETTING.id)).toEqual(['documnet']);
  });

  it('leaves the dictionary alone when the reader dismissed', async () => {
    const { client } = clientWith([{ kind: 'ok', version: 1, lines: ['documnet'] }]);
    const { ask } = askAnswering(undefined);
    const settings = store();
    settings.set(PERSONAL_DICTIONARY_SETTING.id, ['Monstera']);

    await checkSpellingCommand({ client, settings, ask }).run(contextWith(1));

    // SEEDED FIRST, so this separates *left alone* from *written empty*. With
    // an empty start the two are the same observation.
    expect(settings.get(PERSONAL_DICTIONARY_SETTING.id)).toEqual(['Monstera']);
  });

  it('MERGES rather than replaces, and adds a word already held only once', async () => {
    const { client } = clientWith([{ kind: 'ok', version: 1, lines: ['documnet'] }]);
    const { ask } = askAnswering({ added: ['documnet', 'Monstera'] });
    const settings = store();
    settings.set(PERSONAL_DICTIONARY_SETTING.id, ['monstera']);

    await checkSpellingCommand({ client, settings, ask }).run(contextWith(1));

    expect(settings.get(PERSONAL_DICTIONARY_SETTING.id)).toEqual(['monstera', 'documnet']);
  });

  it('accepts a word already in the personal dictionary, so it is not reported', async () => {
    const { client } = clientWith([{ kind: 'ok', version: 1, lines: ['documnet'] }]);
    const { ask, opened } = askAnswering(undefined);
    const settings = store();
    settings.set(PERSONAL_DICTIONARY_SETTING.id, ['documnet']);

    await checkSpellingCommand({ client, settings, ask }).run(contextWith(1));

    // THE ROUND TRIP the feature is for: a word added on one run is accepted on
    // the next. Without it the personal dictionary is a list that is written
    // and never read.
    expect(propsOf(opened).misspellings).toEqual([]);
  });

  it('does nothing without a document, and its `when` says so', async () => {
    const { client, asked } = clientWith([]);
    const { ask, opened } = askAnswering(undefined);
    const command = checkSpellingCommand({ client, settings: store(), ask });

    await command.run({
      docId: undefined,
      version: undefined,
      hasSelection: false,
      dirty: false,
      page: 0,
      pageCount: undefined,
    } as CommandContext);

    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
    // BOTH, and neither alone. `when` is a predicate about what to SHOW, and a
    // palette can dispatch a command whose `when` is false — so the guard in
    // `run` is what actually holds, and this asserts they agree.
    // `?.` BECAUSE `when` IS OPTIONAL on a `UiCommand`, and the assertion is
    // still the one that matters: a command with no `when` yields `undefined`
    // here and fails, which is correct — a command without one is shown always.
    expect(command.when?.({ docId: undefined } as CommandContext)).toBe(false);
  });
});
