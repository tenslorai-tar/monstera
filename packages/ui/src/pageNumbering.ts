/**
 * The one statement of how PDF.js numbers pages and how the document model
 * indexes them.
 *
 * ## Why this exists, and what it cost before it did
 *
 * PDF.js numbers pages from **1**; the document model indexes them from **0**
 * (`commands.ts`: *"Zero-based page indices"*). The renderer holds both, and
 * nothing about either literal looks wrong at its own call site —
 * `renderPage(…, 1, …)` is right and `pages: [1]` is the page after it.
 *
 * The rotate command shipped with `pages: [1]` and a comment reasoning correctly
 * from *"the renderer shows page 1"* to the wrong index, on a build with no page
 * navigation and no view model — so the control rotated the second page of every
 * document and there was nothing on screen that could disagree.
 *
 * ## This replaces `SHOWN_PAGE`, which was a constant because there was one page
 *
 * `SHOWN_PAGE` held both numbers for the single page this build drew, and its
 * own header named its successor: *"A current-page concept, when there is page
 * navigation… the day there are several, every caller of this is the list of
 * places that have to learn which one."* Continuous scroll is that day.
 *
 * What survives the change is the property that mattered: **the correspondence
 * is stated once**, so a wrong pair is a visible edit here rather than two
 * literals in different files that never meet. What changes is that the page is
 * now a value threaded through `CommandContext` rather than a constant.
 */

/**
 * The document model's index for a page PDF.js calls `pdfjs`.
 *
 * @param pdfjs a 1-based page number, as PDF.js and every user-facing surface
 *   count them
 */
export function kernelPageOf(pdfjs: number): number {
  return pdfjs - 1;
}

/**
 * The number PDF.js calls the page the document model indexes at `kernel`.
 *
 * @param kernel a zero-based index, as `commands.ts` declares them
 */
export function pdfjsPageOf(kernel: number): number {
  return kernel + 1;
}

/**
 * The first page, in both schemes, for a caller with no current page yet.
 *
 * A named value rather than `0` and `1` written at a call site: an opening
 * document has no current page and every surface has to start somewhere, which
 * is the one place the old constant's job survives intact.
 */
export const FIRST_PAGE = { kernel: 0, pdfjs: 1 } as const;
