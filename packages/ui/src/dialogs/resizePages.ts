import { lazy } from 'react';
import { z } from 'zod';

import { RESIZE_PAGES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { RESIZE_PAGES_RESULT } from './resizePagesResult.js';

/** The id `resizePagesCommand` opens to collect a target size. */
export const RESIZE_PAGES_DIALOG_ID = 'dialog.resize-pages';

/**
 * A target page size — two numbers and a scope.
 *
 * `cropPages`' shape, and the current page travels in for its reason: *this
 * page* and *all pages* are the two scopes worth having, and the first needs to
 * know which page.
 */
export const RESIZE_PAGES_DIALOG = declareDialog({
  id: RESIZE_PAGES_DIALOG_ID,
  title: RESIZE_PAGES_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: RESIZE_PAGES_RESULT,
  component: lazy(() => import('./ResizePagesBody.js')),
});
