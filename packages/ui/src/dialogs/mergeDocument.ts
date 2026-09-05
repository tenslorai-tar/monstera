import { lazy } from 'react';
import { z } from 'zod';

import { MERGE_DOCUMENT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { MERGE_DOCUMENT_RESULT } from './mergeDocumentResult.js';

/** The id `mergeDocumentCommand` opens to choose a source document. */
export const MERGE_DOCUMENT_DIALOG_ID = 'dialog.merge-document';

/**
 * Which OPEN document to merge in
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)
 * Decisions 1 and 2).
 *
 * ## The choices travel IN, exactly as `pageCount` does for delete
 *
 * `deletePages.ts`' shape: the surface holding the control needs the data to
 * build it, so the list goes in with the props and an already-chosen `DocId`
 * comes out. The command performs no lookup on what it receives.
 *
 * The list is the shell's — `CommandContext.openDocuments`, which is
 * `App.tsx`'s `tabs`, the same value the compare picker takes. A dialog that
 * fetched the open documents itself would be a second answer to a question the
 * shell already holds.
 *
 * ## Why there is a dialog at all rather than a submenu of documents
 *
 * A projection of the command registry cannot enumerate documents: a command is
 * registered once and its placements are static, so *merge document N* would be
 * a command per open tab, minted and disposed as tabs come and go. That is the
 * hand-maintained second wiring place the registry exists to forbid. ADR-0038's
 * answer — a dialog answers the command that opened it — is the shape that
 * already exists for *a command needs an argument the registry cannot hold*.
 *
 * ## Merging a document into ITSELF is refused by the props, not by the body
 *
 * `choices` arrives already filtered by the command, which holds
 * `context.docId`. `.min(1)` then means *there is something to merge*, so a
 * dialog offering nothing cannot be opened — the command checks first and says
 * so, rather than presenting an empty picker the reader has to interpret.
 */
export const MERGE_DOCUMENT_DIALOG = declareDialog({
  id: MERGE_DOCUMENT_DIALOG_ID,
  title: MERGE_DOCUMENT_TITLE,
  props: z
    .object({
      /** The other open documents, in tab order. Never includes the target. */
      choices: z
        .array(z.object({ docId: z.string().min(1), name: z.string().min(1) }).strict())
        .min(1),
    })
    .strict(),
  result: MERGE_DOCUMENT_RESULT,
  component: lazy(() => import('./MergeDocumentBody.js')),
});
