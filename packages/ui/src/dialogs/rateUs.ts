import { lazy } from 'react';
import { z } from 'zod';

import { RATE_US_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const RATE_US_DIALOG_ID = 'dialog.rate-us';

/**
 * What the dialog answers with: `open` goes to the Store's review page, `later` leaves everything as it was.
 *
 * Dismissal — the × and Escape — settles the promise `undefined`, which the command treats exactly as `later`, so the
 * platform's dismissal and the visible *Not now* are one answer (the Donate dialog's rule, for its reason).
 */
export const RATE_US_RESULT = z.enum(['open', 'later']);

export type RateUsAnswer = z.infer<typeof RATE_US_RESULT>;

/**
 * *Rate Monstera* — what *Rate Us* opens instead of the Store (the owner's order, 2026-10-07).
 *
 * A button in the window's top row that threw the Store open on one click is the behaviour *Donate* already declined
 * for the same reason: the dialog says where a press is about to send you, and *Not now* is a real answer. It takes no
 * props, and `.strict()` so a caller that starts passing something is refused at the open call.
 */
export const RATE_US_DIALOG = declareDialog({
  id: RATE_US_DIALOG_ID,
  title: RATE_US_TITLE,
  props: z.object({}).strict(),
  result: RATE_US_RESULT,
  component: lazy(() => import('./RateUsBody.js')),
});
