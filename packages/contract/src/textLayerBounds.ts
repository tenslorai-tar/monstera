/**
 * The text layer's two bounds, in a module of their own so the MuPDF host can read them (`host.ts` re-exports it, and
 * the host loads nothing heavier): the host writes a page's letters for exactly the lines the layer keeps, clipped as
 * the layer clips them ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md)'s
 * second correction), so the letters' file is bounded by these and not by a second figure.
 */

/**
 * How many lines of one page's text may cross as a selectable layer.
 *
 * ## The reasoning above does NOT transfer, which is why this is its own number
 *
 * `MAX_SEARCH_MATCHES` rests on *no results surface shows more than a screenful
 * before the user narrows the query*. A text layer has no such escape: it must
 * cover the **whole** page or the part past the bound cannot be selected, and
 * there is no query to narrow. So this bound is set from what a page actually
 * holds rather than from what a surface shows.
 *
 * Measured 2026-09-08 with the shipped substrate (`textStructure.ts` over MuPDF
 * 1.28.0 with `segment`), on A4 pages built to be denser than anything real:
 *
 * | page | lines | longest line |
 * |---|---|---|
 * | 6pt prose, 7pt leading, full page | 118 | 83 chars |
 * | a 12 × 70 table at 6pt | **840** | 6 chars |
 * | 2,000 separate one-glyph runs | 2,000 | 1 char |
 *
 * **A table cell is its own line**, which is what makes the second row the
 * interesting one: a spreadsheet page produces hundreds of lines where its prose
 * equivalent produces about a hundred, and `MAX_SEARCH_MATCHES` would have cut
 * it. 2,048 clears the densest page measured and the pathological one beside it.
 *
 * **Three synthetic pages are a shape, not a distribution.** The corpus reading
 * is owed — this is enough to catch a gross failure and not enough to tune a
 * constant against.
 *
 * **The trigger:** the first page that reports `truncated` for a reason other
 * than a hostile document is the evidence this is wrong, and the fix is a
 * measurement of that page rather than a larger round number.
 */
export const MAX_TEXT_LAYER_LINES = 2048;

/**
 * How many characters of one line may cross.
 *
 * A line's length is chosen by whoever made the document, so it is the second
 * unbounded axis and needs its own ceiling — `MAX_SEARCH_MATCHES`' note
 * about a count being the only axis does not hold here, because this text is not
 * clipped to a window around anything.
 *
 * Measured in the same run: the densest prose page's longest line was **83**
 * characters, and a page built deliberately to carry one enormous run reported a
 * single line of **531**. 1,024 is about double the worst reading.
 *
 * Together with {@link MAX_TEXT_LAYER_LINES} this bounds one page's layer at
 * 2 MiB of text, which is a ceiling on a **page** rather than a figure that
 * grows with the document — invariant 11's actual requirement. The pages
 * measured above cross about 10 KB.
 */
export const MAX_TEXT_LAYER_LINE = 1024;
