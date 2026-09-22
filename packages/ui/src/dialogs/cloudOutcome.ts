import { CLOUD_REFUSALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CLOUD_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const CLOUD_OUTCOME_DIALOG_ID = 'dialog.cloud-outcome';

/** What *Save back to cloud* ended in: sent, not a cloud document, not saved here, or refused by name. */
export const CLOUD_OUTCOMES = ['saved-back', 'not-from-cloud', 'save-failed', ...CLOUD_REFUSALS] as const;

export type CloudOutcome = (typeof CLOUD_OUTCOMES)[number];

/**
 * One sentence saying what *Save back* did. Every outcome is said, success included: a save that
 * silently went to the cloud and one that silently did not would look the same.
 */
export const CLOUD_OUTCOME_DIALOG = declareDialog({
  id: CLOUD_OUTCOME_DIALOG_ID,
  title: CLOUD_OUTCOME_TITLE,
  props: z.object({ outcome: z.enum(CLOUD_OUTCOMES) }).strict(),
  component: lazy(() => import('./CloudOutcomeBody.js')),
});
