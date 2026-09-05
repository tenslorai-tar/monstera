import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_FROM_PDF_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { INSERT_FROM_PDF_RESULT } from './insertFromPdfResult.js';

/** The id `insertFromPdfCommand` opens to choose a source and a position. */
export const INSERT_FROM_PDF_DIALOG_ID = 'dialog.insert-from-pdf';

/**
 * Which OPEN document to insert, and where
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)
 * Decision 2 names this row as the one whose extra clicks it costs).
 *
 * ## This is a SECOND SURFACE over `mergeDocument`, not a second command
 *
 * It was written as its own kind first and that was wrong. Merge and insert
 * differ in exactly one value — where the source's pages land — so a second
 * kind would be one operation declared twice, with two grafts to keep in step
 * and two rows in every exhaustive table. `openDocument.ts` states the shape
 * this follows: *"one implementation with two triggers, which is not a second
 * wiring place."*
 *
 * The design that WOULD have earned a kind is *insert selected pages*, because
 * a page list is something merge cannot express. It is not built, and the
 * reason is concrete rather than scope: `OpenDocument` carries no page count
 * for an unfocused tab, so nothing in the renderer can bound a range against
 * the **source**. A range field bounded by the target's length would accept
 * `1-40` against a four-page source whenever the target was long enough, which
 * is the wrong document silently. The row carries that as what is owed.
 *
 * ## `pageCount` goes IN, as `deletePages.ts` has it
 *
 * The bound here is the TARGET's, and that is the one frame this dialog deals
 * in: `at` is a position among the reader's own pages. The source's length is
 * not needed, because every page of it is inserted.
 */
export const INSERT_FROM_PDF_DIALOG = declareDialog({
  id: INSERT_FROM_PDF_DIALOG_ID,
  title: INSERT_FROM_PDF_TITLE,
  props: z
    .object({
      /** The other open documents, in tab order. Never includes the target. */
      choices: z
        .array(z.object({ docId: z.string().min(1), name: z.string().min(1) }).strict())
        .min(1),
      /**
       * The TARGET's page count, bounding the position.
       *
       * `at` may equal it — that is *after the last page*, which is a real
       * request and the one value past the end a caller can legitimately name
       * (`pageOrder.ts` says the same about every insert).
       */
      pageCount: z.number().int().positive(),
    })
    .strict(),
  result: INSERT_FROM_PDF_RESULT,
  component: lazy(() => import('./InsertFromPdfBody.js')),
});
