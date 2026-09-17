import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_ANNOTATIONS_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the annotation imports open when a picked file added nothing. */
export const IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID = 'dialog.import-annotations-problem';

/**
 * What a person is told when a comment file added nothing (ADR-0077) — `importFormDataProblem.ts`'
 * two reasons and its argument for listing every cause of `unreadable` rather than guessing one.
 */
export const IMPORT_ANNOTATIONS_PROBLEM_DIALOG = declareDialog({
  id: IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID,
  title: IMPORT_ANNOTATIONS_PROBLEM_TITLE,
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }),
  ]),
  component: lazy(() => import('./ImportAnnotationsProblemBody.js')),
});
