import {
  MAX_DOCUSIGN_RECIPIENT_FIELD,
  MAX_DOCUSIGN_SIGNERS,
  MAX_DOCUSIGN_SUBJECT,
} from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { DOCUSIGN_SEND_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Send to DocuSign* opens. */
export const DOCUSIGN_SEND_DIALOG_ID = 'dialog.docusign-send';

/**
 * What a person supplies to send a document for signature.
 *
 * **The channel's bounds, taken from the contract** — DocuSign's own published limits
 * for a subject and for a signer's name and email — so an answer this dialog accepts
 * is never one `docusign.send` then refuses at the boundary.
 */
export const DOCUSIGN_SEND_RESULT = z
  .object({
    emailSubject: z.string().trim().min(1).max(MAX_DOCUSIGN_SUBJECT),
    signers: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(MAX_DOCUSIGN_RECIPIENT_FIELD),
            email: z.email().max(MAX_DOCUSIGN_RECIPIENT_FIELD),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_DOCUSIGN_SIGNERS),
  })
  .strict();

/** The dialog's answer. */
export type DocusignSendAnswer = z.infer<typeof DOCUSIGN_SEND_RESULT>;

/**
 * *Send to DocuSign* — who signs, and what their email says.
 *
 * ## What leaves the machine is said on screen
 *
 * Sending uploads the document to DocuSign and emails every signer. That is written
 * in the dialog, beside the button, because the person pressing it is the one who
 * needs to know — not in a comment here.
 *
 * ## The document, the key and the sign-in are not here
 *
 * `main` flushes the document and signs in through the person's own browser. This
 * dialog answers words a person typed, and nothing else crosses from it.
 */
export const DOCUSIGN_SEND_DIALOG = declareDialog({
  id: DOCUSIGN_SEND_DIALOG_ID,
  title: DOCUSIGN_SEND_TITLE,
  props: z.object({}).strict(),
  result: DOCUSIGN_SEND_RESULT,
  component: lazy(() => import('./DocusignSendBody.js')),
});
