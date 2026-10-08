import type { OcrLanguages } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { openingLanguages } from '../dialogs/ocr.js';
import type { RecognisedWalk } from '../dialogs/ocrOutcome.js';
import { recogniseScope } from './recogniseText.js';

/**
 * Recognises the scanned pages among `pages`, for the editable PowerPoint export
 * ([ADR-0210](../../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)
 * Decision 7).
 *
 * **{@link recogniseScope}, called and not copied**: the same pages-that-need-it test, the same one command per page, the
 * same progress and cancel, with Tesseract and no setting. The words it adds are in the open document, undoable page by
 * page, and the PowerPoint dialog says so before anyone chooses. The languages are the ones the OCR dialog opens on.
 *
 * Unlike `recogniseBeforeExport` this is NOT conditional on *Recognise scanned pages when exporting*: choosing Editable is
 * the consent, and the dialog's note is the disclosure. It is also over the CHOSEN pages only, where that one walks the
 * whole document.
 *
 * Answers `'no-model'` where this computer has no recognition language, so the export goes ahead and the pages that were
 * scans are written as pictures and named.
 */
export async function recognisePagesForExport(
  deps: Parameters<typeof recogniseScope>[0] & { readonly ocrLanguages: () => OcrLanguages },
  docId: DocId,
  pages: readonly number[],
): Promise<RecognisedWalk | 'no-model'> {
  const models = await deps.client['app.ocrLanguages']({});
  if (!models.ok) return 'no-model';
  const languages = openingLanguages(deps.ocrLanguages(), models.value.languages);
  if (languages === undefined) return 'no-model';
  return await recogniseScope(deps, docId, pages, languages);
}
