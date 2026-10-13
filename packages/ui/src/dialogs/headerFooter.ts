import { listedFontFamiliesSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { HEADER_FOOTER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { HEADER_FOOTER_RESULT } from './headerFooterResult.js';
import { TARGET_PAGES } from './pageScope.js';

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
      /** The command's `targetPages`, for the scope's first choice (ADR-0104). */
      pages: TARGET_PAGES,
      /** The fonts `app.fontFamilies` answered when the dialog opened; absent where the read failed (ADR-0235). */
      fonts: listedFontFamiliesSchema.optional(),
    })
    .strict(),
  result: HEADER_FOOTER_RESULT,
  component: lazy(() => import('./HeaderFooterBody.js')),
});
