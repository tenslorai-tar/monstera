import { lazy } from 'react';
import { z } from 'zod';

import { UNSEALED_COPIES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const UNSEALED_COPIES_DIALOG_ID = 'dialog.unsealed-copies';

/**
 * The older copies a protect could not encrypt, by name
 * ([ADR-0178](../../../../docs/DECISIONS/0178-a-protect-that-applied-is-not-failed-by-a-copy-it-could-not-seal.md)).
 *
 * A protect that applied is NOT failed by a copy another program holds, or one that cannot be written now: the
 * protection is set and the document saves encrypted. This window is the person being told — never silent (invariant
 * 18) — that those older copies may still hold the document as it was, so they can close the holder and protect again
 * to finish. It `informs`, like the boxed-characters window: the change happened and this is its caveat, not a
 * question that gates a command.
 *
 * Its own window rather than a reason of the save-problem one, whose title says a save did not write: this protect
 * DID apply, and the caveat is about copies beside the document, not the document itself.
 */
export const unsealedCopiesSchema = z.object({ copies: z.array(z.string()).min(1) }).strict();

export type UnsealedCopies = z.infer<typeof unsealedCopiesSchema>;

export const UNSEALED_COPIES_DIALOG = declareDialog({
  id: UNSEALED_COPIES_DIALOG_ID,
  title: UNSEALED_COPIES_TITLE,
  informs: 'message',
  props: unsealedCopiesSchema,
  component: lazy(() => import('./UnsealedCopiesBody.js')),
});
