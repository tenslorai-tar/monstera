import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_FROM_PDF_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { INSERT_FROM_PDF_DRAFT, INSERT_FROM_PDF_RESULT } from './insertFromPdfResult.js';
import { SOURCE_PROPS } from './sourceDocuments.js';

/** The id `insertFromPdfCommand` opens to choose a source, its pages and a position. */
export const INSERT_FROM_PDF_DIALOG_ID = 'dialog.insert-from-pdf';

/**
 * Which document to insert from, which of its pages, and where
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)).
 *
 * ## This is a SECOND SURFACE over `mergeDocument`, not a second command
 *
 * It was written as its own kind first and that was wrong. Merge and insert
 * differ in exactly one value — where the source's pages land — so a second
 * kind would be one operation declared twice, with two grafts to keep in step
 * and two rows in every exhaustive table. `openDocument.ts` states the shape
 * this follows: *"one implementation with two triggers, which is not a second
 * wiring place."* Choosing the source's pages is `sourcePagesSchema`, which both
 * surfaces carry.
 *
 * ## Two frames, and each row says which
 *
 * The source's pages are bounded by the SOURCE's count, which each offered
 * document carries; the position is among the TARGET's pages, bounded by
 * `pageCount`. *After* the last page is a real request — `at: pageCount`.
 */
export const INSERT_FROM_PDF_DIALOG = declareDialog({
  id: INSERT_FROM_PDF_DIALOG_ID,
  title: INSERT_FROM_PDF_TITLE,
  props: z
    .object({
      ...SOURCE_PROPS,
      /** The TARGET's page count, bounding the position. */
      pageCount: z.number().int().positive(),
      /** The page on show in the target, zero-based: the position starts after it. */
      page: z.number().int().nonnegative(),
      /** What the person had entered before *Choose file…*, restored as the dialog reopens. */
      draft: INSERT_FROM_PDF_DRAFT.optional(),
    })
    .strict(),
  result: INSERT_FROM_PDF_RESULT,
  component: lazy(() => import('./InsertFromPdfBody.js')),
});
