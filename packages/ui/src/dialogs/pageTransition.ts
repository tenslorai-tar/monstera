import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_TRANSITION_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { PAGE_TRANSITION_RESULT } from './pageTransitionResult.js';

/** The id `pageTransitionCommand` opens to collect a style and a duration. */
export const PAGE_TRANSITION_DIALOG_ID = 'dialog.page-transition';

/**
 * A presentation transition — a style, a duration and a scope.
 *
 * `cropPages`' shape, and the current page travels in for its reason: *this
 * page* and *all pages* are the two scopes worth having, and the first needs to
 * know which page.
 */
export const PAGE_TRANSITION_DIALOG = declareDialog({
  id: PAGE_TRANSITION_DIALOG_ID,
  title: PAGE_TRANSITION_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: PAGE_TRANSITION_RESULT,
  component: lazy(() => import('./PageTransitionBody.js')),
});
