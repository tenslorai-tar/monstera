import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { MAX_AFFIX_BYTES, MAX_DICTIONARY_BYTES, type SpellingLanguage } from '@monstera/contract';

/**
 * Where a spelling dictionary's two files come from, and the ONE place that
 * knows.
 *
 * ## Why this is main's job and not the renderer's
 *
 * `dictionary-en` reads its own `index.aff` and `index.dic` with
 * `node:fs/promises` **at module top level**. The renderer may never import
 * Node, so it cannot import that package at all — which is the half of spell
 * check that `docs/FEATURES.md`' row did not have when it recorded that the
 * feature needs no new channel. Checking needs none; the dictionary does.
 *
 * ## Resolved THROUGH THE PACKAGE, and then joined
 *
 * `dictionary-en`'s `exports` field is the string `"./index.js"`, so the two
 * data files have no subpath a resolver will answer for. The package's root
 * export resolves and the files sit beside it — the same idiom
 * `hostEntryPath` and `proof:activecontent` use, and for the same reason: a
 * path built by walking up from `__dirname` breaks silently the day the layout
 * moves, while a resolution failure names the package it could not find.
 *
 * ## The map is keyed by the declared type, which is the mechanism
 *
 * `Record<SpellingLanguage, string>` is exhaustive, so adding an entry to the
 * contract's `SPELLING_LANGUAGES` makes this file a compile error until it is
 * filled in. That is B5 rather than a checklist item — there is no state in
 * which a declared language has no package here.
 */
const PACKAGE_OF: Record<SpellingLanguage, string> = {
  en: 'dictionary-en',
};

/** What one dictionary's files are, once read. */
export interface DictionaryBytes {
  readonly affix: Uint8Array;
  readonly words: Uint8Array;
}

/**
 * Reads one dictionary's affix file and word list.
 *
 * ## The bounds are checked HERE and not only at the boundary
 *
 * The channel's schema refuses an oversized payload, and a refusal there is an
 * incident with a correlation id and no useful text. Checking at the read gives
 * the size and the language, which is what a person diagnosing *why did spell
 * check stop working after we added Polish* needs. The schema stays as the
 * thing that cannot be talked past; this is the thing that says why.
 *
 * @returns the bytes, or `null` where the package is not installed — which is
 *   the `unknown-dictionary` refusal, a decided outcome rather than a failure.
 */
export async function readSpellingDictionary(
  language: SpellingLanguage,
): Promise<DictionaryBytes | null> {
  const packageName = PACKAGE_OF[language];
  let base: string;
  try {
    base = dirname(createRequire(import.meta.url).resolve(packageName));
  } catch {
    // NOT RETHROWN. A declared language whose package is absent is a build that
    // shipped without a dependency — real, actionable, and not an exception the
    // renderer can do anything with. It becomes `unknown-dictionary`.
    return null;
  }

  const [affix, words] = await Promise.all([
    readFile(join(base, 'index.aff')),
    readFile(join(base, 'index.dic')),
  ]);

  if (affix.byteLength > MAX_AFFIX_BYTES) {
    throw new Error(
      `the ${language} affix file is ${String(affix.byteLength)} bytes, past the ` +
        `${String(MAX_AFFIX_BYTES)}-byte bound. An affix file is a grammar rather than a word ` +
        `list, so a large one is a wrong file rather than a rich language.`,
    );
  }
  if (words.byteLength > MAX_DICTIONARY_BYTES) {
    throw new Error(
      `the ${language} word list is ${String(words.byteLength)} bytes, past the ` +
        `${String(MAX_DICTIONARY_BYTES)}-byte bound. Raise the bound only with a measurement ` +
        `of this dictionary — never to a larger round number that makes this message go away.`,
    );
  }

  return { affix: new Uint8Array(affix), words: new Uint8Array(words) };
}
