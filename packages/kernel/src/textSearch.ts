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
 * ## Matching is per LINE, and the limitation is stated rather than hidden
 *
 * A match spanning a line break is not found. That is a real limit and it is the
 * honest one to start with: joining lines to search across them requires knowing
 * whether the break is a wrap or a paragraph, and inventing that rule here would
 * be the clustering this substrate exists not to re-implement. The block
 * boundary MuPDF gives is the input to that question, and the feature that needs
 * it — a search that spans wraps — owes the reading, exactly as `table-hunt`
 * does.
 */

/** One occurrence, located in the reading order the substrate produced. */
export interface TextMatch {
  /** Zero-based page index, as `commands.ts` declares page indices. */
  readonly page: number;
  /** Index of the line within that page's reading order. */
  readonly line: number;
  /** Offset of the match within the line's text, in UTF-16 code units. */
  readonly offset: number;
  /** The line the match sits in, so a caller needs no second lookup. */
  readonly text: string;
}

/** How a query is compared against the text. */
export interface SearchOptions {
  /** Default false — a reader looking for "pdf" expects "PDF". */
  readonly caseSensitive?: boolean;
  /**
   * Stop after this many matches, across all pages.
   *
   * **Absent means unbounded, and that is deliberate.** A default cap would make
   * *"no more matches"* and *"the cap was reached"* the same observation for
   * every caller that did not set one, which is the reassuring answer wearing a
   * result's clothes. A caller that wants a bound states it and can then tell
   * the two apart by comparing the count.
   */
  readonly limit?: number;
}

/**
 * Every occurrence of `query` in the given pages, in reading order.
 *
 * @param pages one entry per page, in document order, as `readPageText` returns
 *   them. The `page` index in each match is the position in THIS array, so a
 *   caller searching a subset maps it back itself rather than this module
 *   guessing what the subset meant.
 * @throws on an empty query — see below.
 */
export function findInPages(
  pages: readonly PageText[],
  query: string,
  options: SearchOptions = {},
): readonly TextMatch[] {
  if (query === '') {
    // AN EMPTY QUERY MATCHES EVERY POSITION, so the honest answers are "every
    // offset in the document" and "nothing", and both are wrong. Refusing is
    // the third option: a caller with an empty search box has not asked a
    // question yet, and a result list of every character is what it would get.
    throw new Error(
      'findInPages was given an empty query. Every position matches it, so any answer here is ' +
        'either a document-sized result list or a silent zero, and the caller has not actually ' +
        'asked a question.',
    );
  }

  const caseSensitive = options.caseSensitive ?? false;
  const needle = caseSensitive ? query : query.toLowerCase();
  const limit = options.limit;

  const matches: TextMatch[] = [];
  for (const [page, pageText] of pages.entries()) {
    for (const [line, entry] of linesOf(pageText).entries()) {
      const haystack = caseSensitive ? entry.text : entry.text.toLowerCase();
      let from = 0;
      for (;;) {
        const offset = haystack.indexOf(needle, from);
        if (offset < 0) break;
        matches.push({ page, line, offset, text: entry.text });
        if (limit !== undefined && matches.length >= limit) return matches;
        // ADVANCE BY ONE, not by the needle's length: overlapping occurrences
        // are occurrences. Searching "aa" in "aaa" finds two, and a reader
        // stepping through matches expects the one starting at offset 1.
        from = offset + 1;
      }
    }
  }

  return matches;
}

/** The line a match sits in, for a caller that holds the pages. */
export function lineOf(pages: readonly PageText[], match: TextMatch): TextLine | undefined {
  const page = pages[match.page];
  return page === undefined ? undefined : linesOf(page)[match.line];
}
