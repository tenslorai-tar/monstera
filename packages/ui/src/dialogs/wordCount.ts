import { lazy } from 'react';
import { z } from 'zod';

import { WORD_COUNT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const WORD_COUNT_DIALOG_ID = 'dialog.wordCount';

/**
 * What the document adds up to.
 *
 * ## The command counts and the dialog displays, which is `about.ts`' split
 *
 * `DialogRegistry.openWith` validates props at the open call, so the totals are
 * computed before this opens rather than fetched by the body — a body that
 * fetched its own would be validated before it had anything to validate
 * (ADR-0029 Decision 7).
 *
 * ## `pagesCounted` is not decoration
 *
 * A walk that stopped early — a document closed, a lane that refused, a version
 * that moved under it — produces a total that is smaller than the document and
 * looks exactly like a correct total for a shorter document. Carrying how many
 * pages the figures came from is what lets the body say *of 40* and lets a
 * reader see that they are not looking at the whole thing.
 */
export const WORD_COUNT_DIALOG = declareDialog({
  id: WORD_COUNT_DIALOG_ID,
  title: WORD_COUNT_TITLE,
  props: z.object({
    words: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    charactersNoSpaces: z.number().int().nonnegative(),
    /** How many pages contributed, and how many the document has. */
    pagesCounted: z.number().int().nonnegative(),
    pageCount: z.number().int().positive(),
  }),
  // Lazy, per ADR-0029 Decision 7: nothing is loaded until this is opened.
  component: lazy(() => import('./WordCountBody.js')),
});
