import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_ANNOTATIONS_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the annotation imports open when a picked file added nothing. */
export const IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID = 'dialog.import-annotations-problem';

/**
 * A container that cannot be read, or exceeds the read's byte bound (ADR-0223).
 * Empty files and unusable records have their own precise import result.
 */
export const IMPORT_ANNOTATIONS_PROBLEM_DIALOG = declareDialog({
  id: IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID,
  title: IMPORT_ANNOTATIONS_PROBLEM_TITLE,
  informs: 'message',
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }),
  ]),
  component: lazy(() => import('./ImportAnnotationsProblemBody.js')),
});
