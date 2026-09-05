import { lazy } from 'react';
import { z } from 'zod';

import { REPLACE_PAGE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { REPLACE_PAGE_RESULT } from './replacePageResult.js';

/** The id `replacePageCommand` opens to choose what replaces the page shown. */
export const REPLACE_PAGE_DIALOG_ID = 'dialog.replace-page';

/**
 * Which OPEN document replaces the page on screen
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)).
 *
 * ## Its own entry, sharing merge's body shape but not its title
 *
 * The props and result happen to match `mergeDocument`'s today, and the entries
 * are still separate — a dialog's **title** is what tells a reader what is
 * about to happen to their document, and *Merge a document* over a control that
 * destroys a page would be a lie the schema cannot catch. The picker itself is
 * shared (`DocumentChoiceSelect`), which is the part that is genuinely one
 * thing.
 *
 * ## `page` goes IN so the sentence can name it
 *
 * The command holds the page — it is the one on screen — and the dialog states
 * it rather than asking. A control that silently replaced *some* page would be
 * the destructive version of the display-only defect: it does something, and
 * the user cannot tell what.
 */
export const REPLACE_PAGE_DIALOG = declareDialog({
  id: REPLACE_PAGE_DIALOG_ID,
  title: REPLACE_PAGE_TITLE,
  props: z
    .object({
      /** The other open documents, in tab order. Never includes the target. */
      choices: z
        .array(z.object({ docId: z.string().min(1), name: z.string().min(1) }).strict())
        .min(1),
      /** The page being replaced, zero-based. Shown 1-based. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: REPLACE_PAGE_RESULT,
  component: lazy(() => import('./ReplacePageBody.js')),
});
