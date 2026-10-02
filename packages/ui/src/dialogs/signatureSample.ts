import { lazy } from 'react';
import { z } from 'zod';

import { SAMPLE_SIGNATURE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

// SAMPLE (item 10, never committed): the plain Signature dialog, declared only so a screenshot can open it.
export const SIGNATURE_SAMPLE_DIALOG_ID = 'dialog.signature-sample';

export const SIGNATURE_SAMPLE_RESULT = z.object({ look: z.enum(['drawn', 'typed', 'picture']) }).strict();

export type SignatureSampleAnswer = z.infer<typeof SIGNATURE_SAMPLE_RESULT>;

export const SIGNATURE_SAMPLE_DIALOG = declareDialog({
  id: SIGNATURE_SAMPLE_DIALOG_ID,
  title: SAMPLE_SIGNATURE_TITLE,
  props: z.object({}).strict(),
  result: SIGNATURE_SAMPLE_RESULT,
  component: lazy(() => import('./SignatureSampleBody.js')),
});
