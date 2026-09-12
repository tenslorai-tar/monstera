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
 * The same words `document.sign` answers with, so the command forwards the
 * outcome's kind without translating it — a table between two enums that must
 * agree would be a second opinion about what the wire's member names already
 * settle.
 */
export const SIGN_PROBLEMS = [
  'wrong-passphrase',
  'unreadable',
  'unencodable-text',
  'image-unreadable',
  'image-too-large',
] as const;

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
