import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURE_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the plain Signature opens when nothing was placed (ADR-0133). */
export const SIGNATURE_PROBLEM_DIALOG_ID = 'dialog.signature-problem';

/**
 * Why a plain signature was not placed: `document.placeSignature`'s refusals, each one a person did not choose. A
 * closed picker is the other outcome and opens nothing, as `SIGN_PROBLEM_DIALOG`'s argument has it.
 *
 * **Its own dialog rather than *Sign with certificate*'s**, whose every sentence says *the document was not signed* — a
 * claim about a certificate this route never asked for. Informational, so it answers nothing (ADR-0038).
 */
export const SIGNATURE_PROBLEM_DIALOG = declareDialog({
  id: SIGNATURE_PROBLEM_DIALOG_ID,
  title: SIGNATURE_PROBLEM_TITLE,
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }).strict(),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }).strict(),
    z.object({ reason: z.literal('absent') }).strict(),
    z.object({ reason: z.literal('unencodable-text') }).strict(),
  ]),
  component: lazy(() => import('./SignatureProblemBody.js')),
});
