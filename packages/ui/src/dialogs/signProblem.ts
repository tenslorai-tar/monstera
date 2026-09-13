import { SIGN_REFUSALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGN_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the signing command opens when nothing was signed. */
export const SIGN_PROBLEM_DIALOG_ID = 'dialog.sign-problem';

/**
 * Every way a signing attempt ends without a signature that is not a person's
 * own cancel.
 *
 * **THE CONTRACT'S LIST, not a copy of it.** The command forwards the outcome's
 * kind without translating it, so the dialog's reasons must be exactly the
 * channel's refusals. This was a literal array under a comment saying the two
 * were *the same words*, and nothing compared them: `ask` takes `unknown` props,
 * so a refusal the channel gained and this copy lacked compiled cleanly and
 * failed its parse only when a person met it.
 */
export const SIGN_PROBLEMS = SIGN_REFUSALS;

/**
 * Why the document was not signed.
 *
 * `INSERT_IMAGE_PROBLEM_DIALOG`'s shape and its argument: a dismissal is the
 * other outcome and opens nothing, because the user did it on purpose. These
 * they did not — they chose a certificate or a picture and got no signature,
 * and a command that returned quietly would be the display-only failure.
 *
 * **Every sentence says nothing has been changed**, which is the fact a person
 * most needs after an operation that was going to alter their document. It is
 * also true: each refusal happens before the bus applies anything — the picture
 * before the certificate is even asked for, and the text and the credential
 * inside the apply, which throws before it returns bytes.
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
    reason: z.enum(SIGN_PROBLEMS),
  }),
  component: lazy(() => import('./SignProblemBody.js')),
});
