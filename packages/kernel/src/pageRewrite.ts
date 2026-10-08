import type { TextRewrite } from '@monstera/contract';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import { joinedContent, showOperators } from './textOperators.js';

/**
 * Which writer rewrites a page's text ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decision 1): `objects`, PDFium's page objects (`editTextBlock`), or `operators`, the page's own content stream in
 * MuPDF (`editTextOperators`). The contract's set, so the host's answer and the renderer's choice are one type.
 */
export type PageRewrite = TextRewrite;

/**
 * A page needs the operator writer when its own content shows text in a Type 3 font: an operator that shows a code
 * (one PDFium numbers as a text object) while the text state's font names a `/Font` resource of `/Subtype /Type3`.
 * PDFium saves such a page without the text, which its read-back refuses (ADR-0169), so every other page stays with
 * the writer that rewrites its objects.
 *
 * Read by MuPDF, because the PDFium API has no query for a font's type, and through `textOperators.ts`, the module
 * that numbers the operators the edit will name: the page this answers about and the page the edit changes are read
 * by one tokeniser.
 */
export function readPageRewrite(session: MupdfSession, page: number): Promise<PageRewrite> {
  return withDocument(session, (document) => {
    const leaf = document.findPage(page);
    const fonts = pageFonts(leaf);
    const shown = showOperators(joinedContent(pageContentStreams(leaf)));
    const type3 = shown.some(
      (op) => op.object !== null && op.state.font !== null && fonts.get(op.state.font)?.subtype === 'Type3',
    );
    return type3 ? 'operators' : 'objects';
  });
}
