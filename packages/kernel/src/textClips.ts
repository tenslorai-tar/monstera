import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { type TextClipRanges, clipRangesOf } from './textClipRanges.js';
import { joinedContent, textObjectClips } from './textOperators.js';

/**
 * Which clip each text object of a page is drawn through, read by the engine host from the page's own content
 * ([ADR-0281](../../../docs/DECISIONS/0281-a-run-carries-the-clip-its-content-draws-it-through.md) Decision 2), for the
 * grouping `main` makes of PDFium's runs. The content's parse and not PDFium's object model, because PDFium drops a clip
 * that holds its object (measured, ADR-0281). The same parse the writer places text by (`clipIdentitiesAt`).
 */
export function readTextClips(session: MupdfSession, page: number): Promise<TextClipRanges> {
  return withDocument(session, (document) => {
    const leaf = document.findPage(page);
    return clipRangesOf(textObjectClips(joinedContent(pageContentStreams(leaf)), xobjectKinds(leaf)));
  });
}
