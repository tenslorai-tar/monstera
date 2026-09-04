import { lazy } from 'react';
import { z } from 'zod';

import { BATES_NUMBER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { BATES_NUMBER_RESULT } from './batesNumberResult.js';

/** The id `batesNumberCommand` opens to collect the identifier and its placement. */
export const BATES_NUMBER_DIALOG_ID = 'dialog.bates-number';

/**
 * Bates numbering — a prefix, a start, a width, a suffix and a placement.
 *
 * `cropPages`' shape, and the current page travels in for its reason.
 */
export const BATES_NUMBER_DIALOG = declareDialog({
  id: BATES_NUMBER_DIALOG_ID,
  title: BATES_NUMBER_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: BATES_NUMBER_RESULT,
  component: lazy(() => import('./BatesNumberBody.js')),
});
