import { lazy } from 'react';
import { z } from 'zod';

import { READ_ONLY_FILE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id an open asks when the file it opened cannot be saved over. */
export const READ_ONLY_FILE_DIALOG_ID = 'dialog.read-only-file';

/**
 * Why the file cannot be saved over, of the contract's `FILE_ACCESS`: the two answers a person can be told about.
 * `writable` needs no sentence and `absent` is the next save's to say.
 */
export const UNWRITABLE_ACCESS = ['read-only', 'held'] as const;

/** One of {@link UNWRITABLE_ACCESS}. */
export type UnwritableAccess = (typeof UNWRITABLE_ACCESS)[number];

/** The person asked for a copy to work on. A dismissal answers nothing the schema accepts, and ends it (ADR-0038). */
export const READ_ONLY_FILE_RESULT = z.object({ kind: z.literal('save-copy') }).strict();

/**
 * Says, as the document opens, that its file cannot be saved over, and offers a copy to work on (cloud-4 7b) —
 * `cloudViewOnly.ts`' shape for a cloud file the person may only view, said before any edit rather than at the first
 * Save.
 */
export const READ_ONLY_FILE_DIALOG = declareDialog({
  id: READ_ONLY_FILE_DIALOG_ID,
  title: READ_ONLY_FILE_TITLE,
  props: z.object({ access: z.enum(UNWRITABLE_ACCESS) }).strict(),
  result: READ_ONLY_FILE_RESULT,
  component: lazy(() => import('./ReadOnlyFileBody.js')),
});
