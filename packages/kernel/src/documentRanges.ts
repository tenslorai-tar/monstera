import type { DocId, DocVersion } from '@monstera/shared';

import type { DocumentService, RangeOutcome, RangeReader } from './documentService.js';

/**
 * The renderer's byte-range read path.
 *
 * ARCHITECTURE §2: the renderer receives no document bytes until it asks, holds
 * the document's byte **length**, and reads ranges bound to one `DocVersion`
 * ([ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
 * This module is the whole of main's side of that, and it exists as a module
 * rather than as a line in the handler for one reason: the capability below has
 * to be minted somewhere private, and *"somewhere private"* is what a module is.
 */

/**
 * The one {@link RangeReader} in existence, minted module-privately.
 *
 * The same single line `savePipeline.ts` uses for `SaveWriter` and the
 * supervisor's module uses for `EngineSupervisor`. It is what makes *"these
 * bytes went to the renderer"* a claim this path makes rather than one any
 * holder of a `DocumentService` can make.
 */
const RANGE_READER = 'range-reader' as RangeReader;

/**
 * Reads one range of an open document at a known version.
 *
 * A pass-through, deliberately: the decision it carries is **which module holds
 * the capability**, and adding logic here would put a second opinion about
 * ranges beside the service's (B3a). The service refuses an out-of-document
 * range and reports a moved version; this says who is allowed to ask.
 *
 * @throws DocumentNotOpenError when the document is closed or was never open.
 * @throws RangeError when the range falls outside the document at `expected`.
 */
export function readDocumentRange(
  documents: DocumentService,
  docId: DocId,
  expected: DocVersion,
  begin: number,
  end: number,
): RangeOutcome {
  return documents.readRange(RANGE_READER, docId, expected, begin, end);
}
