import { PDF_SANITIZE_PARTS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SANITIZE_DOCUMENT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's sanitize command opens. */
export const SANITIZE_DOCUMENT_DIALOG_ID = 'dialog.sanitize-document';

/**
 * What a sanitise takes out.
 *
 * ## A LIST, and it opens with everything ticked
 *
 * *Sanitize* is four different removals, and a person may want three of them:
 * removing embedded files without making the form unfillable is a real thing to
 * want. A boolean would make one choice for all four and put the reason in a
 * tooltip.
 *
 * Everything is ticked to begin with because that is what the command's name
 * promises. What a cleared box means is *leave this in*, which is a decision a
 * person takes rather than one the default takes for them — the opposite of the
 * protection dialog's permissions, where the default grants and a tick withholds.
 *
 * **Empty is refused**, by this schema and by the command's: a sanitise that
 * removes nothing reports success for doing nothing, and still takes a
 * checkpoint and bumps the version.
 */
export const SANITIZE_DOCUMENT_RESULT = z
  .object({
    parts: z.array(z.enum(PDF_SANITIZE_PARTS)).min(1).max(PDF_SANITIZE_PARTS.length),
  })
  .strict();

/** What the sanitize dialog answers with. */
export type SanitizeDocumentAnswer = z.infer<typeof SANITIZE_DOCUMENT_RESULT>;

export const SANITIZE_DOCUMENT_DIALOG = declareDialog({
  id: SANITIZE_DOCUMENT_DIALOG_ID,
  title: SANITIZE_DOCUMENT_TITLE,
  props: z.object({}).strict(),
  result: SANITIZE_DOCUMENT_RESULT,
  component: lazy(() => import('./SanitizeDocumentBody.js')),
});
