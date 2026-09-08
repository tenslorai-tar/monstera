import { SPELLING_LANGUAGES, type SpellingLanguage } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { SPELL_CHECK_LANGUAGE_EN } from '../messages/en.js';

/**
 * What each shipped dictionary is called, where a reader can see it.
 *
 * ## Keyed by the declared type, which is the whole mechanism
 *
 * `Record<SpellingLanguage, MessageKey>` is exhaustive: adding an entry to
 * `SPELLING_LANGUAGES` makes this file a compile error until a title exists,
 * exactly as it does to main's package map. So a language cannot ship with no
 * name in the interface, and neither list has to be remembered — the contract's
 * is the writer of record and both sides are derived from it (B3).
 *
 * ## A MESSAGE KEY and not a string
 *
 * *English* is a word in the reader's language, not in the dictionary's. A
 * literal here would be the one place a shipped string escaped B9's rule, and
 * it would be the string a person whose interface is in French sees in English.
 */
const TITLE_OF: Record<SpellingLanguage, MessageKey> = {
  en: SPELL_CHECK_LANGUAGE_EN,
};

/**
 * The language spell check uses.
 *
 * ## One shipped dictionary, so this is a resolution and not a preference
 *
 * There is deliberately **no language setting**. A select offering one option
 * is a control that renders and does nothing, which this project calls a defect
 * rather than a placeholder — and the wired rule does not soften for a control
 * that will be useful later.
 *
 * What exists instead is the shape a second language drops into: the contract's
 * list is the writer of record, this file and main's package map are both keyed
 * by it, and the day a second entry lands the compile errors say where the
 * choice has to become one. **That is the trigger for registering a setting**,
 * and it is the only work a second dictionary needs beyond its own licence
 * notice.
 */
export function activeLanguage(): SpellingLanguage {
  // INDEX 0 OF A NON-EMPTY `as const` TUPLE, which the type system knows is
  // present — so there is no fallback here standing in for a list that could be
  // empty, and no state in which this returns something undeclared.
  return SPELLING_LANGUAGES[0];
}

/** What to call a language in the interface. */
export function languageTitle(language: SpellingLanguage): MessageKey {
  return TITLE_OF[language];
}
