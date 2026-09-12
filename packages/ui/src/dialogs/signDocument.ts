import {
  DOCUMENT_PASSWORD_MAX_CHARS,
  MAX_SIGNATURE_FIELD,
  requestedSignatureMarkSchema,
} from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGN_DOCUMENT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's signing command opens. */
export const SIGN_DOCUMENT_DIALOG_ID = 'dialog.sign-document';

/**
 * What a person supplies to sign, besides the certificate itself.
 *
 * ## The CERTIFICATE is not here, and that is the row's whole security property
 *
 * A PKCS#12 is a private key. Main opens the picker, reads the file and mints
 * the command, so the renderer never holds one and this dialog has no field for
 * it — the capability is unrepresentable rather than discouraged
 * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)'s
 * rule applied to the other kind of secret).
 *
 * The dialog's own words say where the file is chosen, because a person
 * pressing *Sign* and meeting a file dialog they did not expect is a surprise
 * the sentence costs nothing to avoid.
 *
 * ## An EMPTY passphrase is valid
 *
 * Many certificates have none, so the field has no minimum — unlike every
 * other password field in this build, where an empty value is the attempt the
 * engine already made.
 *
 * ## The four descriptive fields are OPTIONAL and trimmed
 *
 * `/Reason`, `/Location`, `/ContactInfo` and `/Name` are displayed by readers,
 * so a value of three spaces is one a person sees as blank — the annotation
 * dialogs' rule, and the opposite of the passphrase's.
 */
export const SIGN_DOCUMENT_RESULT = z
  .object({
    passphrase: z.string().max(DOCUMENT_PASSWORD_MAX_CHARS),
    name: z.string().trim().min(1).max(MAX_SIGNATURE_FIELD).optional(),
    reason: z.string().trim().min(1).max(MAX_SIGNATURE_FIELD).optional(),
    location: z.string().trim().min(1).max(MAX_SIGNATURE_FIELD).optional(),
    contactInfo: z.string().trim().min(1).max(MAX_SIGNATURE_FIELD).optional(),
    /**
     * What a reader may still change, for a certifying signature.
     *
     * **In this dialog rather than a second one**, because certifying IS
     * signing with a different claim attached — a person chooses a certificate
     * and a passphrase either way, and two screens would ask them to know
     * which of two acts they are performing before they have seen either.
     */
    certify: z.enum(['no-changes', 'form-fill', 'form-fill-and-annotate']).optional(),
    /**
     * How a VISIBLE signature looks — present exactly when the dialog was
     * opened for a placement.
     *
     * The contract's own mark schema rather than a copy of it, so the dialog
     * cannot answer a look the channel refuses. The typed text is trimmed by the
     * body before it gets here, for the descriptive fields' reason.
     */
    mark: requestedSignatureMarkSchema.optional(),
  })
  .strict();

/** What the signing dialog answers with. */
export type SignDocumentAnswer = z.infer<typeof SIGN_DOCUMENT_RESULT>;

export const SIGN_DOCUMENT_DIALOG = declareDialog({
  id: SIGN_DOCUMENT_DIALOG_ID,
  title: SIGN_DOCUMENT_TITLE,
  /**
   * `placed` is whether a rectangle was drawn first. The ribbon's *Sign
   * document* opens this without one, for an invisible signature; the place
   * signature tool opens it with one, and only then does the body ask how the
   * signature looks.
   */
  props: z.object({ placed: z.boolean() }).strict(),
  result: SIGN_DOCUMENT_RESULT,
  component: lazy(() => import('./SignDocumentBody.js')),
});
