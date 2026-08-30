/**
 * The one page this build shows, in **both** numbering schemes.
 *
 * ## Why a constant rather than two literals
 *
 * PDF.js numbers pages from **1**; the document model indexes them from **0**
 * (`commands.ts`: *"Zero-based page indices"*). The renderer holds both, and
 * nothing about either literal looks wrong at its own call site — `renderPage(…,
 * 1, …)` is right and `pages: [1]` is the page after it.
 *
 * That is not hypothetical. The rotate command shipped with `pages: [1]` and a
 * comment reasoning correctly from *"the renderer shows page 1"* to the wrong
 * index, on a build with no page navigation and no view model — so the control
 * rotated the second page of every document and there was nothing on screen
 * that could disagree. It was found by wiring the view model, which made *which
 * page* a question two call sites had to answer the same way.
 *
 * So the correspondence lives in one object where both numbers are visible
 * together, and a reader picking one picks the other's sibling. B5 over a
 * comment: the wrong choice stops being a literal somebody has to check against
 * a paragraph elsewhere.
 *
 * ## What replaces this
 *
 * A current-page concept, when there is page navigation. This is deliberately
 * not that: a `currentPage` with no way to change it would be state pretending
 * to be a feature. The name says what is true — there is one shown page — and
 * the day there are several, every caller of this is the list of places that
 * have to learn which one.
 */
export const SHOWN_PAGE = {
  /** As PDF.js numbers pages: from 1. */
  pdfjs: 1,
  /** As the document model indexes them: from 0. */
  kernel: 0,
} as const;
