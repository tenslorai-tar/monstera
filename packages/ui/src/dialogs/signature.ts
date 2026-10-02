import { libraryIdSchema, requestedSignatureMarkSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { KEPT_SIGNATURE } from './signDocument.js';

/** The id the plain Signature's command opens (ADR-0133). */
export const SIGNATURE_DIALOG_ID = 'dialog.signature';

/**
 * What the Signature dialog answers: the look to place and whether to keep it, or a kept signature to remove — after
 * which the opener removes it and asks again with the library as it then is (`SIGN_DOCUMENT_ANSWERS`' reason: props
 * are fixed while a dialog is open).
 *
 * **The contract's own mark schema**, so the dialog cannot answer a look the channel refuses; a kept look is `saved`
 * by its id, and the person's *Save for reuse* travels beside it for main to act on after the mark is placed.
 */
export const SIGNATURE_ANSWERS = z.union([
  z.object({ mark: requestedSignatureMarkSchema, keep: z.boolean() }).strict(),
  z.object({ library: z.literal('remove'), id: libraryIdSchema }).strict(),
]);

export type SignatureAnswers = z.infer<typeof SIGNATURE_ANSWERS>;

/** The look and the keep, as the Signature command holds them between the dialog and the click. */
export type SignatureLook = Extract<SignatureAnswers, { mark: unknown }>;

export const SIGNATURE_DIALOG = declareDialog({
  id: SIGNATURE_DIALOG_ID,
  title: SIGNATURE_TITLE,
  /** `kept` is the signature library — the one *Sign with certificate* offers too — for one-click reuse. */
  props: z.object({ kept: z.array(KEPT_SIGNATURE).readonly() }).strict(),
  result: SIGNATURE_ANSWERS,
  component: lazy(() => import('./SignatureBody.js')),
});
