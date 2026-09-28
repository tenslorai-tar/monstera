import { MAX_SIGNATURES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURE_BREAK_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a save opens when it would break the document's signatures. */
export const SIGNATURE_BREAK_DIALOG_ID = 'dialog.signature-break';

/**
 * The answer that lets the save go ahead. One member: *Save anyway*. Keeping the signatures is the dismissal, so the
 * platform's × and Escape are never the destructive answer.
 */
export const SIGNATURE_BREAK_RESULT = z.object({ save: z.literal(true) }).strict();

/**
 * Part F's *warn before a signature-breaking save* (`BUILD-PROMPT.md`:618): shown when main answers that this save
 * would rewrite the file — a redaction, a flatten or a new password is waiting to be saved — and so break this many
 * signatures. Opened by `saveDocument` only while `saving.warn-signature-break` is on.
 */
export const SIGNATURE_BREAK_DIALOG = declareDialog({
  id: SIGNATURE_BREAK_DIALOG_ID,
  title: SIGNATURE_BREAK_TITLE,
  props: z.object({ signatures: z.number().int().positive().max(MAX_SIGNATURES) }).strict(),
  result: SIGNATURE_BREAK_RESULT,
  component: lazy(() => import('./SignatureBreakBody.js')),
});
