import type { MessageKey } from '@monstera/shared';
import { lazy } from 'react';
import { z } from 'zod';

import {
  PENDING_REDACTIONS_TITLE,
  PENDING_REDACTIONS_WITHOUT_CLOSE,
  PENDING_REDACTIONS_WITHOUT_EXPORT,
  PENDING_REDACTIONS_WITHOUT_PRINT,
  PENDING_REDACTIONS_WITHOUT_SAVE,
  PENDING_REDACTIONS_WITHOUT_SEND,
} from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a save, a close or an export opens while the document carries redaction marks nobody has applied. */
export const PENDING_REDACTIONS_DIALOG_ID = 'dialog.pending-redactions';

/**
 * What a person was doing when they were asked, which is what the middle answer goes ahead with.
 *
 * The owner's item N1 names three — saving, closing, exporting — and two more are the same act under another verb:
 * a print puts the pages on paper and an email or DocuSign hands the file to somebody else. *Export without applying*
 * on a Print button would be a label that needs the question read to be understood.
 */
export const PENDING_REDACTION_OCCASIONS = ['save', 'close', 'export', 'print', 'send'] as const;
export type PendingRedactionOccasion = (typeof PENDING_REDACTION_OCCASIONS)[number];

/** Each occasion's middle answer, exhaustive so an occasion added above is a compile error here until it is worded. */
export const PENDING_REDACTIONS_WITHOUT: Readonly<Record<PendingRedactionOccasion, MessageKey>> = {
  save: PENDING_REDACTIONS_WITHOUT_SAVE,
  close: PENDING_REDACTIONS_WITHOUT_CLOSE,
  export: PENDING_REDACTIONS_WITHOUT_EXPORT,
  print: PENDING_REDACTIONS_WITHOUT_PRINT,
  send: PENDING_REDACTIONS_WITHOUT_SEND,
};

/**
 * The two answers that go ahead. *Cancel* is the dismissal — the footer's Cancel, the header's × or Escape — so the
 * platform's own way out never applies anything and never lets the action proceed.
 */
export const PENDING_REDACTIONS_RESULT = z.enum(['apply', 'without']);
export type PendingRedactionsAnswer = z.infer<typeof PENDING_REDACTIONS_RESULT>;

export const PENDING_REDACTIONS_DIALOG = declareDialog({
  id: PENDING_REDACTIONS_DIALOG_ID,
  title: PENDING_REDACTIONS_TITLE,
  props: z
    .object({
      /** How many Redact marks the document carries, from `document.annotations` — never zero, which asks nothing. */
      count: z.number().int().positive(),
      occasion: z.enum(PENDING_REDACTION_OCCASIONS),
    })
    .strict(),
  result: PENDING_REDACTIONS_RESULT,
  component: lazy(() => import('./PendingRedactionsBody.js')),
});
