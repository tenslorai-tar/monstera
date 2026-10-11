import type { PDFDocument, PDFPage } from '@cantoo/pdf-lib';

/**
 * The page a pdf-lib command names, or a named refusal.
 *
 * `applyWatermarkPages`' shape and its wording, because a page index out of range is one refusal whatever the command
 * does with the page. Its own module so the field writers (`formFieldCreate.ts`, `formFieldEdit.ts`) both take it without
 * either importing the other for it.
 */
export function pageAt(document: PDFDocument, index: number): PDFPage {
  const pages = document.getPages();
  const page = pages[index];
  if (!Number.isInteger(index) || index < 0 || page === undefined) {
    throw new RangeError(
      `Page ${String(index)} is outside this document, which has ${String(pages.length)} ` +
        'page(s). Page indices are zero-based.',
    );
  }
  return page;
}
