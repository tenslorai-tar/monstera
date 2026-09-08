import type { ContractClient, SpellingLanguage } from '@monstera/contract';
import { wordsOf } from '@monstera/shared';

/**
 * The spelling checker, built once per language and held while it is wanted.
 *
 * ## The cost is CONSTRUCTION, which is what decides the shape of this module
 *
 * Measured 2026-09-08 in a scratch tree (JOURNAL that date): building the
 * checker costs **401 ms and +23.95 MB RSS**; checking a 600-word page costs
 * **0.76 ms** and 12,000 words cost **5.7 ms**. So there is nothing to optimise
 * about checking and everything to decide about *when to build*.
 *
 * It is built on the first check and held after that. Not built at startup —
 * 400 ms and 24 MB is not a price to pay on every launch for a feature a reader
 * may never open. Not rebuilt per page — that would turn a 5 ms document into a
 * 400 ms one per page, which is the whole measurement inverted.
 *
 * ## `nspell` is imported DYNAMICALLY, and that is the laziness
 *
 * A static import would put the library in the renderer's first chunk whether
 * or not spell check is ever used. `import()` makes the bundler emit it as its
 * own chunk, fetched when this function first runs — so the 24 MB and the
 * library's own bytes both arrive on demand.
 *
 * ## The dictionary comes over a channel, and this module does not know why
 *
 * `dictionary-en` reads its files with `node:fs/promises`, and this package may
 * never import Node. Main answers `spelling.dictionary` with bytes and never
 * says where it got them, which is what keeps *bundled or downloaded* an open
 * decision (`SPELLING_LANGUAGES`).
 */

/** What a built checker can do. */
export interface SpellChecker {
  /** Whether the dictionary accepts this word. */
  readonly correct: (word: string) => boolean;
  /** Replacements, best first. Empty where the checker has none. */
  readonly suggest: (word: string) => readonly string[];
}

/** One misspelling, and where in the document it was seen. */
export interface Misspelling {
  readonly word: string;
  /** How many times it appears across the pages that were checked. */
  readonly occurrences: number;
  /** The first page it appears on, zero-based. */
  readonly firstPage: number;
  /** Replacements, best first, computed once for the first occurrence. */
  readonly suggestions: readonly string[];
}

/**
 * Builds a checker for one language.
 *
 * @param client the contract client, which answers `spelling.dictionary`
 * @param language which dictionary
 * @param personal words the reader added, accepted in addition to the
 *   dictionary's own. Applied here rather than filtered at the call site so
 *   that *what counts as correct* has one answer.
 * @returns the checker, or `null` where this build ships no such dictionary
 */
export async function buildChecker(
  client: ContractClient,
  language: SpellingLanguage,
  personal: readonly string[],
): Promise<SpellChecker | null> {
  const answer = await client['spelling.dictionary']({ language });
  if (!answer.ok || answer.value.kind !== 'dictionary') return null;

  const decoder = new TextDecoder();
  const affix = decoder.decode(answer.value.affix);
  const words = decoder.decode(answer.value.words);

  // TYPED BY `nspell.d.ts`, which declares the three members this build calls
  // and no more. The library ships no types, and B7's `any` exemption is for a
  // native boundary — this is ordinary JavaScript, so the answer is a
  // declaration rather than an exemption.
  const { default: nspell } = await import('nspell');
  const spell = nspell(affix, words);

  // ADDED AS A SET, so a personal dictionary with a duplicate costs nothing and
  // the caller need not deduplicate before handing it over.
  const added = new Set(personal.map((word) => word.toLowerCase()));

  return {
    correct: (word) => added.has(word.toLowerCase()) || spell.correct(word),
    suggest: (word) => spell.suggest(word),
  };
}

/**
 * Whether a word is one this feature has an opinion about.
 *
 * ## Numbers and single letters are SKIPPED, and both are decisions
 *
 * `Intl.Segmenter` calls `2026` and `x` word-like, correctly — they are words
 * in the segmentation sense. A dictionary has nothing useful to say about
 * either, and offering them as misspellings is how a list of real problems
 * becomes a list nobody reads: a page of figures would report every number on
 * it, and a mathematical document every variable.
 *
 * **This is not the segmenter being overruled** (B3a). The segmenter answers
 * *where does a word begin and end*, which nothing here re-derives. This
 * answers *is this word one a spelling dictionary can judge*, which is a
 * different question and this feature's own.
 */
function worthChecking(word: string): boolean {
  if (word.length < 2) return false;
  // ANY digit, not all: `3rd` and `H2O` are as unjudgeable as `2026`.
  return !/\d/u.test(word);
}

/**
 * Finds the misspellings in one page's lines.
 *
 * ## Occurrences are counted CASE-INSENSITIVELY and reported as first seen
 *
 * `Teh` and `teh` are one problem with one fix, and listing them separately
 * doubles the length of every list for no information. The word shown is the
 * first spelling encountered, because that is the one the reader will find when
 * they go looking.
 *
 * @param checker the built checker
 * @param lines the page's lines, in reading order
 * @param page which page these lines are, zero-based
 * @param into accumulated across pages, keyed by the lower-cased word
 */
export function collectMisspellings(
  checker: SpellChecker,
  lines: readonly string[],
  page: number,
  into: Map<string, Misspelling>,
): void {
  for (const word of wordsOf(lines)) {
    if (!worthChecking(word) || checker.correct(word)) continue;

    const key = word.toLowerCase();
    const seen = into.get(key);
    if (seen === undefined) {
      // SUGGESTED ONCE, for the first occurrence. `suggest` is the expensive
      // half of the library and the answer does not depend on where the word
      // was found, so asking again per occurrence buys nothing.
      into.set(key, { word, occurrences: 1, firstPage: page, suggestions: checker.suggest(word) });
      continue;
    }
    into.set(key, { ...seen, occurrences: seen.occurrences + 1 });
  }
}
