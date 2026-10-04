import { lazy } from 'react';
import { z } from 'zod';

import { REPLACE_PAGE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { TARGET_PAGES } from './pageScope.js';
import { REPLACE_PAGE_DRAFT, REPLACE_PAGE_RESULT } from './replacePageResult.js';
import { SOURCE_PROPS } from './sourceDocuments.js';

/** The id `replacePageCommand` opens to choose what replaces the pages it was opened on. */
export const REPLACE_PAGE_DIALOG_ID = 'dialog.replace-page';

/**
 * Which document, and which of its pages, replace the pages the command acts on
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)).
 *
 * ## `pages` go IN so the sentence can name them
 *
 * The command holds them — the ticked pages, else the page on show (`targetPages`, ADR-0104) — and the dialog states
 * them rather than asking. A control that silently replaced *some* pages would be the destructive version of the
 * display-only defect: it does something, and the person cannot tell what.
 *
 * ## The source's pages are asked, and start as many as are replaced
 *
 * The dialog opens on as many of the source's first pages as it replaces, so replacing one page from a two-page file
 * keeps the document's length unless the person chooses otherwise. `replacePageSchema` states how the two lists pair.
 */
export const REPLACE_PAGE_DIALOG = declareDialog({
  id: REPLACE_PAGE_DIALOG_ID,
  title: REPLACE_PAGE_TITLE,
  props: z
    .object({
      ...SOURCE_PROPS,
      /** The pages being replaced, zero-based. Shown 1-based. */
      pages: TARGET_PAGES,
      /** What the person had entered before *Choose file…*, restored as the dialog reopens. */
      draft: REPLACE_PAGE_DRAFT.optional(),
    })
    .strict(),
  result: REPLACE_PAGE_RESULT,
  component: lazy(() => import('./ReplacePageBody.js')),
});
