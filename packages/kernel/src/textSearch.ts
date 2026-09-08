import {
  type QueryProblem,
  type Result,
  type TextMatchOptions,
  findInLines,
  ok,
} from '@monstera/shared';

import { type PageText, type TextLine, linesOf } from './textStructure.js';

/**
 * Finding a string in a document's text — the text substrate's first consumer.
 *
 * ## Why this does not call MuPDF's own `search`
 *
 * `StructuredText` and `Page` both expose `search(needle, max_hits)`, returning
 * quads. It is tempting and it is the **K.0 regression Part E2 names in terms**:
 * *"a second extraction path anywhere"*. E2's whole argument is that editing,
 * Excel export, search and extraction consume **one** structure, and a search
 * that reached past it would be the first consumer to prove the rule does not
 * hold.
 *
 * The two also answer different questions. MuPDF's search answers *where on this
 * page*, in quads, for highlighting. This answers *where in the reading order*,
 * which is what a results list, a next-match walk and an extraction excerpt are
 * built from — and which depends on the segmentation
 * [ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
 * turned on. When highlighting needs quads, the line's `box` is already here in
 * Fitz space and `PageTransform` converts it; a second engine call is not what
 * that costs.
 *
 * ## A match may now SPAN a line break, and the reasoning that said it could not
 *
 * This section read *"a match spanning a line break is not found … joining lines
 * to search across them requires knowing whether the break is a wrap or a
 * paragraph, and inventing that rule here would be the clustering this
 * substrate exists not to re-implement."* The conclusion was right for a stage
 * and the premise was not: **the question does not have to be answered.** A
 * whitespace run in a literal query matches a whitespace run of any kind in the
 * text, so a wrap and a paragraph break are both simply *a gap*, and nothing
 * here has to decide which one it met. `textMatch.ts` does the joining, because
 * the browser shim answers this channel and the rule has one home (B3a).
 *
 * **What is genuinely not handled is HYPHENATION**, and that one does need the
 * decision this paragraph used to claim for the whole feature: `wor-` / `ld`
 * requires knowing that the hyphen was inserted by the typesetter rather than
 * written by the author, and `well-` / `known` is the counter-example in the
 * same shape. That is a reading against the corpus and it is owed by the
 * *Select and copy* row's bounds, not by this one.
 */

/** One occurrence, located in the reading order the substrate produced. */
export interface TextMatch {
  /** Zero-based page index, as `commands.ts` declares page indices. */
  readonly page: number;
  /** Index of the line the match STARTS in, within that page's reading order. */
  readonly line: number;
  /** Offset of the match within that line's text, in UTF-16 code units. */
  readonly offset: number;
  /** Index of the line the match ENDS in. Equal to `line` unless it crossed. */
  readonly endLine: number;
  /**
   * Offset one past the match's last character, within the `endLine`-th line.
   *
   * Into that line's own normalised text rather than into {@link text}, which
   * is the START line's window — see `LineMatch` in `@monstera/shared`.
   */
  readonly endOffset: number;
  /**
   * The line the match STARTS in, so a caller needs no second lookup.
   *
   * **After normalisation**, which is what keeps it and `offset` consistent:
   * NFC can change a line's length, so an offset into the raw extraction would
   * not index the string the caller was handed.
   */
  readonly text: string;
}

/**
 * How a query is compared against the text.
 *
 * The matching rule itself is `@monstera/shared`'s, because the browser shim
 * answers the same channel and may not import the kernel — see `textMatch.ts`.
 * This alias is what a kernel caller names.
 *
 * `limit` is absent-means-unbounded, and that is deliberate: a default cap
 * would make *"no more matches"* and *"the cap was reached"* the same
 * observation for every caller that did not set one, which is the reassuring
 * answer wearing a result's clothes. A caller that wants a bound states it and
 * can then tell the two apart by comparing the count.
 */
export type SearchOptions = TextMatchOptions;

/**
 * Every occurrence of `query` in the given pages, in reading order.
 *
 * @param pages one entry per page, in document order, as `readPageText` returns
 *   them. The `page` index in each match is the position in THIS array, so a
 *   caller searching a subset maps it back itself rather than this module
 *   guessing what the subset meant.
 * @returns the matches, or the reason the query could not be compiled — an
 *   empty query or, under `regex`, a pattern that does not parse. A `Result`
 *   rather than a throw, because both are things a person types into a field
 *   and a half-written pattern is not an exceptional condition.
 */
export function findInPages(
  pages: readonly PageText[],
  query: string,
  options: SearchOptions = {},
): Result<readonly TextMatch[], QueryProblem> {
  const limit = options.limit;
  const matches: TextMatch[] = [];
  for (const [page, pageText] of pages.entries()) {
    // THE REMAINING BUDGET, page by page. Handing each page the caller's whole
    // limit would return up to `limit` matches PER PAGE, which is the bound
    // silently multiplying by the document's length — and a caller comparing
    // the count against its own limit to decide `truncated` would then be
    // wrong in the direction that reads as "there is more".
    const perPage: SearchOptions =
      limit === undefined ? options : { ...options, limit: limit - matches.length };
    const found = findInLines(
      linesOf(pageText).map((line) => line.text),
      query,
      perPage,
    );
    if (!found.ok) return found;
    for (const hit of found.value) matches.push({ page, ...hit });
    if (limit !== undefined && matches.length >= limit) return ok(matches);
  }

  return ok(matches);
}

/** The line a match sits in, for a caller that holds the pages. */
export function lineOf(pages: readonly PageText[], match: TextMatch): TextLine | undefined {
  const page = pages[match.page];
  return page === undefined ? undefined : linesOf(page)[match.line];
}
