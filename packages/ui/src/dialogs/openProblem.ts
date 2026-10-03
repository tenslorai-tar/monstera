import { lazy } from 'react';
import { z } from 'zod';

import { OPEN_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { OPEN_PROBLEMS } from './openProblemReasons.js';

/** The id an open asks when it produced no document while one is already on screen. */
export const OPEN_PROBLEM_DIALOG_ID = 'dialog.open-problem';

/**
 * What a person is told when an open did not happen and the start screen, which says it with no document in front,
 * is not on screen.
 */
const openProblemSchema = z.object({ reason: z.enum(OPEN_PROBLEMS) });

/** The props the dialog takes. Inferred from the schema, for `markdownImportProblem.ts`' reason. */
export type OpenProblemProps = z.infer<typeof openProblemSchema>;

export const OPEN_PROBLEM_DIALOG = declareDialog({
  id: OPEN_PROBLEM_DIALOG_ID,
  title: OPEN_PROBLEM_TITLE,
  informs: 'message',
  props: openProblemSchema,
  component: lazy(() => import('./OpenProblemBody.js')),
});
