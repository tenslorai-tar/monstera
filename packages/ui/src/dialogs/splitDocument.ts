import { lazy } from 'react';
import { z } from 'zod';

import { SPLIT_DOCUMENT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { SPLIT_DOCUMENT_RESULT } from './splitDocumentResult.js';

/** The id `splitDocumentCommand` opens to choose how the document is split. */
export const SPLIT_DOCUMENT_DIALOG_ID = 'dialog.split-document';

/**
 * How to split: one file per page, or one file per range.
 *
 * ## Both modes answer the same shape, which is why there is no mode field
 *
 * *One per page* is one group per page; *ranges* is one group per range. The
 * body builds the groups and the answer carries them, so nothing downstream
 * needs to know which control the reader used — and the command cannot
 * disagree with the dialog about what a mode means, because it never learns.
 *
 * ## `pageCount` goes IN, as it does for delete and extract
 *
 * Both modes need it: one-per-page to build the groups at all, and ranges to
 * refuse a page the document lacks. Fourth caller of `parsePageRanges`, which
 * the gate row named in advance.
 *
 * ## The FOLDER is picked by main, after this
 *
 * This dialog collects the grouping and nothing about where the files go —
 * that is `PickDirectory`, and it runs main-side for `saveCopy`'s reason. Two
 * dialogs in sequence for one action, in the order that lets a dismissal of the
 * second discard nothing the user had decided.
 */
export const SPLIT_DOCUMENT_DIALOG = declareDialog({
  id: SPLIT_DOCUMENT_DIALOG_ID,
  title: SPLIT_DOCUMENT_TITLE,
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: SPLIT_DOCUMENT_RESULT,
  component: lazy(() => import('./SplitDocumentBody.js')),
});
