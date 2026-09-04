import { lazy } from 'react';
import { z } from 'zod';

import { HEADER_FOOTER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { HEADER_FOOTER_RESULT } from './headerFooterResult.js';

/** The id `headerFooterCommand` opens to collect the six slots. */
export const HEADER_FOOTER_DIALOG_ID = 'dialog.header-footer';

/**
 * Headers and footers — six slots, a size, a margin and a scope.
 *
 * `cropPages`' shape, and the current page travels in for its reason: *this
 * page* and *all pages* are the two scopes worth having, and the first needs to
 * know which page.
 */
export const HEADER_FOOTER_DIALOG = declareDialog({
  id: HEADER_FOOTER_DIALOG_ID,
  title: HEADER_FOOTER_TITLE,
  props: z
    .object({
      /** The page being read, zero-based, for the *this page* scope. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: HEADER_FOOTER_RESULT,
  component: lazy(() => import('./HeaderFooterBody.js')),
});
