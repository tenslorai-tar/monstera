import type { ContractClient } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { SPELLING_DICTIONARY_FULL, SPELLING_WORD_TOO_LONG } from '../messages/en.js';
import { MAX_PERSONAL_WORDS, PERSONAL_DICTIONARY_SETTING } from '../settings/editing.js';
import type { SettingsStore } from '../settingsStore.js';
import { buildChecker, worthChecking } from './checker.js';
import { activeLanguage } from './languages.js';
import { skipKey } from './review.js';

/**
 * The personal dictionary's two operations, and the one question a right-click asks of a word: the review panel's Add to
 * dictionary and the editor's menu take the SAME functions, so what counts as a word that may be kept, and how a refusal
 * is said, has one answer (B3a).
 */

/**
 * Keeps `word` in the personal dictionary, for every later check. Re-reads the list rather than holding it: another review
 * or the Settings dialog may have changed it. Answers the sentence for a refusal and `undefined` where the word is kept or
 * was already: the setting's schema refuses a word past 128 characters and a list past its bound, and a set it refused
 * would leave a person believing the word was kept.
 */
export function keepWord(settings: SettingsStore, word: string): MessageKey | undefined {
  const current = PERSONAL_DICTIONARY_SETTING.schema.parse(settings.get(PERSONAL_DICTIONARY_SETTING.id));
  if (current.some((each) => skipKey(each) === skipKey(word))) return undefined;
  const refusal = word.length > 128 ? SPELLING_WORD_TOO_LONG : current.length >= MAX_PERSONAL_WORDS ? SPELLING_DICTIONARY_FULL : undefined;
  if (refusal !== undefined) return refusal;
  settings.set(PERSONAL_DICTIONARY_SETTING.id, [...current, word]);
  return undefined;
}

/** What a right-click on a word asks: whether the checker has an opinion, and its replacements, best first. */
export interface Lookup {
  readonly suggestions: readonly string[];
}

/** The most replacements a right-click offers: the menu is for a word's likely fixes, not the dictionary's list. */
export const MAX_MENU_SUGGESTIONS = 5;

/**
 * Whether `word` is misspelt, and what it might be: `undefined` where the checker has no opinion, which is a word it
 * accepts, one not worth checking (`worthChecking`) and a build with no dictionary alike. The personal dictionary is read
 * now, so a word kept a moment ago is accepted.
 */
export async function lookUp(
  deps: { readonly client: ContractClient; readonly settings: SettingsStore },
  word: string,
): Promise<Lookup | undefined> {
  if (!worthChecking(word)) return undefined;
  const personal = PERSONAL_DICTIONARY_SETTING.schema.parse(deps.settings.get(PERSONAL_DICTIONARY_SETTING.id));
  const checker = await buildChecker(deps.client, activeLanguage(), personal);
  if (checker === null || checker.correct(word)) return undefined;
  return { suggestions: checker.suggest(word).slice(0, MAX_MENU_SUGGESTIONS) };
}
