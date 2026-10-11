import type { FormFieldHandle } from '@monstera/contract';

import { loadEditFaces } from './editFaces.js';
import type { ByteImage, PreReadValue } from './engineSeam.js';
import { redrawFamily } from './fieldWidgets.js';
import { changesLook } from './formFieldEdit.js';
import type { PDFDocument } from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { type PdfLibCommand, applyPdfLibImage } from './pdfLibWriter.js';

/**
 * pdf-lib's command, then a field in a real family drawn again
 * ([ADR-0229](../../../docs/DECISIONS/0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md) Decision 3).
 *
 * pdf-lib redraws a field it edits in a standard face: a field carrying `/MonsteraFamily` would show Helvetica until its
 * next fill. So an edit that changes a field's look is followed, in the same process and the same command, by MuPDF's
 * redraw of the fields it named, whose finishing step draws a marked field's value in its family (`fieldFaces.ts`).
 *
 * ## Why the result is opened, not searched
 *
 * A pdf-lib save may write the field into a compressed object stream, where the marker's name is not in the bytes: a
 * search would miss it and leave Helvetica drawn, silently. So the result is opened, and saved again only where a field
 * the command named carries the marker; an edit of an unmarked field answers pdf-lib's bytes as they were.
 *
 * ONE composed function, which the MuPDF host and the in-process engine both run, so a test and the product take the same
 * route (B3a).
 */
export async function applyPdfLibWithFaces(image: ByteImage, command: PdfLibCommand, reads: PreReadValue | undefined): Promise<ByteImage> {
  const result = await applyPdfLibImage(image, command, reads);
  if (command.kind !== 'editFormFields') return result;
  const named = command.edits.filter((edit) => changesLook(edit.set)).map((edit) => edit.field);
  if (named.length === 0) return result;
  // THE CATALOGUE THE FAMILY IS DRAWN FROM, made ready where every MuPDF command makes it ready (`localMupdfExecution`): a
  // host binds it by its folders and loads it on first use, and a redraw is synchronous.
  await loadEditFaces();
  const session = await mupdfWriter.open(result);
  try {
    const redrew = await withDocument(session, (document) => redrawMarked(document, named));
    return redrew ? await mupdfWriter.serialise(session) : result;
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Redraws every widget of each named field that carries the family, and answers whether any was. */
function redrawMarked(document: PDFDocument, named: readonly FormFieldHandle[]): boolean {
  let redrew = false;
  for (const handle of named) {
    if (handle.page >= document.countPages()) continue;
    const widget = document.loadPage(handle.page).getWidgets()[handle.index];
    if (widget !== undefined && redrawFamily(document, widget)) redrew = true;
  }
  return redrew;
}
