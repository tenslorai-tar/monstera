import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SPELLING_DICTIONARY_FULL, SPELLING_WORD_TOO_LONG } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { MAX_PERSONAL_WORDS, PERSONAL_DICTIONARY_SETTING } from '../settings/editing.js';
import { SettingsStore } from '../settingsStore.js';
import { keepWord, lookUp, MAX_MENU_SUGGESTIONS } from './personalWords.js';

/** A dictionary small enough to state in full; a case asserting a word is wrong names the whole vocabulary. */
const client: ContractClient = createClient(channels, () =>
  Promise.resolve(
    ok({
      kind: 'dictionary',
      language: 'en',
      affix: new TextEncoder().encode('SET UTF-8\n'),
      words: new TextEncoder().encode('4\ndocument\npage\nspelling\nannotation\n'),
    }),
  ),
);

const freshSettings = (): SettingsStore => new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
const personal = (settings: SettingsStore): readonly string[] =>
  PERSONAL_DICTIONARY_SETTING.schema.parse(settings.get(PERSONAL_DICTIONARY_SETTING.id));

describe('keepWord', () => {
  it('keeps a word, once, without regard to case', () => {
    const settings = freshSettings();
    expect(keepWord(settings, 'Monstera')).toBeUndefined();
    expect(personal(settings)).toStrictEqual(['Monstera']);
    // THE SAME WORD AGAIN, in another case, is already kept and adds nothing.
    expect(keepWord(settings, 'monstera')).toBeUndefined();
    expect(personal(settings)).toStrictEqual(['Monstera']);
  });

  it('SAYS a word past the bound and a full list, rather than dropping them', () => {
    const settings = freshSettings();
    expect(keepWord(settings, 'x'.repeat(129))).toBe(SPELLING_WORD_TOO_LONG);
    expect(personal(settings)).toStrictEqual([]);
    settings.set(PERSONAL_DICTIONARY_SETTING.id, Array.from({ length: MAX_PERSONAL_WORDS }, (_, at) => `word${String(at)}`));
    expect(keepWord(settings, 'another')).toBe(SPELLING_DICTIONARY_FULL);
    expect(personal(settings)).toHaveLength(MAX_PERSONAL_WORDS);
  });
});

describe('lookUp', () => {
  it('has an opinion of a wrong word and none of a right one, a number, or a single letter', async () => {
    const deps = { client, settings: freshSettings() };
    const wrong = await lookUp(deps, 'documnet');
    expect(wrong).toBeDefined();
    expect(wrong?.suggestions).toContain('document');
    expect(wrong?.suggestions.length).toBeLessThanOrEqual(MAX_MENU_SUGGESTIONS);
    // CONTROL: the right word, the unjudgeable ones.
    expect(await lookUp(deps, 'document')).toBeUndefined();
    expect(await lookUp(deps, '2026')).toBeUndefined();
    expect(await lookUp(deps, 'x')).toBeUndefined();
  });

  it('accepts a word that was kept a moment ago, since the personal dictionary is read now', async () => {
    const settings = freshSettings();
    const deps = { client, settings };
    expect(await lookUp(deps, 'documnet')).toBeDefined();
    keepWord(settings, 'documnet');
    expect(await lookUp(deps, 'documnet')).toBeUndefined();
  });
});
