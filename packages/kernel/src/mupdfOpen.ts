import * as mupdf from './mupdfRaw.js';

/**
 * Where MuPDF is handed a file: the one rule for a cross-reference chain it stops reading without saying so.
 *
 * ## The fault
 *
 * MuPDF rebuilds a file's objects by scanning it only when reading the chain THROWS. A last section whose `/Prev` names
 * its own offset does not throw: *ignoring xref section recursion* is a warning, the walk stops at that one section, and
 * the document opens holding the handful of objects it lists and no page tree (measured 2026-11-05 on a document a
 * signing service had stamped, whose true previous section was 9,188 bytes earlier: 0 pages, while PDF.js showed all five).
 * Every page read then fails, and the person is told something went wrong inside the application.
 *
 * ## The answer
 *
 * A document with no pages is not a document, so none is the signal. The file is opened again from a copy whose last
 * `startxref` points nowhere, which is the one input MuPDF's own rebuild answers; the digits are zeroed in place, so no
 * offset moves. A file that truly has no pages reads none either way and is answered as it was. The rebuild is asked for
 * only after the password's attempt, because a protected file's page tree may sit in an object stream it cannot yet read.
 */

/** A document and what the password's attempt answered: `0` is refused, and `document` is then the caller's to destroy. */
export interface OpenedPdf {
  readonly document: mupdf.Document;
  readonly access: number;
}

/** A copy of `image` whose last `startxref` points nowhere, or `null` where it has none. */
export function startxrefBroken(image: Uint8Array): Uint8Array | null {
  const keyword = Array.from('startxref', (character) => character.charCodeAt(0));
  for (let at = image.length - keyword.length; at >= 0; at -= 1) {
    if (!keyword.every((byte, offset) => image[at + offset] === byte)) continue;
    const copy = Uint8Array.from(image);
    let digit = at + keyword.length;
    const isSpace = (byte: number | undefined): boolean => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
    while (isSpace(copy[digit])) digit += 1;
    const isDigit = (byte: number | undefined): boolean => byte !== undefined && byte >= 0x30 && byte <= 0x39;
    if (!isDigit(copy[digit])) return null;
    for (; isDigit(copy[digit]); digit += 1) copy[digit] = 0x30;
    return copy;
  }
  return null;
}

function attempt(image: Uint8Array, password: string | undefined): OpenedPdf {
  const document = mupdf.Document.openDocument(image, 'application/pdf');
  // A NON-PDF ANSWERS AS ITS CALLERS ALREADY REFUSE IT, by the document's own type.
  if (!(document instanceof mupdf.PDFDocument)) return { document, access: -1 };
  // THE ONE ATTEMPT on this opening: `mupdfWriter.ts`' reason for never asking `needsPassword`.
  return { document, access: document.authenticatePassword(password ?? '') };
}

/**
 * `image` as a document, with the one attempt at `password`, rebuilt where its chain left it with no pages.
 *
 * @throws what MuPDF throws for bytes it cannot read at all, which is the file's answer and each caller's to word.
 */
export function openPdfFile(image: Uint8Array, password: string | undefined): OpenedPdf {
  const first = attempt(image, password);
  if (first.access <= 0 || first.document.countPages() > 0) return first;
  const broken = startxrefBroken(image);
  if (broken === null) return first;
  let rebuilt: OpenedPdf;
  try {
    rebuilt = attempt(broken, password);
  } catch {
    // THE REBUILD COULD NOT READ IT EITHER: the file as it came is the answer.
    return first;
  }
  if (rebuilt.access <= 0 || rebuilt.document.countPages() === 0) {
    rebuilt.document.destroy();
    return first;
  }
  first.document.destroy();
  return rebuilt;
}
