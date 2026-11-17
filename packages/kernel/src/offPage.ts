/**
 * Whether text lies WHOLLY off its page: not part of the page a person sees, so no reader of the page's text offers it
 * and no command that changes text by matching it touches it. It stays in the file untouched, exactly as drawn.
 *
 * ## Why a page can carry text it does not show
 *
 * A converter from HTML to PDF can draw the whole document on every page, shifted, and let the page's edge hide the
 * rest: measured 2026-11-17 on a user's three-page statement (`scripts/research/offPageText.mjs`), PDFium's runs grouped
 * into 270 blocks a page, of which 168, 166 and 185 lay wholly outside the page's box. Edit text offered them, outlined
 * past the page's edge and each warned *no longer fits*, and one block a page joined visible lines to hidden ones.
 *
 * ## The edges, decided (the owner's Fix 2, point 4)
 *
 * - **Wholly outside** the page's box, sharing no area with it: off the page. Left out.
 * - **Partly on it**: on the page. A person sees part of it, and MuPDF's readers keep the glyphs that are on the page.
 * - **Inside the box and hidden by a clip**: on the page, and grouped apart from text drawn through another clip
 *   (ADR-0281). A clip that hides text inside the page is the document drawing its own content, and nothing here can
 *   tell a clip that hides from one that frames without drawing it.
 *
 * ONE RULE for every reader that walks PDFium's runs: main's grouping for Edit text and Translate, and Replace all.
 * MuPDF's readers — Find, word count, the text layer, select and copy, Ask AI's page text — already read no glyph past
 * the page (`FZ_STEXT_CLIP`, MuPDF 1.28.0's default), measured on the same statement: a word drawn only off the page is
 * found 0 times, against a word on it found once.
 *
 * @param run the text's box in PDF user space, as PDFium reads it
 * @param page the page's box in the same space, `null` where PDFium answers none: then nothing is off it
 */
export function liesOffPage(
  run: { readonly left: number; readonly right: number; readonly bottom: number; readonly top: number },
  page: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null,
): boolean {
  if (page === null) return false;
  const left = Math.min(run.left, run.right);
  const right = Math.max(run.left, run.right);
  const bottom = Math.min(run.bottom, run.top);
  const top = Math.max(run.bottom, run.top);
  return right <= page.x0 || left >= page.x1 || top <= page.y0 || bottom >= page.y1;
}
