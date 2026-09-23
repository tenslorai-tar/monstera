import { CLOUD_REFUSALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CLOUD_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const CLOUD_OUTCOME_DIALOG_ID = 'dialog.cloud-outcome';

/** What *Save back to cloud* ended in when it did not send: not a cloud document, not saved here, or refused by name. */
export const CLOUD_OUTCOMES = ['not-from-cloud', 'save-failed', ...CLOUD_REFUSALS] as const;

export type CloudOutcome = (typeof CLOUD_OUTCOMES)[number];

/**
 * Says why *Save back* did not send. Every outcome is said: a save that silently went to the cloud
 * and one that silently did not would look the same.
 *
 * ## Success is not an outcome here
 *
 * A save-back that landed is confirmed by a toast, as every save is: a dialog on the successful
 * path has to be dismissed before the person can carry on, for news that needs no answer. What
 * stays here is what the person may have to act on.
 */
export const CLOUD_OUTCOME_DIALOG = declareDialog({
  id: CLOUD_OUTCOME_DIALOG_ID,
  title: CLOUD_OUTCOME_TITLE,
  props: z.object({ outcome: z.enum(CLOUD_OUTCOMES) }).strict(),
  component: lazy(() => import('./CloudOutcomeBody.js')),
});
