import { lazy } from 'react';
import { z } from 'zod';

import { EXTRACT_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { EXTRACT_PAGES_RESULT } from './extractPagesResult.js';

/** The id `extractPagesCommand` opens to collect a range. */
export const EXTRACT_PAGES_DIALOG_ID = 'dialog.extract-pages';

/**
 * Which pages go into the new document.
 *
 * ## `pageCount` goes IN and pages come OUT, exactly as delete has it
 *
 * `deletePages.ts`' shape, and the third caller of `parsePageRanges` — which
 * that row named in advance: *"extract and split need the same one."* It
 * refuses an unreadable part, a backwards range and a page the document lacks
 * rather than dropping them, because reading `5-3` as `3-5` extracts pages
 * nobody named.
 *
 * ## Extracting EVERY page is allowed, where deleting every page is not
 *
 * The difference is what the operation leaves behind. Deleting all of them
 * empties the open document, which is not a PDF a reader opens; extracting all
 * of them writes a copy and leaves the source untouched — which is an odd thing
 * to ask for and not a wrong one. So this dialog carries no *everything*
 * refusal, and its absence is the decision rather than an omission.
 */
export const EXTRACT_PAGES_DIALOG = declareDialog({
  id: EXTRACT_PAGES_DIALOG_ID,
  title: EXTRACT_PAGES_TITLE,
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: EXTRACT_PAGES_RESULT,
  component: lazy(() => import('./ExtractPagesBody.js')),
});
