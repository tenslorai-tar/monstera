import { type DocVersion, type MessageKey, tokensOf } from '@monstera/shared';

import { type SpellChecker, worthChecking } from './checker.js';

/**
 * What a spelling review holds, and the order it goes in (ADR-0156 Decision 2). Pure: the reads and the edits are
 * `reviewRun.ts`'s, so everything here is a function of the words it is handed.
 *
 * ## An occurrence is named by where it is, in the space its edit speaks
 *
 * A word on the page is a line and an offset in that page's `document.pageTextLayer` lines, which is what the find
 * highlight marks (`ActiveMatch`) and what the word boxes pair with. A comment is the annotation walk's handle and an
 * offset in its whole words; a field is the widget walk's handle and an offset in its value. Each is the address the
 * edit for it takes, so no occurrence needs a second name to be changed.
 *
 * ## The words are `tokensOf`'s
 *
 * The segmenter `wordsOf` and the word count read, one line at a time, so the review and the word count cannot
 * disagree about where a word ends, and the offset is the token's own index in the string it is spliced into.
 */

/** Where one occurrence is: in a page's text, in a comment, or in a text field, each on a page. */
export type SpellingPlace =
  | { readonly kind: 'text'; readonly page: number; readonly line: number; readonly offset: number }
  | { readonly kind: 'comment'; readonly page: number; readonly index: number; readonly offset: number }
  | { readonly kind: 'field'; readonly page: number; readonly index: number; readonly offset: number };

/** One misspelt word, where it is, and what it sits in. */
export interface SpellingOccurrence {
  readonly word: string;
  readonly place: SpellingPlace;
  /** The whole text it sits in: the page's line, the comment's words, the field's value. */
  readonly context: string;
  /**
   * Whether a replacement may be written. `false` for a comment whose whole words could not be read — one longer than
   * an edit can write back — because the context is then a slice, and an edit spliced into a slice saves it over the
   * rest. Such a word is still shown, and its Replace says why it is not written.
   */
  readonly writable: boolean;
  /** For a field, its name, which is how a person finds it. */
  readonly name?: string | undefined;
}

/**
 * One document's review, as its store holds it (ADR-0156). `run` names the review a read or an edit belongs to, so one
 * that finishes after the review was stopped or started again writes nothing.
 */
export type SpellingReview =
  /** Reading the pages; the panel says how far it has got and offers Stop. */
  | { readonly phase: 'reading'; readonly run: number; readonly checked: number; readonly pageCount: number }
  /** This build has no dictionary to check against — not an empty review, which would read as a clean document. */
  | { readonly phase: 'unavailable'; readonly run: number }
  /** The document refused a read, so nothing it said can be listed. */
  | { readonly phase: 'refused'; readonly run: number }
  | SpellingReviewing;

/** A review with its words read: the current one, and where the rest are. */
export interface SpellingReviewing {
  readonly phase: 'reviewing';
  readonly run: number;
  /** Every misspelt word the review covers, in reading order, including the ones already passed. */
  readonly occurrences: readonly SpellingOccurrence[];
  /** The word the panel shows, or `undefined` once the review has gone through. */
  readonly current: SpellingOccurrence | undefined;
  /** The checker's replacements for {@link current}, best first. */
  readonly suggestions: readonly string[];
  /** Words Ignore all or Add to dictionary set aside for the rest of this review, by {@link skipKey}. */
  readonly skipped: readonly string[];
  /** The version the comments and fields were read at, which their edits name. */
  readonly listsVersion: DocVersion | undefined;
  /** An edit is on its way; the controls wait for it. */
  readonly busy: boolean;
  /** What the last action could not do, said under the word. */
  readonly notice: MessageKey | undefined;
  /** How many words this review has changed. */
  readonly replaced: number;
}

/** The misspelt words in one string, each placed by `at` from its offset in it. */
export function occurrencesIn(
  checker: SpellChecker,
  text: string,
  at: (offset: number) => SpellingPlace,
  extra: { readonly writable: boolean; readonly name?: string | undefined } = { writable: true },
): SpellingOccurrence[] {
  const found: SpellingOccurrence[] = [];
  for (const token of tokensOf(text)) {
    if (!token.isWord || !worthChecking(token.text) || checker.correct(token.text)) continue;
    found.push({ word: token.text, place: at(token.index), context: text, ...extra });
  }
  return found;
}

/** The misspelt words in one page's text layer lines, in reading order. */
export function pageOccurrences(checker: SpellChecker, page: number, lines: readonly string[]): SpellingOccurrence[] {
  return lines.flatMap((line, at) =>
    occurrencesIn(checker, line, (offset) => ({ kind: 'text', page, line: at, offset })),
  );
}

/** Text on a page comes before its comments, and its comments before its fields. */
const KIND_ORDER: Readonly<Record<SpellingPlace['kind'], number>> = { text: 0, comment: 1, field: 2 };

/** Where a place's own row is: a line of text, or a comment's or field's handle. */
function rowOf(place: SpellingPlace): number {
  return place.kind === 'text' ? place.line : place.index;
}

/**
 * Reading order: by page, then text before comments before fields, then line or handle, then offset. A review goes
 * through a page and what is written on it before it turns the page.
 */
export function comparePlaces(a: SpellingPlace, b: SpellingPlace): number {
  return (
    a.page - b.page || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || rowOf(a) - rowOf(b) || a.offset - b.offset
  );
}

/** Every occurrence in reading order. */
export function sortedOccurrences(occurrences: readonly SpellingOccurrence[]): SpellingOccurrence[] {
  return [...occurrences].sort((a, b) => comparePlaces(a.place, b.place));
}

/**
 * Where the review goes on from, past `occurrence` once its word is `length` long — the word's own length when it is
 * passed over, the replacement's when it was replaced, so the next word on the same line is the first one after it.
 */
export function pastOccurrence(occurrence: SpellingOccurrence, length = occurrence.word.length): SpellingPlace {
  return { ...occurrence.place, offset: occurrence.place.offset + length };
}

/** The key a word is skipped by: as the personal dictionary compares, without case. */
export function skipKey(word: string): string {
  return word.toLowerCase();
}

/** The first occurrence at or after `from` whose word is not skipped, or `undefined` when the review has gone through. */
export function nextOccurrence(
  occurrences: readonly SpellingOccurrence[],
  from: SpellingPlace | undefined,
  skipped: ReadonlySet<string>,
): SpellingOccurrence | undefined {
  return occurrences.find(
    (each) => (from === undefined || comparePlaces(each.place, from) >= 0) && !skipped.has(skipKey(each.word)),
  );
}

/**
 * `text` with the word at `offset` replaced, or `undefined` where the word is not there.
 *
 * The word is checked rather than assumed: the text was read for the occurrence and the splice is made from it, so a
 * mismatch is a text that changed under the review, and splicing at the old offset would write into the wrong word.
 */
export function splicedAt(text: string, offset: number, word: string, replacement: string): string | undefined {
  if (text.slice(offset, offset + word.length) !== word) return undefined;
  return text.slice(0, offset) + replacement + text.slice(offset + word.length);
}

/**
 * `text` with EVERY occurrence of `word` that the review found in it replaced — offsets taken from the occurrences
 * themselves, so a word the segmenter did not cut as a whole word (inside another one) is left alone. Applied from the
 * end, so an earlier offset is not moved by a later splice.
 */
export function splicedAll(
  text: string,
  offsets: readonly number[],
  word: string,
  replacement: string,
): string | undefined {
  let result = text;
  for (const offset of [...offsets].sort((a, b) => b - a)) {
    const next = splicedAt(result, offset, word, replacement);
    if (next === undefined) return undefined;
    result = next;
  }
  return result;
}
