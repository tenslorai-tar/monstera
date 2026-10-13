import { lazy } from 'react';
import { z } from 'zod';

import { STRAIGHTEN_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `deskewPagesCommand` opens when it has finished. */
export const STRAIGHTEN_OUTCOME_DIALOG_ID = 'dialog.straighten-outcome';

/**
 * What Straighten did, counted from each page's own read before the write (`document.pageAdjustment`, the owner's
 * N3). A document whose pages are all level changes nothing, and that is the outcome a person cannot see, so it is
 * said rather than left silent.
 */
export const STRAIGHTEN_OUTCOME_DIALOG = declareDialog({
  id: STRAIGHTEN_OUTCOME_DIALOG_ID,
  title: STRAIGHTEN_OUTCOME_TITLE,
  informs: 'message',
  props: z
    .object({
      /** How many pages were measured: every page of the document. */
      pages: z.number().int().positive(),
      /** How many of them were turned straight. */
      straightened: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./StraightenOutcomeBody.js')),
});
