import { lazy } from 'react';
import { z } from 'zod';

import { MERGE_DOCUMENT_NONE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `mergeDocumentCommand` opens when there is no other document open. */
export const MERGE_DOCUMENT_NONE_DIALOG_ID = 'dialog.merge-document-none';

/**
 * What the user is told when merge has nothing to merge from.
 *
 * ## Why a message and not an absent command
 *
 * `when` decides existence, and hiding merge whenever one document is open
 * would be defensible — except that it makes the feature undiscoverable in
 * exactly the state a reader is in when they want it. Someone with one document
 * open who wants to merge needs to learn that the other file has to be opened
 * first (ADR-0040 Decision 2), and a control that is not there teaches nothing.
 *
 * So the command exists whenever a document does, and this says what to do. It
 * is the same judgement `insertImageProblem.ts` makes: the alternative to a
 * sentence is a control that appears to do nothing.
 *
 * ## Not `dialog.command-problem`
 *
 * That dialog's props are a union of **failure codes** from a channel that
 * refused. Nothing was dispatched here — the command never reached the
 * boundary — so there is no code, and folding a precondition into a union whose
 * readability is that every member is a channel failure would cost that
 * property (`insertImageProblem.ts`' argument, one step earlier in the flow).
 *
 * ## It ANSWERS NOTHING, by construction
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038).
 */
export const MERGE_DOCUMENT_NONE_DIALOG = declareDialog({
  id: MERGE_DOCUMENT_NONE_DIALOG_ID,
  title: MERGE_DOCUMENT_NONE_TITLE,
  props: z.object({}).strict(),
  component: lazy(() => import('./MergeDocumentNoneBody.js')),
});
