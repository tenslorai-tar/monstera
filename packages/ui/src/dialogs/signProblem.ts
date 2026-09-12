import { lazy } from 'react';
import { z } from 'zod';

import { SIGN_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the signing command opens when nothing was signed. */
export const SIGN_PROBLEM_DIALOG_ID = 'dialog.sign-problem';

/**
 * Why the document was not signed.
 *
 * `INSERT_IMAGE_PROBLEM_DIALOG`'s shape and its argument: a dismissal is the
 * third outcome and opens nothing, because the user did it on purpose. These
 * two they did not — they chose a certificate and got no signature, and a
 * command that returned quietly would be the display-only failure.
 *
 * **Both sentences say nothing has been changed**, which is the fact a person
 * most needs after an operation that was going to alter their document. It is
 * also true: the command throws before the bus applies anything.
 *
 * ## It ANSWERS NOTHING
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038), so
 * this is informational by construction.
 */
export const SIGN_PROBLEM_DIALOG = declareDialog({
  id: SIGN_PROBLEM_DIALOG_ID,
  title: SIGN_PROBLEM_TITLE,
  props: z.object({
    reason: z.enum(['wrong-passphrase', 'unreadable']),
  }),
  component: lazy(() => import('./SignProblemBody.js')),
});
