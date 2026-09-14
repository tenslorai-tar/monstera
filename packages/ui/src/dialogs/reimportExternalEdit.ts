import { lazy } from 'react';
import { z } from 'zod';

import { REIMPORT_EXTERNAL_EDIT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { REIMPORT_EXTERNAL_EDIT_RESULT } from './reimportExternalEditResult.js';

/** The id the edit-page command opens when the page it sent out was saved elsewhere. */
export const REIMPORT_EXTERNAL_EDIT_DIALOG_ID = 'dialog.reimport-external-edit';

/**
 * The question asked when a page sent to another application was saved there — ADR-0062
 * Decision 5.
 *
 * ## It never comes back on its own
 *
 * The person is asked, and a dismissal keeps waiting. A reimport replaces a page, and doing
 * that whenever an editor saves would replace it mid-edit and after partial saves.
 *
 * ## It names the page
 *
 * The replace destroys that page, so a person must be able to check it is the right one —
 * replace-page's own reason.
 */
export const REIMPORT_EXTERNAL_EDIT_DIALOG = declareDialog({
  id: REIMPORT_EXTERNAL_EDIT_DIALOG_ID,
  title: REIMPORT_EXTERNAL_EDIT_TITLE,
  props: z.object({
    /** The zero-based index of the page that was sent out. */
    page: z.number().int().nonnegative(),
  }),
  result: REIMPORT_EXTERNAL_EDIT_RESULT,
  component: lazy(() => import('./ReimportExternalEditBody.js')),
});
