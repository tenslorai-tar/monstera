import { lazy } from 'react';
import { z } from 'zod';

import { EXTERNAL_EDIT_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { EXTERNAL_EDIT_PROBLEMS } from './externalEditProblemReasons.js';

/** The id the edit-page command opens when a page could not go out or come back. */
export const EXTERNAL_EDIT_PROBLEM_DIALOG_ID = 'dialog.external-edit-problem';

/**
 * What the person is told when a page did not go out to another application, or did not
 * come back — ADR-0062.
 *
 * ## Every reason has its own sentence, and none is silent
 *
 * `insertImageProblem.ts`' rule: each is a result of something the person chose, and a
 * command that returned quietly would be a control that ran and appeared to do nothing.
 *
 * ## It ANSWERS NOTHING
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038), so this is
 * informational by construction.
 */
export const EXTERNAL_EDIT_PROBLEM_DIALOG = declareDialog({
  id: EXTERNAL_EDIT_PROBLEM_DIALOG_ID,
  title: EXTERNAL_EDIT_PROBLEM_TITLE,
  props: z.object({ reason: z.enum(EXTERNAL_EDIT_PROBLEMS) }),
  component: lazy(() => import('./ExternalEditProblemBody.js')),
});
