import { lazy } from 'react';
import { z } from 'zod';

import { SIGN_AGAIN_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a signing opens when the document it is about to sign already carries signatures. */
export const SIGN_AGAIN_DIALOG_ID = 'dialog.sign-again';

/** The one answer that goes ahead. Cancelling is the dismissal, so the platform's × and Escape never sign. */
export const SIGN_AGAIN_RESULT = z.literal('continue');

export type SignAgainAnswer = z.infer<typeof SIGN_AGAIN_RESULT>;

/**
 * A plain notice before a second signature
 * ([ADR-0149](../../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md): a new
 * signature is APPENDED, so the earlier ones keep verifying): what will happen, and Continue or Cancel. Opened by `signDocument`
 * once, before the signing dialog, for a document whose signature read found at least one — or one it could not parse, in
 * which case the count is 0 and the sentence says so.
 */
export const SIGN_AGAIN_DIALOG = declareDialog({
  id: SIGN_AGAIN_DIALOG_ID,
  title: SIGN_AGAIN_TITLE,
  props: z.object({ count: z.number().int().nonnegative(), unreadable: z.boolean() }).strict(),
  result: SIGN_AGAIN_RESULT,
  component: lazy(() => import('./SignAgainBody.js')),
});
