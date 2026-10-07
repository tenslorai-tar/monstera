import { MAX_TOC_ENTRIES, tocEntrySchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { GENERATE_TOC_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `generateTocCommand` opens to let a person review the contents before it is written. */
export const GENERATE_TOC_DIALOG_ID = 'dialog.generate-toc';

/**
 * What the dialog answers: the rows the person left, in their order, zero-based by page — the command's own shape — or
 * NO `entries`, which is *write the document's own outline as it stands* (an outline too long to be edited here).
 */
export const GENERATE_TOC_RESULT = z.object({ entries: z.array(tocEntrySchema).min(1).max(MAX_TOC_ENTRIES).optional() }).strict();

export type GenerateTocAnswer = z.infer<typeof GENERATE_TOC_RESULT>;

/**
 * The contents page, reviewed before it is written
 * ([ADR-0197](../../../../docs/DECISIONS/0197-a-contents-page-is-written-from-the-list-the-person-reviewed.md)).
 *
 * ## The rows come IN as the document's outline reads, and go OUT as the person left them
 *
 * `entries` are the bookmarks the table would have used (title, page from zero, depth), and the answer is the same shape, so
 * the command sends them as they are. A document with no bookmarks opens with no rows and says so: the person may add
 * entries, because a document is never refused for lacking them. **An outline longer than a writer's channel can carry
 * (`MAX_TOC_ENTRIES`, or a title past `MAX_TOC_TITLE_CHARACTERS`) is NOT refused either**: `tooLong` says it cannot be edited
 * here, no rows are listed, and *Insert* answers nothing so the page is written from the bookmarks as they are.
 */
export const GENERATE_TOC_DIALOG = declareDialog({
  id: GENERATE_TOC_DIALOG_ID,
  title: GENERATE_TOC_TITLE,
  props: z
    .object({
      entries: z.array(tocEntrySchema).max(MAX_TOC_ENTRIES),
      /** How many pages the document has, which bounds a typed page. */
      pageCount: z.number().int().positive(),
      /** Whether the outline is past what can be reviewed here, so `entries` is empty and *Insert* writes it as it is. */
      tooLong: z.boolean(),
    })
    .strict(),
  result: GENERATE_TOC_RESULT,
  component: lazy(() => import('./GenerateTocBody.js')),
});
