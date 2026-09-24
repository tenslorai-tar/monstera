/**
 * The languages a page can be translated into, and why the list stops where it does.
 *
 * ## Every language here is written in WinAnsiEncoding's letters
 *
 * A translation is written back into the page (ADR-0097). Where the page's own font cannot carry a
 * letter, the write falls back to one of PDF's standard fonts — which every reader supplies, so
 * nothing is embedded — and those fonts are encoded in WinAnsi: the Latin alphabet with Western
 * European accents, plus `Š š Ž ž Œ œ Ÿ`. A language needing a letter outside that set (Polish `ł`,
 * Czech `ř`, Turkish `ğ`, any non-Latin script) would be refused block by block after the provider
 * had been paid to translate it, so it is not offered. That is a stated limit, not a preference.
 *
 * The id is what crosses the wire; the English name is what the instruction to the provider says,
 * because a model asked for *French* is asked in the words it was trained on. The renderer shows
 * each language by its own catalogue key, never this name.
 */
export const TRANSLATION_LANGUAGES = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ca: 'Catalan',
  gl: 'Galician',
  da: 'Danish',
  sv: 'Swedish',
  nb: 'Norwegian Bokmål',
  fi: 'Finnish',
  et: 'Estonian',
  is: 'Icelandic',
  ga: 'Irish',
  af: 'Afrikaans',
  id: 'Indonesian',
  ms: 'Malay',
  sw: 'Swahili',
} as const;

export type TranslationLanguage = keyof typeof TRANSLATION_LANGUAGES;

/** The ids, as a tuple `z.enum` takes. */
export const TRANSLATION_LANGUAGE_IDS = Object.keys(TRANSLATION_LANGUAGES) as [
  TranslationLanguage,
  ...TranslationLanguage[],
];
