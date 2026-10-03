import { lazy } from 'react';
import { z } from 'zod';

import { SIGNED_EDIT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the one dispatcher opens when main answers that an edit would break the document's signatures. */
export const SIGNED_EDIT_DIALOG_ID = 'dialog.signed-edit';

/**
 * The two ways forward. Leaving the document unchanged is the dismissal, so the platform's × and Escape are never the
 * answer that breaks a signature.
 */
export const SIGNED_EDIT_RESULT = z.enum(['copy', 'this']);

export type SignedEditAnswer = z.infer<typeof SIGNED_EDIT_RESULT>;

/**
 * Asked BEFORE an edit that would rewrite a signed document whole — a PDFium edit, or a removal
 * ([ADR-0149](../../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)
 * Decisions 3 and 4). Nothing has changed when it opens: main refused the edit and holds the document as it was.
 *
 * No count, unlike the save's `dialog.signature-break`: the refusal is a failure code, and a sentence that is right for
 * one signature and for several needs none.
 */
export const SIGNED_EDIT_DIALOG = declareDialog({
  id: SIGNED_EDIT_DIALOG_ID,
  title: SIGNED_EDIT_TITLE,
  props: z.object({}).strict(),
  result: SIGNED_EDIT_RESULT,
  component: lazy(() => import('./SignedEditBody.js')),
});
