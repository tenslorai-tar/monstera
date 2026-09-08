/** What a page's text contributes to a document's totals. */
export interface WordCount {
  /** Word-like segments, as the platform's own segmenter identifies them. */
  readonly words: number;
  /** Characters, counted as Unicode code points rather than UTF-16 units. */
  readonly characters: number;
  /** Characters excluding whitespace, which is the figure most editors show. */
  readonly charactersNoSpaces: number;
}

/**
 * Counting words and characters, once, where both callers can reach it.
 *
 * ## Why this is in `shared` and not in the kernel
 *
 * `textMatch.ts` is here for a reason this file inherits exactly: the browser
 * shim answers `document.pageWordCount` and **may not import the kernel**, so a
 * counting rule living there would be re-implemented in the shim — and the two
 * would agree until one of them changed. `findInLines` moved here after that
 * happened to the search's matching rule, which had a comment claiming it
 * followed the kernel's while quietly being a lower-case `indexOf` loop.
 *
 * ## THE SEGMENTER IS THE PLATFORM'S, NOT A REGEX HERE
 *
 * *What is a word* is a question `Intl.Segmenter` already answers, to the
 * Unicode segmentation rules, in both runtimes this application has. Splitting
 * on whitespace is the obvious alternative and it is a **second opinion about a
 * solved question** (B3a) — and a worse one, in a way invisible on the documents
 * a developer tests with:
 *
 * - Chinese, Japanese and Thai are written without spaces, so a whitespace split
 *   reports a paragraph as **one word**. Not an edge case: it is most of the
 *   writing in the world by volume, and it fails toward *this document is nearly
 *   empty* rather than toward an obvious error.
 * - `don't` and `state-of-the-art` split differently under every hand-rolled
 *   rule, and every such rule is somebody's guess.
 *
 * So the rule this build states is short and checkable: **a word is a word-like
 * segment**, which is the segmenter's own `isWordLike`. Punctuation and
 * whitespace segments are not counted, and nothing here decides which is which.
 *
 * ## Characters are CODE POINTS, and that is a decision rather than a default
 *
 * `String.prototype.length` counts UTF-16 code units, so an emoji or a rarer CJK
 * ideograph outside the basic plane counts as two. A person counting characters
 * means the things they can see. Iterating a string yields code points, which is
 * the closest cheap answer — it still counts a combining sequence as more than
 * one, and that is **stated rather than hidden**, because the alternative is a
 * grapheme segmenter per page and the difference changes no word count.
 */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Whitespace, as one place rather than a literal at each use. */
const WHITESPACE = /\s/u;

/**
 * Counts the words and characters in a page's lines.
 *
 * ## The join is the rule, and it is here rather than at each caller
 *
 * A structured-text line is a run on a baseline, so a wrapped sentence arrives
 * as two of them. Concatenating without a separator fuses the last word of one
 * line with the first of the next into a word that appears in no document — and
 * the count is then short by one per line, in the direction nobody checks.
 *
 * The separator is counted in `characters` too, so the two figures describe one
 * page rather than two different ones.
 *
 * @param lines the page's lines, in reading order
 */
/**
 * The words in a page's lines, as the segmenter identifies them.
 *
 * ## Extracted so that spell check and word count cannot disagree
 *
 * Spell check needs the words themselves where this file's other caller needs
 * only how many, and the obvious spelling — a regex or a whitespace split at
 * the spelling caller — is a **second opinion about what a word is** (B3a). The
 * two would agree on English prose and differ on `don't`, on
 * `state-of-the-art`, and on every language written without spaces, so a
 * document could report a word count of 400 and offer 380 words to check with
 * nothing anywhere able to say which was right.
 *
 * {@link countWords} takes its `words` figure from this generator, so there is
 * one rule and not two that happen to match.
 *
 * The join is the same rule and for the same reason — a structured-text line is
 * a run on a baseline, so a wrapped sentence arrives as two, and concatenating
 * without a separator fuses the last word of one line with the first of the
 * next into a word that appears in no document. For a **count** that is short
 * by one per line; for a **spell check** it is a fabricated misspelling, which
 * is louder and worse: the reader is shown a word they never wrote.
 *
 * @param lines the page's lines, in reading order
 */
export function* wordsOf(lines: readonly string[]): Generator<string> {
  for (const segment of SEGMENTER.segment(lines.join(' '))) {
    if (segment.isWordLike === true) yield segment.segment;
  }
}

export function countWords(lines: readonly string[]): WordCount {
  const text = lines.join(' ');

  let words = 0;
  for (const _word of wordsOf(lines)) words += 1;

  let characters = 0;
  let charactersNoSpaces = 0;
  for (const point of text) {
    characters += 1;
    if (!WHITESPACE.test(point)) charactersNoSpaces += 1;
  }

  return { words, characters, charactersNoSpaces };
}
