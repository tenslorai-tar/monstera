import { type PageText, linesOf } from './textStructure.js';

/**
 * How well a page's extracted text matches a known-correct answer.
 *
 * ## What this scores, and why the subject changed
 *
 * `BUILD-PROMPT.md` Part E2 asks for *"a measurable accuracy score"* with
 * *"constants [that] change only with a corpus score in the commit message"*.
 * [ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
 * removed the constants — MuPDF does the clustering — and kept the score, with
 * its subject moved to **the flag choice and the normalisation**.
 *
 * That is not a weaker gate. It is the one thing that would notice a MuPDF
 * upgrade silently changing segmentation, which is the regression this
 * substrate is now most exposed to and which no other check in this build
 * could see.
 *
 * ## TWO numbers, because one of them is blind to the failure that matters
 *
 * **`lines`** catches merging and splitting: a grouper that reads across a
 * gutter produces `left0 right0` where the truth holds `left0` and `right0`,
 * and that shows up as missing lines.
 *
 * **`order`** catches reading order, and nothing else does. The measurement
 * ADR-0034 rests on is exactly this case: with no options MuPDF returns *ten
 * correct lines* in row-major order — every line perfect, the document
 * unreadable. A score that reported only `lines` would have given that 1.00 and
 * called the two-column question closed.
 *
 * So a single blended figure is refused. Averaging them would let a perfect
 * `lines` hide a broken `order`, which is the failure the whole ADR turns on.
 */
export interface TextAccuracy {
  /** Fraction of expected lines present exactly once, 0 to 1. */
  readonly lines: number;
  /**
   * Fraction of expected line PAIRS whose relative order was preserved, 0 to 1.
   *
   * Pairwise rather than positional: one line missing from the middle shifts
   * every later position and would score a correctly-ordered page near zero,
   * which would make the number react to `lines`' failure instead of its own.
   */
  readonly order: number;
  /** Expected lines that never appeared, for a message that names them. */
  readonly missing: readonly string[];
}

/**
 * Scores a parsed page against the lines its generator placed, in the order a
 * reader should meet them.
 *
 * **`expected` must come from the generator, never from a run of this code.**
 * A fixture labelled by a clusterer measures agreement with that clusterer,
 * which is 1.00 by construction and says nothing about correctness. The
 * fixtures this is used with place every run at a chosen coordinate, so their
 * truth is a property of the generator.
 *
 * @param page the parsed structured text
 * @param expected every line the generator placed, in correct reading order
 */
export function scoreAgainstTruth(page: PageText, expected: readonly string[]): TextAccuracy {
  if (expected.length === 0) {
    // A SCORE WITH NOTHING TO SCORE IS 1.00, which is the reassuring answer and
    // is what an empty truth list would hand every caller for free. Refused for
    // the reason item 4b gives: an empty input set must never look like a pass.
    throw new Error(
      'scoreAgainstTruth was given no expected lines. Every accuracy is perfect against an ' +
        'empty truth, so this is a broken fixture rather than a clean one.',
    );
  }

  const produced = linesOf(page).map((line) => line.text);

  // POSITION OF FIRST OCCURRENCE, because a line appearing twice is not evidence
  // that it appeared in two right places — the pair comparison below needs one
  // position per expected line, and the first is the one a reader meets.
  const positions = new Map<string, number>();
  for (const [index, text] of produced.entries()) {
    if (!positions.has(text)) positions.set(text, index);
  }

  const missing = expected.filter((text) => !positions.has(text));
  const found = expected.filter((text) => positions.has(text));

  let pairs = 0;
  let ordered = 0;
  for (let i = 0; i < found.length; i += 1) {
    for (let j = i + 1; j < found.length; j += 1) {
      pairs += 1;
      const left = positions.get(found[i] ?? '');
      const right = positions.get(found[j] ?? '');
      if (left !== undefined && right !== undefined && left < right) ordered += 1;
    }
  }

  return {
    lines: found.length / expected.length,
    // A PAGE WITH ONE FINDABLE LINE HAS NO PAIRS, so order is undefined rather
    // than perfect. Reporting 1.00 there would say the reading order was
    // checked when nothing was compared.
    order: pairs === 0 ? 0 : ordered / pairs,
    missing,
  };
}
