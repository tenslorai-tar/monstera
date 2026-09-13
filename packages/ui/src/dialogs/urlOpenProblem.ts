import { URL_FETCH_REFUSALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { URL_OPEN_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Open from web address* opens when the address produced no document. */
export const URL_OPEN_PROBLEM_DIALOG_ID = 'dialog.url-open-problem';

/**
 * What a person is told when a web address did not become an open document.
 *
 * `markdownImportProblem.ts`' shape. The guard's reasons are the contract's list, taken
 * rather than restated, so a reason the guard gains is one this dialog accepts and its
 * body must word. `absent` and `at-capacity` are here because the PDF WAS written.
 */
const urlOpenProblemSchema = z.union([
  z.object({ reason: z.enum(URL_FETCH_REFUSALS) }),
  z.object({ reason: z.literal('destination-contested'), openElsewhere: z.number().int().positive() }),
  z.object({ reason: z.literal('write-failed') }),
  z.object({ reason: z.literal('absent') }),
  z.object({ reason: z.literal('at-capacity') }),
]);

/** The props the dialog takes. Inferred from the schema, for `markdownImportProblem.ts`' reason. */
export type UrlOpenProblem = z.infer<typeof urlOpenProblemSchema>;

export const URL_OPEN_PROBLEM_DIALOG = declareDialog({
  id: URL_OPEN_PROBLEM_DIALOG_ID,
  title: URL_OPEN_PROBLEM_TITLE,
  props: urlOpenProblemSchema,
  component: lazy(() => import('./UrlOpenProblemBody.js')),
});
