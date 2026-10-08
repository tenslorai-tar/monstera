/**
 * Where a line of text Monstera sets may end
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## The words are ICU's, and the rule is ours and stated
 *
 * Unicode's line breaking algorithm (UAX #14) is the authority for where a line may break, and nothing in this
 * runtime answers it: V8 carries ICU's line break iterator only behind the non-standard `Intl.v8BreakIterator`, which
 * is absent from Node 22 (measured 2026-10-05), and `Intl.Segmenter` offers graphemes, words and sentences, not lines.
 * The one package that implements UAX #14 for JavaScript, `linebreak` 1.1.0 (2022), depends on `unicode-trie`, which
 * depends on `pako` 0.2 from 2014, and treats Thai as one unbreakable run, which is the case this module exists for.
 *
 * So this is NOT an implementation of UAX #14, and it does not claim to agree with it. It is the composers' own stated
 * rule over ICU's WORD boundaries, which ICU finds with a dictionary in Thai, Lao, Khmer, Myanmar, Chinese and
 * Japanese, where words are not separated by spaces:
 *
 * - **After a run of spaces**, before the next word, as the composers always broke.
 * - **Between two words where either side is a script written without spaces**, so a Thai or Chinese line breaks
 *   between words rather than running past the margin.
 * - **Never before a mark that closes or ends something** (`)`, `」`, `。`, `,`, `!`) and never after one that opens
 *   (`(`, `「`), which is the rule a reader of either script notices first when it is broken.
 *
 * What it leaves out, deliberately and visibly: a break after a hyphen in a Latin word, which the composers never
 * made; and the finer Japanese rules about small kana, which a line of Japanese set here may start with.
 *
 * ## The last resort is a GRAPHEME, never a code point
 *
 * A word wider than its whole line is broken where it must be, and only between grapheme clusters: a Thai vowel sign
 * or a combining accent cut from its letter draws on its own as a dotted circle.
 */

const WORDS = new Intl.Segmenter('und', { granularity: 'word' });
const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Scripts written without spaces between words, so a break between two of their words is ordinary. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Yi}\p{Script=Tai_Tham}\p{Script=Tai_Viet}\p{Script=New_Tai_Lue}\p{Script=Javanese}\p{Script=Balinese}\u{3000}-\u{303f}\u{ff00}-\u{ffef}]/u;

/** A mark a line never starts with: one that closes, ends a quotation, or is punctuation that follows its word. */
const NEVER_FIRST = /^[\p{Pe}\p{Pf}\p{Po}]/u;

/** A mark a line never ends with: one that opens, or begins a quotation. */
const NEVER_LAST = /[\p{Ps}\p{Pi}]$/u;

const SPACE = /\s/u;

/**
 * The indices of `text`, as UTF-16 offsets, before which a line may break, in order. Never 0 and never the end: a
 * break there ends nothing.
 */
export function breakOpportunities(text: string): number[] {
  const opportunities: number[] = [];
  let previous: string | null = null;
  for (const { segment, index } of WORDS.segment(text)) {
    if (previous !== null && index > 0) {
      const last = Array.from(previous).at(-1) ?? '';
      const first = Array.from(segment)[0] ?? '';
      const afterSpace = SPACE.test(last) && !SPACE.test(first);
      const betweenUnspaced =
        !SPACE.test(last) &&
        !SPACE.test(first) &&
        (UNSPACED.test(last) || UNSPACED.test(first)) &&
        !NEVER_FIRST.test(first) &&
        !NEVER_LAST.test(last);
      if (afterSpace || betweenUnspaced) opportunities.push(index);
    }
    previous = segment;
  }
  return opportunities;
}

/** The indices between `text`'s grapheme clusters, as UTF-16 offsets, never 0 and never the end. */
export function graphemeBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  for (const { index } of GRAPHEMES.segment(text)) if (index > 0) boundaries.push(index);
  return boundaries;
}
