import type { ContractClient, SpellingLanguage } from '@monstera/contract';

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
  const spell = await dictionaryFor(client, language);
  if (spell === null) return null;

  // ADDED AS A SET, so a personal dictionary with a duplicate costs nothing and
  // the caller need not deduplicate before handing it over.
  const added = new Set(personal.map((word) => word.toLowerCase()));

  return {
    correct: (word) => added.has(word.toLowerCase()) || spell.correct(word),
    suggest: (word) => spell.suggest(word),
  };
}

/**
 * Each client's built dictionaries, by language — the 401 ms built ONCE and held, as this module's header says.
 *
 * Keyed by the client as well, because a client is a source of dictionaries: two test shims answer two dictionaries,
 * and a dictionary held for the first would answer for the second. The personal words are not part of what is held,
 * since they change while it is held; {@link buildChecker} applies them over it. A dictionary that would not load is
 * not held, so the next check asks again.
 */
const DICTIONARIES = new WeakMap<ContractClient, Map<SpellingLanguage, Promise<SpellChecker | null>>>();

function dictionaryFor(client: ContractClient, language: SpellingLanguage): Promise<SpellChecker | null> {
  let held = DICTIONARIES.get(client);
  if (held === undefined) {
    held = new Map();
    DICTIONARIES.set(client, held);
  }
  const built = held.get(language);
  if (built !== undefined) return built;
  const building = loadDictionary(client, language);
  held.set(language, building);
  void building.then((spell) => {
    if (spell === null) held.delete(language);
  });
  return building;
}

async function loadDictionary(client: ContractClient, language: SpellingLanguage): Promise<SpellChecker | null> {
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
  return { correct: (word) => spell.correct(word), suggest: (word) => spell.suggest(word) };
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
export function worthChecking(word: string): boolean {
  if (word.length < 2) return false;
  // ANY digit, not all: `3rd` and `H2O` are as unjudgeable as `2026`.
  return !/\d/u.test(word);
}
